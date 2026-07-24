// LLM provider abstraction for the chatbot agent.
//
// Both providers (MiniMax, OpenRouter) speak the OpenAI Chat Completions
// surface, so the option/result shapes are the *existing* `MiniMax*` type
// aliases (now the canonical names — see minimax.client.ts). This interface
// lets the orchestrator route to whichever provider the admin picked, with a
// live key, without touching the call sites.
//
// The orchestrator still imports `callMiniMax` + the `MiniMax*` types
// directly; `callMiniMax` is now a thin shim that delegates to the active
// provider (see minimax.client.ts + provider-registry.ts). That keeps the diff
// to the orchestrator + tests to near-zero.

import type {
  MiniMaxMessage,
  MiniMaxTool,
  MiniMaxFunctionCall,
  MiniMaxCallResult,
  MiniMaxResponseFormat,
} from './minimax.client';

/** Options passed into a provider completion. Identical to the existing
 *  `callMiniMax` options — the canonical input shape for the agent. */
export interface LlmCompleteOptions {
  messages: MiniMaxMessage[];
  tools?: MiniMaxTool[];
  responseFormat?: MiniMaxResponseFormat;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** A concrete provider the agent can route to. `id` + `model` are surfaced in
 *  telemetry and metrics (replacing hardcoded MODEL_FAST references). */
export interface LlmProvider {
  /** Provider key — matches the shared `LlmProvider` union ('minimax' | 'openrouter'). */
  readonly id: 'minimax' | 'openrouter';
  /** Model id sent in the request body + recorded on metrics rows. */
  readonly model: string;
  /** Run one OpenAI-compatible completion (buffered). */
  complete(opts: LlmCompleteOptions): Promise<MiniMaxCallResult>;
  /** Streaming variant: invokes `onText` per content delta as tokens arrive,
   *  then resolves with the same buffered `MiniMaxCallResult` (content
   *  accumulated, tool_calls assembled, usage captured). Used for the agent's
   *  live text-message streaming. Falls back to `complete` when a provider
   *  does not implement streaming. */
  streamComplete(
    opts: LlmCompleteOptions,
    onText: (delta: string) => void,
  ): Promise<MiniMaxCallResult>;
}

// Re-export the shared shapes so downstream code can import everything from one
// place. These types stay named `MiniMax*` to avoid churn across the 4 files
// that already use them (orchestrator, agentSocket, token-attribution, tests).
export type {
  MiniMaxMessage,
  MiniMaxTool,
  MiniMaxFunctionCall,
  MiniMaxCallResult,
  MiniMaxResponseFormat,
};
