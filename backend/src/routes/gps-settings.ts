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

const router = Router();

function response(settings: Awaited<ReturnType<typeof getGpsSettings>>): GpsSettingsResponse {
  return {
    username: settings.username,
    passwordSet: settings.password !== '',
    passwordMasked: maskKey(settings.password),
  };
}

/** GET /api/admin/gps-settings — password plaintext is never returned. */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  res.json(response(await getGpsSettings()));
}));

/** PUT /api/admin/gps-settings — omitted password preserves the current one. */
router.put('/', asyncHandler(async (req: Request, res: Response) => {
  const data = gpsSettingsUpdateSchema.parse(req.body);

  if (data.password === undefined && !(await getGpsSettings()).password) {
    res.status(400).json({ error: 'Vui lòng nhập mật khẩu Bách Khoa' });
    return;
  }

  const values = [
    { key: GPS_SETTING_KEYS.username, value: encryptSecret(data.username) },
    ...(data.password === undefined
      ? []
      : [{ key: GPS_SETTING_KEYS.password, value: encryptSecret(data.password) }]),
  ];

  await db
    .insert(schema.appSettings)
    .values(values)
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: sql`excluded.setting_value`, updatedAt: new Date() },
    });

  invalidateGpsSettings();
  invalidatePortalSession();
  invalidateGpsProvider();
  await cacheInvalidate('gps:live');
  res.json(response(await getGpsSettings()));
}));

export default router;
