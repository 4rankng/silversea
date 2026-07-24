// Typed API client for the ADMIN LLM provider settings endpoints (MiniMax /
// OpenRouter selection + API keys). The path is the absolute `/admin/llm-settings`
// mount (NOT under the /api/config catch-all), mirroring chatbotMetricsClient.
//
// Security: the GET response NEVER contains plaintext keys — only a masked
// preview + a `*KeySet` boolean. The PUT omits a key field to leave the stored
// value untouched, and uses `clear*Key: true` to wipe one.
import { api } from '../lib/api';
import { LLM_SETTINGS_PATHS } from '@tingting/shared';
import type { LlmSettingsResponse, LlmSettingsUpdate } from '@tingting/shared';

export const llmSettingsClient = {
  getSettings: () => api.get<LlmSettingsResponse>(LLM_SETTINGS_PATHS.base),
  saveSettings: (data: LlmSettingsUpdate) =>
    api.put<LlmSettingsResponse>(LLM_SETTINGS_PATHS.base, data),
};
