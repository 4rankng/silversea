/**
 * Onboarding master-switch settings (DB-backed admin toggle).
 *
 * Stores a single boolean in `app_settings` under key
 * `onboarding.tutorial_enabled`. When false, the whole onboarding subsystem
 * (checklist panel + tour chrome + tour launch) is hidden app-wide — the admin
 * "turns off the onboarding tutorial".
 *
 * Read path is cached (mirrors services/llm/settings.ts): the first call loads
 * the DB row; `getOnboardingEnabled()` returns the cached value.
 * `invalidateOnboardingSettings()` is called after a settings write so the next
 * /auth/me (and any in-process reader) sees the new value immediately — no
 * restart.
 *
 * Default: enabled (true) when the row is absent, so existing deployments keep
 * onboarding on until an admin explicitly turns it off.
 */
import { getAppSettings, setTutorialEnabled as saveTutorialEnabled } from './app-settings.service';

/** True when the onboarding tutorial is enabled (cached after first load). */
export async function getOnboardingEnabled(): Promise<boolean> {
  return (await getAppSettings()).tutorialEnabled;
}

/** Drop the cache so the next read re-loads from the DB. Call after a write. */
export function invalidateOnboardingSettings(): void {
  // Kept for the legacy endpoint. The unified service refreshes on every save.
}

/** Set the onboarding toggle. Persists + invalidates the cache. */
export async function setOnboardingEnabled(enabled: boolean): Promise<void> {
  await saveTutorialEnabled(enabled);
}
