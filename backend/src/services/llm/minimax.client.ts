// MiniMax LLM client — OpenAI-compatible Chat Completions.
//
// The fetch/parse/timeout logic now lives in openai-runner.ts (shared with the
// OpenRouter client). This file keeps:
//   - the canonical type aliases (MiniMaxMessage/Tool/FunctionCall/CallResult)
//     used across the agent code + tests (named MiniMax for historical reasons;
//     they are generic OpenAI shapes)
//   - stripThink (MiniMax-specific reasoning cleanup)
//   - callMiniMax — a thin shim that delegates to the ACTIVE provider, so the
//     orchestrator's 3 call sites + tests are unchanged whether the admin
//     picked MiniMax or OpenRouter. The active provider + key are resolved
//     live from the DB via provider-registry.ts (no process restart needed).
//   - createMiniMaxProvider(key, model) — a concrete LlmProvider instance for
//     the registry to use when MiniMax is active.
//
// `reasoning_split` is a MiniMax-native param that routes chain-of-thought to a
// separate `reasoning_details` field so the orchestrator doesn't re-bill leaked
// reasoning as input on every ReAct iteration. stripThink() backstops any host
// that still leaks reasoning into `content` despite this flag.
import {
  MODEL_FAST,
  MINIMAX_BASE_URL,
  MINIMAX_TIMEOUT_MS,
  AGENT_MAX_ITERATIONS,
} from './models';
import { runOpenAiCompletion, runOpenAiStreamingCompletion } from './openai-runner';
import type { LlmProvider, LlmCompleteOptions } from './provider';
import { getActiveProvider } from './provider-registry';

// Re-export so callers (orchestrator) read model + endpoint constants from one
// place. See models.ts for why these are hardcoded, not env-driven.
export { MODEL_FAST, MINIMAX_BASE_URL, MINIMAX_TIMEOUT_MS, AGENT_MAX_ITERATIONS };
// Re-export the live model the active provider is using, so the orchestrator's
// telemetry/metrics rows reflect the configured provider instead of a hardcoded
// MiniMax constant. Awaitable because the active provider is DB-resolved.
export async function getActiveModel(): Promise<string> {
  return (await getActiveProvider()).model;
}

export interface MiniMaxFunctionCall {
  id: string;
  name: string;
  /** Raw `arguments` JSON string from the model — parse defensively. */
  arguments: string;
}

export interface MiniMaxMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** assistant turns that requested tool calls. */
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** tool-result turns cite the call they answer. */
  tool_call_id?: string;
  name?: string;
}

export interface MiniMaxTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type MiniMaxResponseFormat =
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown> } };

export interface MiniMaxCallResult {
  content: string | null;
  toolCalls: MiniMaxFunctionCall[];
  usage: { promptTokens: number; completionTokens: number };
  /** Wall-clock latency of this call measured by performance.now() (sampler-
   *  independent — accurate even when OTel drops the span). */
  latencyMs: number;
  /** OpenAI `finish_reason` ('stop' | 'length' | 'tool_calls' | …). 'length'
   *  means the model hit `max_tokens` mid-output → the content is TRUNCATED and
   *  must never be trusted or JSON-healed (a healer would silently close a
   *  partial object). Callers gate healing/repair on `!== 'length'`. */
  finishReason: string | null;
}

export class MiniMaxError extends Error {
  constructor(message: string, readonly code: 'no_key' | 'http' | 'timeout' | 'parse' = 'http') {
    super(message);
    this.name = 'MiniMaxError';
  }
}

/** Strip model-internal markup that leaks into `content` so it never enters the
 *  `messages` history the orchestrator re-sends on every ReAct iteration, and
 *  never reaches the user's chat bubble. Two leak classes are cleaned:
 *
 *  1. `<think>…</think>` reasoning blocks. With `reasoning_split: true` the
 *     content is already clean; this is the backstop for hosts/models that
 *     still leak reasoning into `content`.
 *  2. `<minimax:tool_call …>…</minimax:tool_call>` (and the broader
 *     `<minimax:TAG …>` family / bare `<tool_call>`). MiniMax serializes its
 *     tool-call intent as inline markup inside `content` IN ADDITION to the
 *     structured `tool_calls` array the orchestrator actually executes — so the
 *     inline copy is a purely parasitic duplicate that must not be shown to
 *     users or re-billed as prompt tokens on the next iteration.
 *
 *  Returns null when only markup was present (no real answer). */
