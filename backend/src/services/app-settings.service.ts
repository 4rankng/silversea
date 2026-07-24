import { inArray } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db';
import * as s from '../db/schema';
import type { AppSettings } from '@tingting/shared';

const KEYS = { bot: 'app.bot_enabled', tutorial: 'onboarding.tutorial_enabled' } as const;
let cached: AppSettings | null = null;
const listeners = new Set<(settings: AppSettings) => void>();

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
  const rows = await db.select().from(s.appSettings).where(inArray(s.appSettings.key, [KEYS.bot, KEYS.tutorial]));
  const values = new Map(rows.map((row) => [row.key, row.value]));
  cached = {
    botEnabled: values.has(KEYS.bot) ? values.get(KEYS.bot) === 'true' : config.botEnabled,
    tutorialEnabled: values.get(KEYS.tutorial) !== 'false',
  };
  return cached;
}

export async function saveAppSettings(next: AppSettings): Promise<AppSettings> {
  const previous = await getAppSettings();
  await db.transaction(async (tx) => {
    for (const [key, enabled] of [[KEYS.bot, next.botEnabled], [KEYS.tutorial, next.tutorialEnabled]] as const) {
      await tx.insert(s.appSettings).values({ key, value: enabled ? 'true' : 'false' }).onConflictDoUpdate({ target: s.appSettings.key, set: { value: enabled ? 'true' : 'false', updatedAt: new Date() } });
    }
  });
  cached = next;
  if (previous.botEnabled !== next.botEnabled) notifyChanged(next);
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
