import { eq, sql } from 'drizzle-orm';
import type { EmailSettingsUpdate } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { decryptSecret, encryptSecret } from './crypto';

const RESEND_API_KEY_SETTING = 'email.resend_api_key';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface EmailSettings {
  resendApiKey: string;
}

let cached: EmailSettings | null = null;
let loadPromise: Promise<EmailSettings> | null = null;
let cacheGeneration = 0;

async function loadEmailSettings(): Promise<EmailSettings> {
  const [row] = await db
    .select({ value: s.appSettings.value })
    .from(s.appSettings)
    .where(eq(s.appSettings.key, RESEND_API_KEY_SETTING))
    .limit(1);

  return {
    resendApiKey: row ? decryptSecret(row.value) : '',
  };
}

async function loadEmailSettingsFromQuery(
  q: typeof db | Tx,
): Promise<EmailSettings> {
  const [row] = await q
    .select({ value: s.appSettings.value })
    .from(s.appSettings)
    .where(eq(s.appSettings.key, RESEND_API_KEY_SETTING))
    .limit(1);
  return {
    resendApiKey: row ? decryptSecret(row.value) : '',
  };
}

export async function getEmailSettingsUpdatedAt(
  q: typeof db | Tx = db,
): Promise<string | null> {
  const [row] = await q
    .select({ updatedAt: s.appSettings.updatedAt })
    .from(s.appSettings)
    .where(eq(s.appSettings.key, RESEND_API_KEY_SETTING))
    .limit(1);
  return row?.updatedAt?.toISOString() ?? null;
}

/** Runtime source of truth for outbound email credentials. */
export async function getEmailSettings(): Promise<EmailSettings> {
  if (cached) return cached;
  if (!loadPromise) {
    const generation = cacheGeneration;
    loadPromise = loadEmailSettings().then((settings) => {
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

/**
 * Persist a replacement or explicit clear. An omitted/blank key is a no-op so
 * an admin never clears the credential by saving an untouched password field.
 */
export async function saveEmailSettings(update: EmailSettingsUpdate): Promise<EmailSettings> {
  const settings = await db.transaction((tx) => saveEmailSettingsInTx(tx, update));
  cacheGeneration += 1;
  loadPromise = null;
  cached = settings;
  return settings;
}

export async function saveEmailSettingsInTx(
  tx: Tx,
  update: EmailSettingsUpdate,
): Promise<EmailSettings> {
  if (update.clearResendApiKey) {
    await tx.delete(s.appSettings).where(eq(s.appSettings.key, RESEND_API_KEY_SETTING));
    return { resendApiKey: '' };
  }

  const resendApiKey = update.resendApiKey?.trim();
  if (!resendApiKey) return loadEmailSettingsFromQuery(tx);

  await tx
    .insert(s.appSettings)
    .values({ key: RESEND_API_KEY_SETTING, value: encryptSecret(resendApiKey) })
    .onConflictDoUpdate({
      target: s.appSettings.key,
      set: { value: sql`excluded.setting_value`, updatedAt: new Date() },
    });

  return { resendApiKey };
}

/** Test/maintenance hook; normal writes use saveEmailSettings(). */
export function invalidateEmailSettings(): void {
  cacheGeneration += 1;
  cached = null;
  loadPromise = null;
}

export const EMAIL_SETTING_KEYS = {
  resendApiKey: RESEND_API_KEY_SETTING,
} as const;
