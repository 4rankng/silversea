// Shared OpenAI-compatible Chat Completions runner used by both provider
// clients (MiniMax, OpenRouter). Extracted from minimax.client.ts so each
// provider is a thin config wrapper around the same fetch/parse/timeout logic.
//
// Keeps every nuance of the original implementation:
//   - AbortController timeout (per-provider boundary) + honour caller signal
//   - listener cleanup in `finally` (no leaked parent-signal listeners)
//   - OpenAI-shaped request body + response parsing
//   - finish_reason propagation ('length' → truncated content must not be healed)
//   - OTel span via withSpan; latencyMs from performance.now() (sampler-safe)
import { withSpan, type SpanAttrs } from '../agent/telemetry.js';
import {
  MiniMaxError,
  type MiniMaxCallResult,
  type MiniMaxFunctionCall,
  type MiniMaxMessage,
  type MiniMaxResponseFormat,
  type MiniMaxTool,
} from './minimax.client';

// NOTE: this module + minimax.client.ts form a benign ESM cycle:
// minimax.client → openai-runner (for runOpenAiCompletion) → minimax.client
// (for the MiniMaxError class + types). It is safe because every cross-module
// reference is resolved lazily inside a function body, never at module-
// evaluation time. The types are erased at compile time; MiniMaxError is only
// constructed inside runOpenAiCompletion, which runs after both modules are
// fully loaded.

export interface OpenAiRunnerConfig {
  /** Provider id, surfaced in telemetry ('minimax' | 'openrouter'). */
  providerId: string;
  /** Chat Completions base URL (no trailing slash), e.g. https://api.minimax.io/v1. */
  baseUrl: string;
  /** Bearer token. */
  apiKey: string;
  /** Model id sent in the body. */
  model: string;
  /** Per-call timeout (ms). */
  timeoutMs: number;
  /** Provider-specific extra body fields (e.g. MiniMax `reasoning_split`). */
  extraBody?: Record<string, unknown>;
  /** Hook to clean a returned content string (e.g. stripThink for MiniMax).
   *  Defaults to identity (OpenRouter doesn't leak <think> blocks). */
  cleanContent?: (s: string | null | undefined) => string | null;
}

interface OpenAIChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  };
  finish_reason?: string;
}
interface OpenAIResponse {
  choices?: OpenAIChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Run one OpenAI-compatible completion. Mirrors the original callMiniMax
 *  behaviour exactly — see module header for the preserved nuances. */
export async function runOpenAiCompletion(
  cfg: OpenAiRunnerConfig,
  opts: {
    messages: MiniMaxMessage[];
    tools?: MiniMaxTool[];
    responseFormat?: MiniMaxResponseFormat;
    maxTokens?: number;
    signal?: AbortSignal;
  },
): Promise<MiniMaxCallResult> {
  const cleanContent = cfg.cleanContent ?? ((s) => s ?? null);

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: opts.messages,
    temperature: 0.2, // low — analytical answers + tool selection should be deterministic-ish
    ...(cfg.extraBody ?? {}),
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  if (opts.responseFormat) body.response_format = opts.responseFormat;
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  // Honour a caller-supplied signal too (e.g. client disconnect). The listener
  // is removed in `finally` so a long-lived parent signal (the req-close signal
  // spans the whole SSE turn) doesn't accumulate one listener and retain each
  // per-call controller across every ReAct iteration.
  const onParentAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  // ── Instrumented LLM call ────────────────────────────────────────────────
  // latencyMs comes from withSpan's performance.now() timer, NOT span.duration
  // (the sampler may discard the span — see telemetry.ts LATENCY CONTRACT).
  const tracePrompts = process.env.AGENT_TRACE_PROMPTS === '1';
  const llmAttrs: SpanAttrs = {
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': cfg.model,
    'gen_ai.system': cfg.providerId,
  };
  if (tracePrompts) {
    llmAttrs['gen_ai.prompt'] = JSON.stringify(opts.messages).slice(0, 8000);
  }

  try {
    const { result: callResult, durationMs: latencyMs } = await withSpan(
      `agent.llm.${cfg.providerId}_call`,
      llmAttrs,
      async () => {
        const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '<no body>');
          console.error(`[agent] ${cfg.providerId} → ${res.status}: ${errBody.slice(0, 500)}`);
          throw new MiniMaxError(`${cfg.providerId} HTTP ${res.status}`, 'http');
        }

        const data = (await res.json()) as OpenAIResponse;
        const choice = data.choices?.[0];
        const msg = choice?.message;

        const toolCalls: MiniMaxFunctionCall[] = (msg?.tool_calls ?? []).map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));

