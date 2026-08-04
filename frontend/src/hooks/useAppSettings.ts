import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppSettings,
  EmailSettingsUpdate,
} from '@tingting/shared';
import type {
  FinancialReportingPolicyRequest,
  TruckFinancialProfileRequest,
} from '@tingting/shared';
import { appSettingsClient } from '../api/appSettingsClient';
import { qk } from '../api/keys';

/** Load and save the complete set of admin-controlled application switches. */
export function useAppSettings() {
  return useQuery({
    queryKey: qk.appSettings.general,
    queryFn: () => appSettingsClient.getSettings(),
    staleTime: 30_000,
  });
}

export function useSaveAppSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: AppSettings) => appSettingsClient.saveSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.appSettings.general });
      // The assistant UI reads its enabled state from /auth/me.
      queryClient.invalidateQueries({ queryKey: qk.auth.me });
      // A gps toggle flip changes what the live-fleet endpoint returns.
      queryClient.invalidateQueries({ queryKey: qk.liveFleet.all });
    },
  });
}

export function useEmailSettings() {
  return useQuery({
    queryKey: qk.appSettings.email,
    queryFn: () => appSettingsClient.getEmailSettings(),
    staleTime: 30_000,
  });
}

export function useSaveEmailSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: EmailSettingsUpdate) => appSettingsClient.saveEmailSettings(settings),
    onSuccess: (settings) => {
      queryClient.setQueryData(qk.appSettings.email, settings);
    },
  });
}

const financialReportingPolicyQueryKey = ['app-settings', 'financial-reporting-policy'] as const;
const truckFinancialProfilesQueryKey = (truckId: number | null) =>
  ['app-settings', 'truck-financial-profiles', truckId ?? 'auto'] as const;

export function useFinancialReportingPolicy() {
  return useQuery({
    queryKey: financialReportingPolicyQueryKey,
    queryFn: () => appSettingsClient.getFinancialReportingPolicy(),
    staleTime: 30_000,
  });
}

export function useRequestFinancialReportingPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: FinancialReportingPolicyRequest) =>
      appSettingsClient.requestFinancialReportingPolicy(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financialReportingPolicyQueryKey });
    },
  });
}

export function useTruckFinancialProfiles(truckId: number | null) {
  return useQuery({
    queryKey: truckFinancialProfilesQueryKey(truckId),
    queryFn: () => appSettingsClient.getTruckFinancialProfiles(truckId),
    staleTime: 30_000,
  });
}

export function useRequestTruckFinancialProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TruckFinancialProfileRequest) =>
      appSettingsClient.requestTruckFinancialProfile(payload),
    onSuccess: (_result, payload) => {
      queryClient.invalidateQueries({ queryKey: truckFinancialProfilesQueryKey(payload.truckId) });
    },
  });
}
