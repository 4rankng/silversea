import { GPS_SETTINGS_PATHS } from '@tingting/shared';
import type { GpsSettingsResponse, GpsSettingsUpdate } from '@tingting/shared';
import { api } from '../lib/api';

export const gpsSettingsClient = {
  getSettings: () => api.get<GpsSettingsResponse>(GPS_SETTINGS_PATHS.base),
  saveSettings: (data: GpsSettingsUpdate) =>
    api.put<GpsSettingsResponse>(GPS_SETTINGS_PATHS.base, data),
};
