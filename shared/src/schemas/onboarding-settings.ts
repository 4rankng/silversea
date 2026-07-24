/**
 * Onboarding settings wire contract (shared).
 *
 * The admin on/off master switch for the onboarding tutorial. Mirrors the
 * llm-settings.ts shape (path constants + request/response types) but for a
 * single boolean.
 *
 * Storage: one app_settings row (`onboarding.tutorial_enabled`).
 * Exposure: GET returns the current value; PUT sets it. The value is also
 * surfaced app-wide via the /auth/me response field `onboardingEnabled` so the
 * frontend doesn't need a separate query to gate the checklist/tour UI.
 */

export const ONBOARDING_SETTINGS_PATHS = {
  base: '/admin/onboarding-settings',
} as const;

export interface OnboardingSettingsResponse {
  /** Whether the onboarding tutorial (checklist + tours) is enabled app-wide. */
  tutorialEnabled: boolean;
}

export interface OnboardingSettingsUpdate {
  tutorialEnabled: boolean;
}
