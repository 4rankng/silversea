/**
 * Admin LLM provider settings — pick which provider the chatbot agent uses
 * (MiniMax or OpenRouter) and store that provider's API key.
 *
 * Keys are AES-256-GCM encrypted at rest (services/crypto.ts) and NEVER
 * returned in plaintext — the GET response carries only a masked preview +
 * a `*KeySet` boolean.
 *
 * RBAC: the `llm-settings` Casbin resource has NO policy row — only the ADMIN
 * wildcard (`p, ADMIN, *, *`) matches, so every non-ADMIN role gets 403.
 * `requireRoles(Role.ADMIN)` is applied at mount time as belt-and-suspenders.
 *
 * Storage: three app_settings rows under the `llm.*` prefix
 * (llm.provider / llm.minimax_api_key / llm.openrouter_api_key).
 *
 * Activation: after a successful PUT we invalidate the in-memory caches
 * (settings + provider), so the next agent turn picks up the new provider/key
 * immediately — no process restart.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { asyncHandler } from '../middleware/asyncHandler';
import {
  llmSettingsUpdateSchema,
  LLM_PROVIDER_MODELS,
  type LlmProvider,
  type LlmSettingsResponse,
} from '@tingting/shared';
import { encryptSecret, maskKey } from '../services/crypto';
import {
  getLlmSettings,
  invalidateLlmSettings,
} from '../services/llm/settings';
import { invalidateActiveProvider } from '../services/llm/provider-registry';

const router = Router();

const KEY_PROVIDER = 'llm.provider';
const KEY_MINIMAX = 'llm.minimax_api_key';
const KEY_OPENROUTER = 'llm.openrouter_api_key';

/** GET /api/admin/llm-settings — never returns plaintext keys. */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getLlmSettings();
  const body: LlmSettingsResponse = {
    provider: settings.provider,
    minimaxKeySet: !!settings.minimaxKey,
    openrouterKeySet: !!settings.openrouterKey,
    minimaxKeyMasked: maskKey(settings.minimaxKey),
    openrouterKeyMasked: maskKey(settings.openrouterKey),
    models: LLM_PROVIDER_MODELS,
  };
  res.json(body);
}));

/** Upsert one llm.* setting row atomically. */
function upsertRow(key: string, value: string) {
  return db
    .insert(s.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: s.appSettings.key,
      set: { value: sql`excluded.setting_value`, updatedAt: new Date() },
    });
}

/** PUT /api/admin/llm-settings
 *  - provider: always required.
 *  - minimaxApiKey / openrouterApiKey: optional. An empty/whitespace string OR
 *    undefined means "leave the stored key untouched" (so the admin can switch
 *    provider or save without re-entering the key). To wipe a key, send the
 *    matching clear*Key: true boolean.
 *  - Provider must have a key to be selectable: validated post-write so an
 *    admin can set the key + provider in one save. */
router.put('/', asyncHandler(async (req: Request, res: Response) => {
  const data = llmSettingsUpdateSchema.parse(req.body);
  const settings = await getLlmSettings();

  // Resolve the final key values, in precedence order:
  //   1. explicit clear flag → '' (wipe)
  //   2. a non-empty new value in the request → use it (covers first-time entry
  //      AND replacement)
  //   3. otherwise → keep the stored key (may be '')
  // An empty/whitespace/absent key field is "leave untouched", so the admin can
  // switch provider or re-save without re-entering the key.
  const finalMinimaxKey = data.clearMinimaxKey
    ? ''
    : data.minimaxApiKey && data.minimaxApiKey.trim() !== ''
      ? data.minimaxApiKey.trim()
      : settings.minimaxKey;

  const finalOpenrouterKey = data.clearOpenRouterKey
    ? ''
    : data.openrouterApiKey && data.openrouterApiKey.trim() !== ''
      ? data.openrouterApiKey.trim()
      : settings.openrouterKey;

  const provider = data.provider as LlmProvider;

  // Guard: the chosen provider must have a key (either just-entered or already
  // stored). Lets the admin set key + provider in a single save while
  // preventing an empty-provider save that would 503 every agent turn.
  const chosenKey = provider === 'openrouter' ? finalOpenrouterKey : finalMinimaxKey;
  if (!chosenKey) {
    return res.status(400).json({
      error: `Provider "${provider}" chưa có API key. Vui lòng nhập key trước khi chọn.`,
    });
  }

  // Persist. Keys are encrypted; provider is a plaintext enum.
  await Promise.all([
    upsertRow(KEY_PROVIDER, provider),
    upsertRow(KEY_MINIMAX, encryptSecret(finalMinimaxKey)),
    upsertRow(KEY_OPENROUTER, encryptSecret(finalOpenrouterKey)),
  ]);

  // Hot-swap: drop the in-memory caches so the next agent turn reads fresh.
  invalidateLlmSettings();
  invalidateActiveProvider();

  const fresh = await getLlmSettings();
  const body: LlmSettingsResponse = {
    provider: fresh.provider,
    minimaxKeySet: !!fresh.minimaxKey,
    openrouterKeySet: !!fresh.openrouterKey,
    minimaxKeyMasked: maskKey(fresh.minimaxKey),
    openrouterKeyMasked: maskKey(fresh.openrouterKey),
    models: LLM_PROVIDER_MODELS,
  };
  res.json(body);
}));

export default router;
