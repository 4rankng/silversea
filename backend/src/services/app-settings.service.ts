import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db';
import * as s from '../db/schema';
import { appSettingsSchema, type AppSettings } from '@tingting/shared';
import { cacheInvalidate } from '../lib/redis';
import { getGpsSettings, invalidateGpsSettings } from './gps/settings';
import { invalidateGpsProvider } from './gps/providers';
import { ApiError } from '../errors';
import {
  buildGovernedConfigSnapshot,
  governedConfigVersionFromUpdatedAt,
  registerGovernedCustomResource,
} from './price-config-governance.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const KEYS = {
  bot: 'app.bot_enabled',
  gps: 'app.gps_enabled',
  creditWarningThresholdDefault: 'credit.warning_threshold_default',
  creditTierOneAmountCap: 'credit.tier_one_amount_cap',
  salaryPayrollBusinessUnitId: 'salary.payroll_business_unit_id',
} as const;

export const GOVERNED_APP_SETTINGS_RESOURCE = 'app-settings-financial-policy';
const appSettingsFinancialPolicySchema = appSettingsSchema.pick({
  creditWarningThresholdDefault: true,
  creditTierOneAmountCap: true,
  salaryPayrollBusinessUnitId: true,
});

type AppSettingsFinancialPolicy = Pick<
  AppSettings,
  'creditWarningThresholdDefault' | 'creditTierOneAmountCap' | 'salaryPayrollBusinessUnitId'
>;
type GovernedFinancialPolicyState = AppSettingsFinancialPolicy & {
  updatedAt: Date | null;
};

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

export async function getAppSettingsUpdatedAt(
  q: typeof db | Tx = db,
): Promise<string | null> {
  const [row] = await q.select({ updatedAt: s.appSettings.updatedAt })
    .from(s.appSettings)
    .where(inArray(s.appSettings.key, [
      KEYS.bot,
      KEYS.gps,
      KEYS.creditWarningThresholdDefault,
      KEYS.creditTierOneAmountCap,
      KEYS.salaryPayrollBusinessUnitId,
    ]))
    .orderBy(desc(s.appSettings.updatedAt));
  return row?.updatedAt?.toISOString() ?? null;
}

async function readAppSettingsRows(q: typeof db | Tx = db) {
  return q
    .select()
    .from(s.appSettings)
    .where(inArray(s.appSettings.key, [
      KEYS.bot,
      KEYS.gps,
      KEYS.creditWarningThresholdDefault,
      KEYS.creditTierOneAmountCap,
      KEYS.salaryPayrollBusinessUnitId,
    ]));
}

function settingsFromRows(
  rows: Array<{ key: string; value: string | null }>,
  gpsEnabledDefault: boolean,
): AppSettings {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    botEnabled: parseBooleanSetting(values.get(KEYS.bot) ?? undefined, config.botEnabled),
    gpsEnabled: parseBooleanSetting(values.get(KEYS.gps) ?? undefined, gpsEnabledDefault),
    creditWarningThresholdDefault: parseNumberSetting(values.get(KEYS.creditWarningThresholdDefault) ?? undefined, 0.8),
    creditTierOneAmountCap: Math.trunc(parseNumberSetting(values.get(KEYS.creditTierOneAmountCap) ?? undefined, 0)),
    salaryPayrollBusinessUnitId: (() => {
      const value = Math.trunc(parseNumberSetting(values.get(KEYS.salaryPayrollBusinessUnitId) ?? undefined, 0));
      return value > 0 ? value : null;
    })(),
  };
}

export async function getAppSettingsFrom(
  q: typeof db | Tx,
): Promise<AppSettings> {
  const rows = await readAppSettingsRows(q);
  // Default gpsEnabled to whether credentials are configured, so existing
  // deployments migrate cleanly: those with creds stay ON, those without start OFF.
  const creds = await getGpsSettings();
  const gpsEnabledDefault = !!(creds.username && creds.password);
  return settingsFromRows(rows, gpsEnabledDefault);
}

