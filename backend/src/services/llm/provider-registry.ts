// Active LLM provider resolver — the single entry point the agent uses to get
// the currently-configured provider instance (MiniMax or OpenRouter) bound to
// its live key + model.
//
// `getActiveProvider()` reads the live settings (DB-backed, cached) and returns
// a concrete LlmProvider. The MiniMax client's `callMiniMax` shim delegates
// here, so the orchestrator's existing call sites pick up provider/key changes
// on the next call without a restart.
import { getLlmSettings } from './settings';
import { createMiniMaxProvider } from './minimax.client';
import { createOpenRouterProvider } from './openrouter.client';
import { MiniMaxError } from './minimax.client';
import type { LlmProvider } from './provider';

let cachedProvider: LlmProvider | null = null;

/** Resolve the active provider instance. Throws a MiniMaxError('no_key') if the
 *  chosen provider has no key configured — the orchestrator already maps that
 *  code to a 503, so the user-facing behaviour is identical to the pre-feature
 *  "MiniMax chưa cấu hình" path. */
export async function getActiveProvider(): Promise<LlmProvider> {
  if (cachedProvider) return cachedProvider;

  const settings = await getLlmSettings();
  let provider: LlmProvider;
  if (settings.provider === 'openrouter') {
    if (!settings.openrouterKey) {
      throw new MiniMaxError('OpenRouter chưa cấu hình (thiếu API key)', 'no_key');
    }
    provider = createOpenRouterProvider(settings.openrouterKey);
  } else {
    if (!settings.minimaxKey) {
      throw new MiniMaxError('MiniMax chưa cấu hình (thiếu API key)', 'no_key');
    }
    provider = createMiniMaxProvider(settings.minimaxKey);
  }
  cachedProvider = provider;
  return provider;
}

/** Drop the cached provider instance. Called after a settings write so the next
 *  getActiveProvider() rebuilds with the new provider/key. */
export function invalidateActiveProvider(): void {
  cachedProvider = null;
}
