import { and, eq, inArray } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db';
import * as s from '../db/schema';
import type { AppSettings } from '@tingting/shared';
import { cacheInvalidate } from '../lib/redis';
import { getGpsSettings, invalidateGpsSettings } from './gps/settings';
import { invalidateGpsProvider } from './gps/providers';
import { ApiError } from '../errors';

const KEYS = {
  bot: 'app.bot_enabled',
  tutorial: 'onboarding.tutorial_enabled',
  gps: 'app.gps_enabled',
  creditWarningThresholdDefault: 'credit.warning_threshold_default',
  creditTierOneAmountCap: 'credit.tier_one_amount_cap',
  salaryPayrollBusinessUnitId: 'salary.payroll_business_unit_id',
} as const;
let cached: AppSettings | null = null;
const listeners = new Set<(settings: AppSettings) => void>();

function parseBooleanSetting(value: string | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value === 'true';
}

function parseNumberSetting(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Subscribe to in-process runtime changes (used to stop active bot chats). */
export function onAppSettingsChanged(listener: (settings: AppSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyChanged(settings: AppSettings): void {
  for (const listener of listeners) listener(settings);
}

export async function getAppSettings(): Promise<AppSettings> {
  if (cached) return cached;
  const rows = await db
    .select()
    .from(s.appSettings)
    .where(inArray(s.appSettings.key, [
      KEYS.bot,
      KEYS.tutorial,
      KEYS.gps,
      KEYS.creditWarningThresholdDefault,
      KEYS.creditTierOneAmountCap,
      KEYS.salaryPayrollBusinessUnitId,
    ]));
  const values = new Map(rows.map((row) => [row.key, row.value]));
  // Default gpsEnabled to whether credentials are configured, so existing
  // deployments migrate cleanly: those with creds stay ON, those without start OFF.
  const creds = await getGpsSettings();
  const gpsEnabledDefault = !!(creds.username && creds.password);
  cached = {
    botEnabled: parseBooleanSetting(values.get(KEYS.bot), config.botEnabled),
    tutorialEnabled: parseBooleanSetting(values.get(KEYS.tutorial), true),
    gpsEnabled: parseBooleanSetting(values.get(KEYS.gps), gpsEnabledDefault),
    creditWarningThresholdDefault: parseNumberSetting(values.get(KEYS.creditWarningThresholdDefault), 0.8),
    creditTierOneAmountCap: Math.trunc(parseNumberSetting(values.get(KEYS.creditTierOneAmountCap), 0)),
    salaryPayrollBusinessUnitId: (() => {
      const value = Math.trunc(parseNumberSetting(values.get(KEYS.salaryPayrollBusinessUnitId), 0));
      return value > 0 ? value : null;
    })(),
  };
  return cached;
}

export async function saveAppSettings(next: AppSettings): Promise<AppSettings> {
  const previous = await getAppSettings();
  await db.transaction(async (tx) => {
    if (next.salaryPayrollBusinessUnitId != null) {
      const [unit] = await tx.select({ id: s.businessUnits.id })
        .from(s.businessUnits)
        .where(and(
          eq(s.businessUnits.id, next.salaryPayrollBusinessUnitId),
          eq(s.businessUnits.status, 'ACTIVE'),
        ))
        .limit(1);
      if (!unit) {
        throw new ApiError(400, 'Đơn vị tính lương không tồn tại hoặc đã ngừng hoạt động');
      }
    }
    for (const [key, value] of [
      [KEYS.bot, next.botEnabled],
      [KEYS.tutorial, next.tutorialEnabled],
      [KEYS.gps, next.gpsEnabled],
      [KEYS.creditWarningThresholdDefault, next.creditWarningThresholdDefault],
      [KEYS.creditTierOneAmountCap, next.creditTierOneAmountCap],
      [KEYS.salaryPayrollBusinessUnitId, next.salaryPayrollBusinessUnitId ?? ''],
    ] as const) {
      await tx
        .insert(s.appSettings)
        .values({ key, value: String(value) })
        .onConflictDoUpdate({
          target: s.appSettings.key,
          set: { value: String(value), updatedAt: new Date() },
        });
    }
  });
  cached = next;
  if (previous.botEnabled !== next.botEnabled) notifyChanged(next);
  // A gps toggle flip must refresh the live-fleet cache immediately — otherwise
  // the portal poller keeps serving the old (pre-flip) vehicle fixes.
  if (previous.gpsEnabled !== next.gpsEnabled) {
    invalidateGpsSettings();
    invalidateGpsProvider();
    await cacheInvalidate('gps:live');
  }
  return next;
}

/**
 * Compatibility write for the former onboarding-only admin endpoint. Updating
 * this one key directly prevents an older client from accidentally restoring a
 * bot setting that was changed at the same time in the unified settings page.
 */
export async function setTutorialEnabled(tutorialEnabled: boolean): Promise<void> {
  await db
    .insert(s.appSettings)
    .values({ key: KEYS.tutorial, value: tutorialEnabled ? 'true' : 'false' })
    .onConflictDoUpdate({
      target: s.appSettings.key,
      set: { value: tutorialEnabled ? 'true' : 'false', updatedAt: new Date() },
    });

  cached = cached ? { ...cached, tutorialEnabled } : null;
}