export async function getAppSettings(): Promise<AppSettings> {
  cached = await getAppSettingsFrom(db);
  return cached;
}

export async function getGovernedFinancialPolicyState(
  q: typeof db | Tx = db,
): Promise<GovernedFinancialPolicyState> {
  const rows = await q.select({
    key: s.appSettings.key,
    value: s.appSettings.value,
    updatedAt: s.appSettings.updatedAt,
  }).from(s.appSettings)
    .where(inArray(s.appSettings.key, [
      KEYS.creditWarningThresholdDefault,
      KEYS.creditTierOneAmountCap,
      KEYS.salaryPayrollBusinessUnitId,
    ]));
  const settings = settingsFromRows(rows, false);
  const updatedAt = rows.reduce<Date | null>((latest, row) => {
    if (!(row.updatedAt instanceof Date)) return latest;
    if (!latest || row.updatedAt.getTime() > latest.getTime()) return row.updatedAt;
    return latest;
  }, null);
  return {
    creditWarningThresholdDefault: settings.creditWarningThresholdDefault,
    creditTierOneAmountCap: settings.creditTierOneAmountCap,
    salaryPayrollBusinessUnitId: settings.salaryPayrollBusinessUnitId,
    updatedAt,
  };
}

function mergeDirectSettings(
  current: AppSettings,
  next: AppSettings,
): AppSettings {
  return {
    ...current,
    botEnabled: next.botEnabled,
    gpsEnabled: next.gpsEnabled,
  };
}

function mergeFinancialPolicySettings(
  current: AppSettings,
  next: AppSettingsFinancialPolicy,
): AppSettings {
  return {
    ...current,
    creditWarningThresholdDefault: next.creditWarningThresholdDefault,
    creditTierOneAmountCap: next.creditTierOneAmountCap,
    salaryPayrollBusinessUnitId: next.salaryPayrollBusinessUnitId,
  };
}

async function validateFinancialPolicySettings(
  tx: Tx,
  next: AppSettingsFinancialPolicy,
): Promise<void> {
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
    const [linkedDriver] = await tx.selectDistinct({ driverId: s.drivers.id })
      .from(s.drivers)
      .leftJoin(s.users, eq(s.users.id, s.drivers.userId))
      .innerJoin(
        s.userBusinessUnitLinks,
        eq(s.userBusinessUnitLinks.userId, s.drivers.userId),
      )
      .where(and(
        eq(s.userBusinessUnitLinks.businessUnitId, next.salaryPayrollBusinessUnitId),
        isNull(s.drivers.deletedAt),
        eq(s.drivers.status, 'ACTIVE'),
        or(isNull(s.users.id), eq(s.users.status, 'ACTIVE')),
      ))
      .limit(1);
    if (!linkedDriver) {
      throw new ApiError(400, 'Đơn vị tính lương phải có ít nhất một lái xe đang hoạt động');
    }
  }
}

async function upsertAppSettingsEntries(
  tx: Tx,
  entries: ReadonlyArray<readonly [string, string]>,
): Promise<string> {
  const now = new Date();
  for (const [key, value] of entries) {
    await tx
      .insert(s.appSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: s.appSettings.key,
        set: { value, updatedAt: now },
      });
  }
  return now.toISOString();
}

export async function saveAppSettingsInTx(
  tx: Tx,
  previous: AppSettings,
  next: AppSettings,
): Promise<{ settings: AppSettings; updatedAt: string }> {
  await validateFinancialPolicySettings(tx, {
    creditWarningThresholdDefault: next.creditWarningThresholdDefault,
    creditTierOneAmountCap: next.creditTierOneAmountCap,
    salaryPayrollBusinessUnitId: next.salaryPayrollBusinessUnitId,
  });
  const updatedAt = await upsertAppSettingsEntries(tx, [
    [KEYS.bot, String(next.botEnabled)],
    [KEYS.gps, String(next.gpsEnabled)],
    [KEYS.creditWarningThresholdDefault, String(next.creditWarningThresholdDefault)],
    [KEYS.creditTierOneAmountCap, String(next.creditTierOneAmountCap)],
    [KEYS.salaryPayrollBusinessUnitId, String(next.salaryPayrollBusinessUnitId ?? '')],
  ]);
  void previous;
  return { settings: next, updatedAt };
}

