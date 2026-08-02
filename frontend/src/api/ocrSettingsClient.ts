// Typed ADMIN client for the OCR runtime toggle and write-only provider keys.
// Plaintext credentials are never returned by the API; the read shape exposes
// only masked previews and whether each provider key is configured.
import { api } from '../lib/api';
import { OCR_SETTINGS_PATHS } from '@tingting/shared';
import type { OcrSettingsResponse, OcrSettingsUpdate } from '@tingting/shared';

export const ocrSettingsClient = {
  getSettings: () => api.get<OcrSettingsResponse>(OCR_SETTINGS_PATHS.base),
  saveSettings: (data: OcrSettingsUpdate) =>
    api.put<OcrSettingsResponse>(OCR_SETTINGS_PATHS.base, data),
};
