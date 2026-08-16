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
import { ApiError } from '../errors';
import { resolveIdempotencyKey, runIdempotent } from '../services/idempotency.service';

const router = Router();
const LLM_SETTINGS_COMMAND = 'admin.llm-settings.update';

const KEY_PROVIDER = 'llm.provider';
const KEY_MINIMAX = 'llm.minimax_api_key';
const KEY_OPENROUTER = 'llm.openrouter_api_key';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getLlmSettingsUpdatedAt(
  q: typeof db | Tx = db,
): Promise<string | null> {
  const rows = await q.select({ updatedAt: s.appSettings.updatedAt })
    .from(s.appSettings)
    .where(sql`${s.appSettings.key} in (${KEY_PROVIDER}, ${KEY_MINIMAX}, ${KEY_OPENROUTER})`);
  const latest = rows.reduce<Date | null>(
    (current, row) => !current || row.updatedAt > current ? row.updatedAt : current,
    null,
  );
  return latest?.toISOString() ?? null;
}

function requireIdempotencyKey(req: Request): string {
  const key = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: req.body?._requestId,
  });
  if (!key) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc khi cập nhật cấu hình LLM.');
  }
  return key;
}

function parseExpectedUpdatedAt(req: Request): Date | null {
  const raw = req.header('If-Unmodified-Since')?.trim();
  if (!raw) return null;
  const expected = new Date(raw);
  if (Number.isNaN(expected.getTime())) {
    throw new ApiError(400, 'Phiên bản dữ liệu không hợp lệ.');
  }
  return expected;
}

function assertOptionalVersion(current: string | null, expected: Date | null, message: string): void {
  if (!current) return;
  if (!expected) throw new ApiError(428, message);
  if (new Date(current).getTime() !== expected.getTime()) {
    throw new ApiError(409, 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.');
  }
}

function toResponseBody(
  settings: { provider: LlmProvider; minimaxKey: string; openrouterKey: string },
  updatedAt: string | null,
): LlmSettingsResponse & { updatedAt: string | null } {
  return {
    provider: settings.provider,
    minimaxKeySet: !!settings.minimaxKey,
    openrouterKeySet: !!settings.openrouterKey,
    minimaxKeyMasked: maskKey(settings.minimaxKey),
    openrouterKeyMasked: maskKey(settings.openrouterKey),
    models: LLM_PROVIDER_MODELS,
    updatedAt,
  };
}

/** GET /api/admin/llm-settings — never returns plaintext keys. */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getLlmSettings();
  res.json(toResponseBody(settings, await getLlmSettingsUpdatedAt()));
}));

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
  const idempotencyKey = requireIdempotencyKey(req);
  const expectedUpdatedAt = parseExpectedUpdatedAt(req);

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

  const next = {
    provider,
    minimaxKey: finalMinimaxKey,
    openrouterKey: finalOpenrouterKey,
  };
  const { result, replayed } = await runIdempotent({
    endpoint: LLM_SETTINGS_COMMAND,
    idempotencyKey,
    payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
    createdBy: req.user?.userId ?? null,
    entityType: 'app-settings',
    create: async (tx) => {
      const currentUpdatedAt = await getLlmSettingsUpdatedAt(tx);
      assertOptionalVersion(
        currentUpdatedAt,
        expectedUpdatedAt,
        'Thiếu phiên bản cấu hình LLM. Vui lòng tải lại trước khi cập nhật.',
      );
      const now = new Date();
      await tx.insert(s.appSettings)
        .values([
          { key: KEY_PROVIDER, value: provider },
          { key: KEY_MINIMAX, value: encryptSecret(finalMinimaxKey) },
          { key: KEY_OPENROUTER, value: encryptSecret(finalOpenrouterKey) },
        ])
        .onConflictDoUpdate({
          target: s.appSettings.key,
          set: { value: sql`excluded.setting_value`, updatedAt: now },
        });
      return toResponseBody(next, now.toISOString());
    },
  });

  if (!replayed) {
    invalidateLlmSettings();
    invalidateActiveProvider();
  }

  res.json({ ...result, replayed });
}));

export default router;
