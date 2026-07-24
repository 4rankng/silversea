// Live LLM provider settings — the runtime source of truth for which provider
// the chatbot agent uses and its API key.
//
// Replaces the frozen `config.minimaxApiKey` (read once at startup) with a DB-
// backed, encrypted, cached layer. An admin key change via the settings route
// calls invalidateLlmSettings() and the next agent call picks up the new value
// immediately — no process restart.
//
// Storage: three rows in app_settings under the `llm.*` prefix:
//   llm.provider          → 'minimax' | 'openrouter' (plaintext enum value)
//   llm.minimax_api_key   → encrypted (enc:v1:...) or empty
//   llm.openrouter_api_key → encrypted (enc:v1:...) or empty
//
// Boot fallback: when a DB row is absent, fall back to the env values
// (config.minimaxApiKey / config.openrouterApiKey) so existing deployments keep
// working before an admin saves anything. Provider default: whichever key is
// present, MiniMax first (matches pre-feature behaviour).
import { db } from '../../db';
import * as s from '../../db/schema';
import { like } from 'drizzle-orm';
import { config } from '../../config';
import { decryptSecret } from '../crypto';
import type { LlmProvider } from '@tingting/shared';

export interface LlmSettings {
  provider: LlmProvider;
  minimaxKey: string;
  openrouterKey: string;
}

const KEY_PROVIDER = 'llm.provider';
const KEY_MINIMAX = 'llm.minimax_api_key';
const KEY_OPENROUTER = 'llm.openrouter_api_key';

let cached: LlmSettings | null = null;
let loadPromise: Promise<LlmSettings> | null = null;
let cacheGeneration = 0;

function resolveProviderDefault(minimaxKey: string, openrouterKey: string): LlmProvider {
  // Pre-feature behaviour: MiniMax was the only agent provider, gated by env
  // MINIMAX_API_KEY. Preserve that default unless only OpenRouter is set.
  if (minimaxKey) return 'minimax';
  if (openrouterKey) return 'openrouter';
  return 'minimax'; // no keys yet — provider is nominal until an admin sets one
}

/** Load settings from the DB (decrypting keys), with env fallbacks. */
async function loadSettings(): Promise<LlmSettings> {
  const rows = await db
    .select()
    .from(s.appSettings)
    .where(like(s.appSettings.key, 'llm.%'));

  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const dbProvider = byKey.get(KEY_PROVIDER) as LlmProvider | undefined;
  const dbMinimax = byKey.get(KEY_MINIMAX);
  const dbOpenrouter = byKey.get(KEY_OPENROUTER);

  // Env fallback when no DB row exists yet (fresh install / pre-feature).
  const minimaxKey = dbMinimax !== undefined ? decryptSecret(dbMinimax) : config.minimaxApiKey;
  const openrouterKey =
    dbOpenrouter !== undefined ? decryptSecret(dbOpenrouter) : config.openrouterApiKey;

  const provider =
    dbProvider && (dbProvider === 'minimax' || dbProvider === 'openrouter')
      ? dbProvider
      : resolveProviderDefault(minimaxKey, openrouterKey);

  return { provider, minimaxKey, openrouterKey };
}

/** Get the current LLM settings (cached after first load). Call
 *  invalidateLlmSettings() after a settings write so the next call re-reads. */
export async function getLlmSettings(): Promise<LlmSettings> {
  if (cached) return cached;
  // Coalesce concurrent first loads (e.g. parallel agent turns at boot).
  if (!loadPromise) {
    const generation = cacheGeneration;
    loadPromise = loadSettings().then((settings) => {
      if (generation === cacheGeneration) cached = settings;
      return settings;
    });
  }
  const pending = loadPromise;
  try {
    return await pending;
  } catch (error) {
    if (loadPromise === pending) loadPromise = null;
    throw error;
  }
}

/** Drop the in-memory cache. Called by the PUT /admin/llm-settings route after
 *  a successful save so the next getLlmSettings() reflects the new values. */
export function invalidateLlmSettings(): void {
  cacheGeneration += 1;
  cached = null;
  loadPromise = null;
}

/** Read a single decrypted key directly (used by the GET route to build the
 *  masked preview without exposing plaintext). */
export async function getRawKey(which: 'minimax' | 'openrouter'): Promise<string> {
  const settings = await getLlmSettings();
  return which === 'minimax' ? settings.minimaxKey : settings.openrouterKey;
}
