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

export function useFinancialReportingPolicy() {
  return useQuery({
    queryKey: qk.appSettings.financialReportingPolicy,
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
      queryClient.invalidateQueries({ queryKey: qk.appSettings.financialReportingPolicy });
    },
  });
}

export function useTruckFinancialProfiles(truckId: number | null) {
  return useQuery({
    queryKey: qk.appSettings.truckFinancialProfiles(truckId),
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
      queryClient.invalidateQueries({ queryKey: qk.appSettings.truckFinancialProfiles(payload.truckId) });
    },
  });
}
