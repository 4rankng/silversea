import { Router } from 'express';
import type { Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import {
  gpsSettingsUpdateSchema,
  type GpsSettingsResponse,
} from '@tingting/shared';
import { db } from '../db';
import * as schema from '../db/schema';
import { asyncHandler } from '../middleware/asyncHandler';
import { encryptSecret, maskKey } from '../services/crypto';
import {
  GPS_SETTING_KEYS,
  getGpsSettings,
  invalidateGpsSettings,
} from '../services/gps/settings';
import { invalidatePortalSession } from '../services/gps/portalClient';
import { invalidateGpsProvider } from '../services/gps/providers';
import { cacheInvalidate } from '../lib/redis';
import { ApiError } from '../errors';
import { resolveIdempotencyKey, runIdempotent } from '../services/idempotency.service';

const router = Router();
const GPS_SETTINGS_COMMAND = 'admin.gps-settings.update';

async function getGpsSettingsUpdatedAt(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db,
): Promise<string | null> {
  const rows = await q.select({ updatedAt: schema.appSettings.updatedAt })
    .from(schema.appSettings)
    .where(sql`${schema.appSettings.key} in (${GPS_SETTING_KEYS.username}, ${GPS_SETTING_KEYS.password})`);
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
  if (!key) throw new ApiError(400, 'Idempotency-Key là bắt buộc khi cập nhật tài khoản định vị.');
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

function response(settings: Awaited<ReturnType<typeof getGpsSettings>>): GpsSettingsResponse {
  return {
    username: settings.username,
    passwordSet: settings.password !== '',
    passwordMasked: maskKey(settings.password),
  };
}

/** GET /api/admin/gps-settings — password plaintext is never returned. */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    ...response(await getGpsSettings()),
    updatedAt: await getGpsSettingsUpdatedAt(),
  });
}));

/** PUT /api/admin/gps-settings — omitted password preserves the current one. */
router.put('/', asyncHandler(async (req: Request, res: Response) => {
  const data = gpsSettingsUpdateSchema.parse(req.body);
  const idempotencyKey = requireIdempotencyKey(req);
  const expectedUpdatedAt = parseExpectedUpdatedAt(req);
  const currentSettings = await getGpsSettings();
  if (data.password === undefined && !currentSettings.password) {
    res.status(400).json({ error: 'Vui lòng nhập mật khẩu Bách Khoa' });
    return;
  }

  const { result, replayed } = await runIdempotent({
    endpoint: GPS_SETTINGS_COMMAND,
    idempotencyKey,
    payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
    createdBy: req.user?.userId ?? null,
    entityType: 'app-settings',
    create: async (tx) => {
      const currentUpdatedAt = await getGpsSettingsUpdatedAt(tx);
      if (currentUpdatedAt) {
        if (!expectedUpdatedAt) {
          throw new ApiError(428, 'Thiếu phiên bản tài khoản định vị. Vui lòng tải lại trước khi cập nhật.');
        }
        if (new Date(currentUpdatedAt).getTime() !== expectedUpdatedAt.getTime()) {
          throw new ApiError(409, 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.');
        }
      }
      const now = new Date();
      const values = [
        { key: GPS_SETTING_KEYS.username, value: encryptSecret(data.username) },
        ...(data.password === undefined
          ? []
          : [{ key: GPS_SETTING_KEYS.password, value: encryptSecret(data.password) }]),
      ];
      await tx
        .insert(schema.appSettings)
        .values(values)
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: sql`excluded.setting_value`, updatedAt: now },
        });
      const finalPassword = data.password === undefined
        ? currentSettings.password
        : data.password;
      return {
        ...response({
          username: data.username,
          password: finalPassword,
        }),
        updatedAt: now.toISOString(),
      };
    },
  });

  if (!replayed) {
    invalidateGpsSettings();
    invalidatePortalSession();
    invalidateGpsProvider();
    await cacheInvalidate('gps:live');
  }
  res.json({ ...result, replayed });
}));

export default router;