export function stripThink(s: string | null | undefined): string | null {
  if (!s) return null;
  const cleaned = s
    // Reasoning blocks — closed, then unclosed (truncated → drop to end).
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    // Inline tool-call / model-internal markup leaked into `content`. Covers the
    // `<minimax:TAG …>…</minimax:TAG>` family (observed: minimax:tool_call) and
    // the bare `<tool_call>…</tool_call>` variant. ORDER MATTERS: matched
    // open…close pairs and self-closing tags must be removed BEFORE orphan
    // close-tags and unclosed-open-to-end, otherwise an empty closed block
    // (`<TAG …></TAG>`) loses its close tag first and its open tag is then
    // greedily consumed to end-of-string, eating trailing prose. No trailing
    // `\s*` is appended (matches `<think>`'s style; the final `.trim()` handles
    // edges and internal double-spaces are left as-is).
    // 1. closed blocks (non-greedy open…close pair)
    .replace(/<(?:minimax:[a-z_]+|tool_call)\b[^>]*>[\s\S]*?<\/(?:minimax:[a-z_]+|tool_call)>/gi, '')
    // 2. self-closing <TAG …/>
    .replace(/<(?:minimax:[a-z_]+|tool_call)\b[^>]*\/>/gi, '')
    // 3. stray orphan close tags (close with no surviving open)
    .replace(/<\/(?:minimax:[a-z_]+|tool_call)>/gi, '')
    // 4. unclosed open tag → drop to end (truncated output; no `>` required,
    //    mirroring the `<think>` unclosed branch)
    .replace(/<(?:minimax:[a-z_]+|tool_call)\b[\s\S]*$/gi, '')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Build a concrete MiniMax provider instance bound to a live key + model.
 *  Used by provider-registry.ts when MiniMax is the active provider. */
export function createMiniMaxProvider(key: string, model: string = MODEL_FAST): LlmProvider {
  return {
    id: 'minimax',
    model,
    async complete(opts: LlmCompleteOptions): Promise<MiniMaxCallResult> {
      if (!key) {
        throw new MiniMaxError('MiniMax chưa cấu hình (thiếu API key)', 'no_key');
      }
      return runOpenAiCompletion(
        {
          providerId: 'minimax',
          baseUrl: MINIMAX_BASE_URL,
          apiKey: key,
          model,
          timeoutMs: MINIMAX_TIMEOUT_MS,
          // reasoning_split is a MiniMax-native param (M2.5/M2.7 reasoning
          // models) — output-format switch only, does NOT toggle reasoning.
          extraBody: { reasoning_split: true },
          cleanContent: stripThink,
        },
        opts,
      );
    },
    async streamComplete(
      opts: LlmCompleteOptions,
      onText: (delta: string) => void,
    ): Promise<MiniMaxCallResult> {
      if (!key) {
        throw new MiniMaxError('MiniMax chưa cấu hình (thiếu API key)', 'no_key');
      }
      return runOpenAiStreamingCompletion(
        {
          providerId: 'minimax',
          baseUrl: MINIMAX_BASE_URL,
          apiKey: key,
          model,
          timeoutMs: MINIMAX_TIMEOUT_MS,
          // Same MiniMax-native params + cleanContent as the buffered path. The
          // cleanContent (stripThink) hook runs ONCE on the accumulated stream
          // (never per-delta) — see runOpenAiStreamingCompletion.
          extraBody: { reasoning_split: true },
          cleanContent: stripThink,
        },
        opts,
        onText,
      );
    },
  };
}

/** Delegate to the ACTIVE provider (MiniMax or OpenRouter, per admin settings).
 *  This keeps the orchestrator's existing `callMiniMax({...})` call sites
 *  unchanged: they don't need to know which provider is configured. The active
 *  provider + key are resolved live from the DB (cached) so an admin key change
 *  takes effect on the next call without a process restart. */
export async function callMiniMax(opts: {
  messages: MiniMaxMessage[];
  tools?: MiniMaxTool[];
  responseFormat?: MiniMaxResponseFormat;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<MiniMaxCallResult> {
  const provider = await getActiveProvider();
  return provider.complete(opts);
}

/** Streaming delegate to the ACTIVE provider. Mirrors `callMiniMax` but streams
 *  content deltas via `onText` as tokens arrive. Used by the orchestrator for
 *  live TEXT_MESSAGE_* emission on text answers. The resolved result is the
 *  same buffered shape (content accumulated, tool_calls assembled, usage
 *  captured) — so a call site can switch between `callMiniMax` and
 *  `callMiniMaxStream` with no other change. */
export async function callMiniMaxStream(
  opts: {
    messages: MiniMaxMessage[];
    tools?: MiniMaxTool[];
    responseFormat?: MiniMaxResponseFormat;
    maxTokens?: number;
    signal?: AbortSignal;
  },
  onText: (delta: string) => void,
): Promise<MiniMaxCallResult> {
  const provider = await getActiveProvider();
  return provider.streamComplete(opts, onText);
}
