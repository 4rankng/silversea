/** Typed API client for the admin-owned application feature switches. */
import { api } from '../lib/api';
import type { AppSettings } from '@tingting/shared';

const APP_SETTINGS_PATH = '/admin/app-settings';

export const appSettingsClient = {
  getSettings: () => api.get<AppSettings>(APP_SETTINGS_PATH),
  saveSettings: (settings: AppSettings) => api.put<AppSettings>(APP_SETTINGS_PATH, settings),
};