export async function saveDirectAppSettingsInTx(
  tx: Tx,
  current: AppSettings,
  next: AppSettings,
): Promise<{ settings: AppSettings; updatedAt: string }> {
  const merged = mergeDirectSettings(current, next);
  const updatedAt = await upsertAppSettingsEntries(tx, [
    [KEYS.bot, String(merged.botEnabled)],
    [KEYS.gps, String(merged.gpsEnabled)],
  ]);
  return { settings: merged, updatedAt };
}

export async function saveFinancialPolicyAppSettingsInTx(
  tx: Tx,
  current: AppSettings,
  next: AppSettingsFinancialPolicy,
): Promise<{ settings: AppSettings; updatedAt: string }> {
  await validateFinancialPolicySettings(tx, next);
  const merged = mergeFinancialPolicySettings(current, next);
  const updatedAt = await upsertAppSettingsEntries(tx, [
    [KEYS.creditWarningThresholdDefault, String(merged.creditWarningThresholdDefault)],
    [KEYS.creditTierOneAmountCap, String(merged.creditTierOneAmountCap)],
    [KEYS.salaryPayrollBusinessUnitId, String(merged.salaryPayrollBusinessUnitId ?? '')],
  ]);
  return { settings: merged, updatedAt };
}

export async function applySavedAppSettings(
  previous: AppSettings,
  next: AppSettings,
): Promise<AppSettings> {
  cached = next;
  if (previous.botEnabled !== next.botEnabled) notifyChanged(next);
  if (previous.gpsEnabled !== next.gpsEnabled) {
    invalidateGpsSettings();
    invalidateGpsProvider();
    await cacheInvalidate('gps:live');
  }
  return next;
}

export async function saveAppSettings(next: AppSettings): Promise<AppSettings> {
  const previous = await getAppSettings();
  await db.transaction((tx) => saveAppSettingsInTx(tx, previous, next));
  return applySavedAppSettings(previous, next);
}

function assertGovernedFinancialPolicyUnchanged(
  beforeFingerprint: string | null,
  originalVersion: number,
  current: GovernedFinancialPolicyState,
): void {
  const currentSnapshot = buildGovernedConfigSnapshot(GOVERNED_APP_SETTINGS_RESOURCE, current);
  const currentVersion = current.updatedAt ? governedConfigVersionFromUpdatedAt(current.updatedAt) : 0;
  if (currentVersion !== originalVersion || currentSnapshot.fingerprint !== beforeFingerprint) {
    throw new ApiError(409, 'Cài đặt tài chính đã được người khác cập nhật. Vui lòng tải lại trước khi phê duyệt.');
  }
}

registerGovernedCustomResource({
  resource: GOVERNED_APP_SETTINGS_RESOURCE,
  reasonLabel: 'chính sách tài chính ứng dụng',
  apply: async (tx, action, before, after) => {
    const payload = appSettingsFinancialPolicySchema.parse(after.data);
    const currentGoverned = await getGovernedFinancialPolicyState(tx);
    assertGovernedFinancialPolicyUnchanged(
      before.fingerprint,
      action.originalVersion,
      currentGoverned,
    );
    const current = await getAppSettingsFrom(tx);
    const saved = await saveFinancialPolicyAppSettingsInTx(tx, current, payload);
    return {
      applicationResult: {
        resource: GOVERNED_APP_SETTINGS_RESOURCE,
        operation: currentGoverned.updatedAt ? 'UPDATE' : 'CREATE',
        subjectId: null,
        resultingVersion: governedConfigVersionFromUpdatedAt(new Date(saved.updatedAt)),
      },
    };
  },
});
