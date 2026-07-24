import { useQuery } from '@tanstack/react-query';
import { reportClient } from '../api/reportClient';
import { qk } from '../api/keys';
import type { ExtendedDashboardStats } from '../api/reportClient';
import type { PnlReport, RenewalReminder } from '@tingting/shared';

export type { PnlReport, PnlTruck } from '@tingting/shared';
export type { ExtendedDashboardStats };

export function useDashboardStats() {
  return useQuery<ExtendedDashboardStats>({
    queryKey: qk.dashboard.main,
    queryFn: () => reportClient.getDashboard(),
    staleTime: 2 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: true,
  });
}

export function usePnlReport(month: number, year: number) {
  return useQuery<PnlReport>({
    queryKey: qk.dashboard.pnl(month, year),
    queryFn: () => reportClient.getPnl(month, year),
    staleTime: 5 * 60 * 1000,
  });
}

export function useYearlyPnl(year: number) {
  return useQuery<(PnlReport | null)[]>({
    queryKey: qk.dashboard.yearlyPnl(year),
    queryFn: () =>
      Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          reportClient.getPnl(i + 1, year).catch(() => null),
        ),
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRenewalReminders() {
  return useQuery<RenewalReminder[]>({
    queryKey: qk.dashboard.renewalReminders,
    queryFn: () => reportClient.getRenewals(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDistributionHistory() {
  return useQuery({
    queryKey: qk.dashboard.distributionHistory,
    queryFn: () => reportClient.getDistributionHistory(),
    staleTime: 5 * 60 * 1000,
  });
}