        const promptTokens = data.usage?.prompt_tokens ?? 0;
        const completionTokens = data.usage?.completion_tokens ?? 0;
        return {
          content: cleanContent(msg?.content),
          toolCalls,
          usage: { promptTokens, completionTokens },
          finishReason: choice?.finish_reason ?? null,
        };
      },
    );

    return {
      content: callResult.content,
      toolCalls: callResult.toolCalls,
      usage: callResult.usage,
      latencyMs,
      finishReason: callResult.finishReason,
    };
  } catch (e) {
    if (e instanceof MiniMaxError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new MiniMaxError(`${cfg.providerId} timeout after ${cfg.timeoutMs}ms`, 'timeout');
    }
    throw new MiniMaxError(
      `${cfg.providerId} request failed: ${e instanceof Error ? e.message : 'unknown'}`,
      'parse',
    );
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onParentAbort);
  }
}

// Suppress the unused-import lint for re-exported types consumed only by the
// type signature above (MiniMaxMessage/Tool/ResponseFormat/FunctionCall).
export type {
  MiniMaxMessage,
  MiniMaxTool,
  MiniMaxFunctionCall,
  MiniMaxResponseFormat,
};

// ── Streaming variant ──────────────────────────────────────────────────────
// Token-by-token streaming for the agent's text answers. Mirrors the buffered
// `runOpenAiCompletion` request/timeout/abort/span contract, but consumes the
// OpenAI Server-Sent-Events stream (`stream: true`) incrementally and invokes
// `onText` for each content delta so the orchestrator can emit
// TEXT_MESSAGE_* events live.
//
// Returns the SAME `MiniMaxCallResult` as the buffered runner (content
// accumulated, tool_calls assembled from fragmented deltas, usage captured),
// so callers can treat it as a drop-in. The `cleanContent` hook runs ONCE on
// the fully accumulated string (never per-delta) — this is deliberate: partial
// `<think>`/`<minimax:tool_call>` tags must not leak mid-stream, and assembling
// tool_calls from fragments requires the full stream anyway.
//
// `onText` receives RAW delta content (pre-cleanContent). The orchestrator's
// peek-then-commit heuristic decides whether to forward it as a streaming
// event; for the common case (no tool_calls in the stream) it forwards every
// delta. Because cleanContent only strips already-closed or trailing markup,
// any emitted delta is either clean or a prefix that cleanContent will trim at
// the very start — the RUN_FINISHED text is authoritative for persistence.
export async function runOpenAiStreamingCompletion(
  cfg: OpenAiRunnerConfig,
  opts: {
    messages: MiniMaxMessage[];
    tools?: MiniMaxTool[];
    responseFormat?: MiniMaxResponseFormat;
    maxTokens?: number;
    signal?: AbortSignal;
  },
  onText: (delta: string) => void,
): Promise<MiniMaxCallResult> {
  const cleanContent = cfg.cleanContent ?? ((s) => s ?? null);

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: opts.messages,
    temperature: 0.2,
    stream: true, // SSE streaming
    // Ask the provider to report usage in the final SSE chunk so token
    // accounting stays accurate under streaming. Harmlessly ignored by hosts
    // that don't support it (usage stays 0 → metrics row logs 0, same as a
    // buffered call that omitted usage).
    stream_options: { include_usage: true },
    ...(cfg.extraBody ?? {}),
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  if (opts.responseFormat) body.response_format = opts.responseFormat;
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const onParentAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  const tracePrompts = process.env.AGENT_TRACE_PROMPTS === '1';
  const llmAttrs: SpanAttrs = {
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': cfg.model,
    'gen_ai.system': cfg.providerId,
    'gen_ai.streaming': true,
  };
  if (tracePrompts) {
    llmAttrs['gen_ai.prompt'] = JSON.stringify(opts.messages).slice(0, 8000);
  }

  try {
    const { result: callResult, durationMs: latencyMs } = await withSpan(
      `agent.llm.${cfg.providerId}_stream`,
      llmAttrs,
      async () => {
        const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`,
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          // Non-SSE error response — safe to buffer (no stream opened).
          const errBody = await res.text().catch(() => '<no body>');
          console.error(`[agent] ${cfg.providerId} stream → ${res.status}: ${errBody.slice(0, 500)}`);
          throw new MiniMaxError(`${cfg.providerId} HTTP ${res.status}`, 'http');
        }
        if (!res.body) {
          throw new MiniMaxError(`${cfg.providerId} stream: empty response body`, 'parse');
        }

        return parseSSEStream(res.body, onText, controller.signal);
      },
    );

    // cleanContent runs once on the fully accumulated content (never per-delta).
    return {
      content: cleanContent(callResult.content),
      toolCalls: callResult.toolCalls,
      usage: callResult.usage,
      latencyMs,
      finishReason: callResult.finishReason,
    };
  } catch (e) {
    if (e instanceof MiniMaxError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new MiniMaxError(`${cfg.providerId} stream timeout after ${cfg.timeoutMs}ms`, 'timeout');
    }
    throw new MiniMaxError(
      `${cfg.providerId} stream failed: ${e instanceof Error ? e.message : 'unknown'}`,
      'parse',
    );
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onParentAbort);
  }
}

// ── SSE parsing helpers ────────────────────────────────────────────────────

/** Shape of one SSE `data:` chunk from an OpenAI-compatible streaming response. */
interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Read an OpenAI SSE stream, invoking `onText` per content delta and assembling
 * fragmented tool_calls. Returns the buffered `MiniMaxCallResult`-equivalent
 * (raw content, pre-cleanContent; tool_calls; usage; finishReason).
 *
 * The stream terminates on a `data: [DONE]` sentinel. A caller `AbortSignal`
 * abort causes `reader.read()` to reject — caught and rethrown as a clean
 * AbortError so the caller maps it to a timeout/error consistently.
 */
async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  onText: (delta: string) => void,
  signal: AbortSignal,
): Promise<{
  content: string | null;
  toolCalls: MiniMaxFunctionCall[];
  usage: { promptTokens: number; completionTokens: number };
  finishReason: string | null;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  // Tool calls arrive fragmented across chunks, indexed by `delta.tool_calls[].index`.
  // Accumulate id/name (first fragment) + arguments (concatenated across fragments).
  const toolCallAccum = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line. Process complete events only.
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 2);
        const parsed = parseOneSseEvent(rawEvent);
        if (!parsed) continue;
        if (parsed.done) {
          // [DONE] sentinel — stream is over.
          return finalize();
        }
        const choice = parsed.chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) {
          content += delta.content;
          onText(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallAccum.get(tc.index);
            if (existing) {
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            } else {
              toolCallAccum.set(tc.index, {
                id: tc.id ?? `call_${tc.index}`,
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? '',
              });
            }
          }
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (parsed.chunk.usage) {
          promptTokens = parsed.chunk.usage.prompt_tokens ?? promptTokens;
          completionTokens = parsed.chunk.usage.completion_tokens ?? completionTokens;
        }
      }
    }
    // Stream ended without an explicit [DONE] — finalize from whatever arrived.
    return finalize();
  } catch (e) {
    if (signal.aborted) {
      // Re-throw as AbortError so the caller maps it consistently.
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    throw e;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released / errored — ignore */
    }
  }

  function finalize() {
    // Preserve `index` order: the Map is keyed by the provider's tool_call
    // index, and conformant streams emit in index order (so insertion order
    // already matches). Sort defensively by index in case a provider emits
    // out of order — the orchestrator feeds these back to the model in array
    // order, so order matters for the tool-calling protocol.
    const toolCalls: MiniMaxFunctionCall[] = [...toolCallAccum.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => tc)
      .filter((tc) => tc.name || tc.arguments);
    return {
      content: content.length > 0 ? content : null,
      toolCalls,
      usage: { promptTokens, completionTokens },
      finishReason,
    };
  }
}

/** Parse one raw SSE event block into either a `{done:true}` sentinel or a
 *  `{chunk: StreamChunk}`. Returns null for comments/keepalives/non-data lines. */
function parseOneSseEvent(
  rawEvent: string,
): { done: true } | { done: false; chunk: StreamChunk } | null {
  // An SSE event is one or more `field: value` lines. We only need `data:`.
  const dataLines: string[] = [];
  for (const line of rawEvent.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(':')) continue; // SSE comment / keepalive
    if (trimmed.startsWith('data:')) {
      dataLines.push(trimmed.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join('\n');
  if (data === '[DONE]') return { done: true };
  try {
    return { done: false, chunk: JSON.parse(data) as StreamChunk };
  } catch {
    // Malformed JSON chunk — skip it (providers occasionally emit partials).
    return null;
  }
}
