// TanStack Query hooks for the ADMIN LLM provider settings page.
//
// `useLlmSettings()` loads the singleton; `useSaveLlmSettings()` invalidates
// the cache on success so a freshly-saved provider/key is reflected on
// re-render.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { llmSettingsClient } from '../api/llmSettingsClient';
import { qk } from '../api/keys';
import type { LlmSettingsUpdate } from '@tingting/shared';

export function useLlmSettings() {
  return useQuery({
    queryKey: qk.llmSettings.detail,
    queryFn: () => llmSettingsClient.getSettings(),
    staleTime: 30_000,
  });
}

export function useSaveLlmSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: LlmSettingsUpdate) => llmSettingsClient.saveSettings(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.llmSettings.all });
    },
  });
}
