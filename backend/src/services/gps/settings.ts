import { like } from 'drizzle-orm';
import { config } from '../../config';
import { db } from '../../db';
import * as schema from '../../db/schema';
import { decryptSecret } from '../crypto';

export interface GpsSettings {
  username: string;
  password: string;
}

export const GPS_SETTING_KEYS = {
  username: 'gps.bach_khoa_username',
  password: 'gps.bach_khoa_password',
} as const;

let cached: GpsSettings | null = null;
let loadPromise: Promise<GpsSettings> | null = null;
let cacheGeneration = 0;

async function loadSettings(): Promise<GpsSettings> {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(like(schema.appSettings.key, 'gps.bach_khoa_%'));
  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  const storedUsername = byKey.get(GPS_SETTING_KEYS.username);
  const storedPassword = byKey.get(GPS_SETTING_KEYS.password);

  return {
    username: storedUsername === undefined
      ? config.bachKhoaUsername
      : decryptSecret(storedUsername),
    password: storedPassword === undefined
      ? config.bachKhoaPassword
      : decryptSecret(storedPassword),
  };
}

/** Runtime source of truth with env fallback for deployments not yet migrated. */
export async function getGpsSettings(): Promise<GpsSettings> {
  if (cached) return cached;
  if (!loadPromise) {
    const generation = cacheGeneration;
    loadPromise = loadSettings().then((settings) => {
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

export function invalidateGpsSettings(): void {
  cacheGeneration += 1;
  cached = null;
  loadPromise = null;
}
