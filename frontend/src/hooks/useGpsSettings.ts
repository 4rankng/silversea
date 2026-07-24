import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GpsSettingsUpdate } from '@tingting/shared';
import { gpsSettingsClient } from '../api/gpsSettingsClient';
import { qk } from '../api/keys';

export function useGpsSettings() {
  return useQuery({
    queryKey: qk.gpsSettings.detail,
    queryFn: () => gpsSettingsClient.getSettings(),
    staleTime: 30_000,
  });
}

export function useSaveGpsSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: GpsSettingsUpdate) => gpsSettingsClient.saveSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.gpsSettings.detail });
      queryClient.invalidateQueries({ queryKey: qk.liveFleet.all });
    },
  });
}
