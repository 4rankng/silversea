import { like } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { decryptSecret } from './crypto';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OcrSettings {
  enabled: boolean;
  openrouterKey: string;
  geminiKey: string;
}

export const OCR_SETTING_KEYS = {
  enabled: 'ocr.enabled',
  openrouterApiKey: 'ocr.openrouter_api_key',
  geminiApiKey: 'ocr.gemini_api_key',
} as const;

let cached: OcrSettings | null = null;
let loadPromise: Promise<OcrSettings> | null = null;
let cacheGeneration = 0;

function resolveEnabledDefault(settings: Pick<OcrSettings, 'openrouterKey' | 'geminiKey'>): boolean {
  // Gemini is retired from the OCR chain — only OpenRouter key enables OCR.
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
  const openrouterKey = byKey.has(OCR_SETTING_KEYS.openrouterApiKey)
    ? decryptSecret(byKey.get(OCR_SETTING_KEYS.openrouterApiKey) ?? '')
    : config.openrouterApiKey;
  const geminiKey = byKey.has(OCR_SETTING_KEYS.geminiApiKey)
    ? decryptSecret(byKey.get(OCR_SETTING_KEYS.geminiApiKey) ?? '')
    : config.geminiApiKey;
  const rawEnabled = byKey.get(OCR_SETTING_KEYS.enabled);

  return {
    enabled: rawEnabled === undefined
      ? resolveEnabledDefault({ openrouterKey, geminiKey })
      : rawEnabled === 'true',
    openrouterKey,
    geminiKey,
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
  settings: Pick<OcrSettings, 'openrouterKey' | 'geminiKey'>,
): boolean {
  // Gemini is retired from the OCR chain — only OpenRouter key is checked.
  return settings.openrouterKey !== '';
}
