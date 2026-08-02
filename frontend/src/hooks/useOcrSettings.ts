import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OcrSettingsUpdate } from '@tingting/shared';
import { ocrSettingsClient } from '../api/ocrSettingsClient';
import { qk } from '../api/keys';

export function useOcrSettings() {
  return useQuery({
    queryKey: qk.ocrSettings.detail,
    queryFn: () => ocrSettingsClient.getSettings(),
    staleTime: 30_000,
  });
}

export function useSaveOcrSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: OcrSettingsUpdate) => ocrSettingsClient.saveSettings(data),
    onSuccess: (settings) => {
      queryClient.setQueryData(qk.ocrSettings.detail, settings);
    },
  });
}
