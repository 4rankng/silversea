import { Router } from 'express';
import type { Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import {
  ocrSettingsUpdateSchema,
  type OcrSettingsResponse,
} from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { asyncHandler } from '../middleware/asyncHandler';
import { ApiError } from '../errors';
import { encryptSecret, maskKey } from '../services/crypto';
import {
  OCR_SETTING_KEYS,
  getOcrSettings,
  getOcrSettingsFrom,
  invalidateOcrSettings,
  ocrHasAvailableKey,
  type OcrSettings,
} from '../services/ocr-settings.service';
import { resolveIdempotencyKey, runIdempotent } from '../services/idempotency.service';

const router = Router();
const OCR_SETTINGS_COMMAND = 'admin.ocr-settings.update';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getOcrSettingsUpdatedAt(
  q: typeof db | Tx = db,
): Promise<string | null> {
  const rows = await q.select({ updatedAt: s.appSettings.updatedAt })
    .from(s.appSettings)
    .where(sql`${s.appSettings.key} in (
      ${OCR_SETTING_KEYS.enabled},
      ${OCR_SETTING_KEYS.openrouterApiKey},
      ${OCR_SETTING_KEYS.geminiApiKey}
    )`);
  const latest = rows.reduce<Date | null>(
    (current, row) => (!current || row.updatedAt > current ? row.updatedAt : current),
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
    throw new ApiError(400, 'Idempotency-Key là bắt buộc khi cập nhật cấu hình OCR.');
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
  settings: OcrSettings,
  updatedAt: string | null,
): OcrSettingsResponse & { updatedAt: string | null } {
  return {
    enabled: settings.enabled,
    openrouterKeySet: settings.openrouterKey !== '',
    geminiKeySet: settings.geminiKey !== '',
    openrouterKeyMasked: maskKey(settings.openrouterKey),
    geminiKeyMasked: maskKey(settings.geminiKey),
    updatedAt,
  };
}

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(toResponseBody(await getOcrSettings(), await getOcrSettingsUpdatedAt()));
  }),
);

router.put(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const data = ocrSettingsUpdateSchema.parse(req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    const expectedUpdatedAt = parseExpectedUpdatedAt(req);

    const { result, replayed } = await runIdempotent({
      endpoint: OCR_SETTINGS_COMMAND,
      idempotencyKey,
      payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
      createdBy: req.user?.userId ?? null,
      entityType: 'app-settings',
      create: async (tx) => {
        // Serialize every OCR-settings mutation on one stable resource lock.
        // The idempotency service already locks per request key; this second
        // lock prevents two different keys with the same version from merging
        // stale provider values and silently overwriting each other.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${OCR_SETTINGS_COMMAND}, 0))`,
        );
        const currentUpdatedAt = await getOcrSettingsUpdatedAt(tx);
        assertOptionalVersion(
          currentUpdatedAt,
          expectedUpdatedAt,
          'Thiếu phiên bản cấu hình OCR. Vui lòng tải lại trước khi cập nhật.',
        );
        const currentSettings = await getOcrSettingsFrom(tx);
        const finalOpenrouterKey = data.clearOpenRouterKey
          ? ''
          : data.openrouterApiKey && data.openrouterApiKey.trim() !== ''
            ? data.openrouterApiKey.trim()
            : currentSettings.openrouterKey;
        const finalGeminiKey = data.clearGeminiKey
          ? ''
          : data.geminiApiKey && data.geminiApiKey.trim() !== ''
            ? data.geminiApiKey.trim()
            : currentSettings.geminiKey;
        const next: OcrSettings = {
          enabled: data.enabled,
          openrouterKey: finalOpenrouterKey,
          geminiKey: finalGeminiKey,
        };
        if (next.enabled && !ocrHasAvailableKey(next)) {
          throw new ApiError(400, 'Không thể bật OCR khi chưa có API key OpenRouter hoặc Gemini.');
        }
        const now = new Date();
        await tx.insert(s.appSettings)
          .values([
            { key: OCR_SETTING_KEYS.enabled, value: next.enabled ? 'true' : 'false', updatedAt: now },
            { key: OCR_SETTING_KEYS.openrouterApiKey, value: encryptSecret(next.openrouterKey), updatedAt: now },
            { key: OCR_SETTING_KEYS.geminiApiKey, value: encryptSecret(next.geminiKey), updatedAt: now },
          ])
          .onConflictDoUpdate({
            target: s.appSettings.key,
            set: { value: sql`excluded.setting_value`, updatedAt: now },
          });
        return toResponseBody(next, now.toISOString());
      },
    });

    if (!replayed) {
      invalidateOcrSettings();
    }

    res.json({ ...result, replayed });
  }),
);

export default router;
