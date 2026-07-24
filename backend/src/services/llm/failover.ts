// P5 Governance — LLM provider failover wrapper.
//
// Wraps callMiniMax / callMiniMaxStream so that a failed primary-provider call
// (timeout, HTTP error, 429 rate-limit) retries on the alternate provider.
// This keeps the bot running through a single-provider outage.
//
// The wrapper is behind config.agentFailover. When disabled, it's a pass-through.
// Failover is logged so the dashboard's fallback_used metric tracks it.
//
// Implementation: the provider registry already resolves the ACTIVE provider
// (MiniMax or OpenRouter). For failover we call the INACTIVE provider directly.
// If the inactive provider has no key configured, failover is skipped (no
// silent breakage).

import { config } from '../../config';
import { MiniMaxError } from './minimax.client';
import type { LlmProvider } from './provider';

/** Error codes that should trigger failover (transient/infrastructure errors).
 *  'no_key' and 'parse' are NOT included — a missing key is config, not an
 *  outage; a parse error is the model's fault, not the provider's. */
const FAILOVER_CODES = new Set(['timeout', 'http']);

// NOTE: the inactive provider is supplied by the CALLER of callWithFailover /
// callStreamWithFailover (they receive it as a parameter). Resolving the
// inactive provider here was a leftover from an earlier design and is not
// needed — removing it keeps this module a pure wrapper.

/** Wrap a complete (non-streaming) call with failover. Generic over the opts
 *  and result types so it works with any provider's complete() signature. */
export async function callWithFailover<TOpts, TResult>(
  opts: TOpts,
  primaryCall: (opts: TOpts) => Promise<TResult>,
  inactiveProvider: LlmProvider | null,
  inactiveCallFn?: (provider: LlmProvider, opts: TOpts) => Promise<TResult>,
): Promise<{ result: TResult; fallbackUsed: boolean }> {
  try {
    const result = await primaryCall(opts);
    return { result, fallbackUsed: false };
  } catch (e) {
    if (!config.agentFailover) throw e;
    if (e instanceof MiniMaxError && !FAILOVER_CODES.has(e.code)) throw e;
    if (e instanceof MiniMaxError && e.code === 'no_key') throw e;

    if (!inactiveProvider || !inactiveCallFn) throw e;

    console.warn(`[failover] primary provider failed (${e instanceof Error ? e.message : e}), retrying on alternate`);
    const result = await inactiveCallFn(inactiveProvider, opts);
    return { result, fallbackUsed: true };
  }
}

/** Wrap a streaming call with failover. NOTE: streaming failover only works
 *  BEFORE any tokens have been emitted to the client. */
export async function callStreamWithFailover<TOpts, TResult>(
  opts: TOpts,
  onText: (delta: string) => void,
  primaryStream: (opts: TOpts, onText: (delta: string) => void) => Promise<TResult>,
  inactiveProvider: LlmProvider | null,
  inactiveStreamFn?: (provider: LlmProvider, opts: TOpts, onText: (delta: string) => void) => Promise<TResult>,
): Promise<{ result: TResult; fallbackUsed: boolean }> {
  try {
    const result = await primaryStream(opts, onText);
    return { result, fallbackUsed: false };
  } catch (e) {
    if (!config.agentFailover) throw e;
    if (e instanceof MiniMaxError && !FAILOVER_CODES.has(e.code)) throw e;
    if (e instanceof MiniMaxError && e.code === 'no_key') throw e;

    if (!inactiveProvider || !inactiveStreamFn) throw e;

    console.warn(`[failover] primary stream failed (${e instanceof Error ? e.message : e}), retrying on alternate`);
    const result = await inactiveStreamFn(inactiveProvider, opts, onText);
    return { result, fallbackUsed: true };
  }
}
