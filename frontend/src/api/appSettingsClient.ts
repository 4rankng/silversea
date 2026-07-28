/** Typed API client for the admin-owned application feature switches. */
import { api } from '../lib/api';
import type { PendingGovernanceResponse } from '../lib/governance';
import {
  EMAIL_SETTINGS_PATHS,
  type AppSettings,
  type EmailSettingsResponse,
  type EmailSettingsUpdate,
} from '@tingting/shared';

const APP_SETTINGS_PATH = '/admin/app-settings';

export const appSettingsClient = {
  getSettings: () => api.get<AppSettings>(APP_SETTINGS_PATH),
  saveSettings: (settings: AppSettings) =>
    api.put<AppSettings | PendingGovernanceResponse>(APP_SETTINGS_PATH, settings),
  getEmailSettings: () => api.get<EmailSettingsResponse>(EMAIL_SETTINGS_PATHS.base),
  saveEmailSettings: (settings: EmailSettingsUpdate) =>
    api.put<EmailSettingsResponse>(EMAIL_SETTINGS_PATHS.base, settings),
};
