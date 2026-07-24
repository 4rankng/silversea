import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettings } from '@tingting/shared';
import { appSettingsClient } from '../api/appSettingsClient';
import { qk } from '../api/keys';

const appSettingsQueryKey = ['app-settings'] as const;

/** Load and save the complete set of admin-controlled application switches. */
export function useAppSettings() {
  return useQuery({
    queryKey: appSettingsQueryKey,
    queryFn: () => appSettingsClient.getSettings(),
    staleTime: 30_000,
  });
}

export function useSaveAppSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: AppSettings) => appSettingsClient.saveSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appSettingsQueryKey });
      // The assistant and onboarding UI read their enabled state from /auth/me.
      queryClient.invalidateQueries({ queryKey: qk.auth.me });
    },
  });
}
