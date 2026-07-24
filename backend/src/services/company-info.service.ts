// Own-company profile, stored as key/value rows in app_settings under the
// `company.*` prefix. This module is the single source of truth for the field→
// setting-key map, the default values, and the row→typed-object reassembly —
// consumed by routes/config.ts (GET/PUT) and seed.ts (dev defaults). Defaults
// are intentionally empty (white-label): no company identity is baked in, and
// the admin configures the real profile on /config/company-info.
// 0109_neutralize_company_defaults.sql scrubs the legacy NePO seed rows
// (0094/0099) so fresh and existing installs alike start from a clean slate.
import { db } from '../db';
import * as s from '../db/schema';
import { like } from 'drizzle-orm';
import type { CompanyInfo } from '@tingting/shared';

/** App-facing field name → app_settings.setting_key. */
export const COMPANY_INFO_SETTING_KEYS = {
  name: 'company.name',
  address: 'company.address',
  taxCode: 'company.tax_code',
  representative: 'company.representative',
  representativeTitle: 'company.representative_title',
  bankAccount: 'company.bank_account',
  bankName: 'company.bank_name',
  phone: 'company.phone',
  email: 'company.email',
  logoStorageKey: 'company.logo_storage_key',
} as const;

export type CompanyInfoField = keyof typeof COMPANY_INFO_SETTING_KEYS;

/**
 * Factory defaults used when a row is absent (e.g. fresh DB before the admin
 * saves). Intentionally EMPTY — the app is white-label, so no company identity
 * is baked in. The admin configures the real profile on /config/company-info,
 * which is the single source of truth. Migration 0109 scrubs the legacy NePO
 * seed values (0094/0099) so installs start clean.
 */
export const COMPANY_INFO_DEFAULTS: Record<CompanyInfoField, string | null> = {
  name: '',
  address: '',
  taxCode: '',
  representative: '',
  representativeTitle: '',
  bankAccount: '',
  bankName: '',
  phone: '',
  email: '',
  logoStorageKey: null,
};

/** Reverse lookup (setting_key → field), built once at module load (O(1)). */
const KEY_TO_FIELD: Record<string, CompanyInfoField> = Object.fromEntries(
  (Object.entries(COMPANY_INFO_SETTING_KEYS) as Array<[CompanyInfoField, string]>).map(
    ([field, key]) => [key, field],
  ),
);

/** Structural row shape so this module doesn't depend on the Drizzle inferred type. */
interface SettingRow {
  key: string;
  value: string;
  updatedAt: Date;
}

/** Reassemble the typed CompanyInfo singleton from app_settings rows. Missing
 *  rows fall back to COMPANY_INFO_DEFAULTS; updatedAt is the max across the
 *  company.* rows (null when none exist). An empty `company.logo_storage_key`
 *  row is coerced back to null so "no logo" round-trips cleanly (the column
 *  is NOT NULL, so the PUT route stores '' when the admin removes the logo). */
export function companyInfoFromSettings(rows: SettingRow[]): CompanyInfo {
  const values = { ...COMPANY_INFO_DEFAULTS };
  let updatedAt: Date | null = null;
  for (const row of rows) {
    const field = KEY_TO_FIELD[row.key];
    if (!field) continue;
    values[field] = row.value;
    if (!updatedAt || row.updatedAt > updatedAt) updatedAt = row.updatedAt;
  }
  if (!values.logoStorageKey) values.logoStorageKey = null;
  // Non-logo defaults are non-null strings and rows only overwrite with
  // strings, so every field except logoStorageKey is a string at runtime.
  return { ...values, updatedAt: updatedAt?.toISOString() ?? null } as CompanyInfo;
}

/** Read the company profile straight from app_settings. Use this from any
 *  service that renders the company identity (XLSX exports, vouchers,
 *  settlements) so the read lives next to the field map — single source. */
export async function getCompanyInfo(): Promise<CompanyInfo> {
  const rows = await db.select().from(s.appSettings).where(like(s.appSettings.key, 'company.%'));
  return companyInfoFromSettings(rows);
}
