import { like } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { decryptSecret } from './crypto';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OcrSettings {
  enabled: boolean;
  openrouterKey: string;
}

export const OCR_SETTING_KEYS = {
  enabled: 'ocr.enabled',
  openrouterApiKey: 'ocr.openrouter_api_key',
} as const;

let cached: OcrSettings | null = null;
let loadPromise: Promise<OcrSettings> | null = null;
let cacheGeneration = 0;

function resolveEnabledDefault(settings: Pick<OcrSettings, 'openrouterKey'>): boolean {
  // OCR is OpenRouter-only — the key's presence enables OCR by default.
  return settings.openrouterKey !== '';
}

export async function getOcrSettingsFrom(
  q: typeof db | Tx,
): Promise<OcrSettings> {
  const rows = await q
    .select()
    .from(s.appSettings)
    .where(like(s.appSettings.key, 'ocr.%'));

  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  let openrouterKey = config.openrouterApiKey;
  if (byKey.has(OCR_SETTING_KEYS.openrouterApiKey)) {
    try {
      openrouterKey = decryptSecret(byKey.get(OCR_SETTING_KEYS.openrouterApiKey) ?? '');
    } catch {
      // A rotated/legacy encryption key must not brick OCR reads with 500s —
      // degrade to "not configured" so admins see the settings screen and can
      // re-save the key instead of every OCR route failing.
      console.warn('[ocr-settings] stored openrouter key failed to decrypt — treating as unset (encryption key changed?)');
      openrouterKey = '';
    }
  }
  const rawEnabled = byKey.get(OCR_SETTING_KEYS.enabled);

  return {
    enabled: rawEnabled === undefined
      ? resolveEnabledDefault({ openrouterKey })
      : rawEnabled === 'true',
    openrouterKey,
  };
}

export async function getOcrSettings(): Promise<OcrSettings> {
  if (cached) return cached;
  if (!loadPromise) {
    const generation = cacheGeneration;
    loadPromise = getOcrSettingsFrom(db).then((settings) => {
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

export function invalidateOcrSettings(): void {
  cacheGeneration += 1;
  cached = null;
  loadPromise = null;
}

export function ocrHasAvailableKey(
  settings: Pick<OcrSettings, 'openrouterKey'>,
): boolean {
  return settings.openrouterKey !== '';
}
