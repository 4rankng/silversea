import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { qk } from '../../../api/keys';
import { formatCompact } from '../../../lib/format';
import type { TripDetail, TripLeg } from '@tingting/shared';
import { FINANCIAL_ROLES, parseThreshold } from '@tingting/shared';
import { useAuth } from '../../../hooks/useAuth';
import {
  useDashboardStats,
  usePnlReport,
  useMonthlyTrips,
  useCreatedTrips,
  useYearlyPnl,
  useFuelConfig,
  useRenewalReminders,
  type PnlReport,
} from '../../../hooks/useQueries';
import { previousComparisonValues, previousPeriodOf } from '../utils';
import { deriveDashboardReportFinancials } from '../report-financials';

const EMPTY_TRIPS: TripDetail[] = [];
const EMPTY_CREATED: TripDetail[] = [];
const EMPTY_YEARLY: (PnlReport | null)[] = [];

export interface FuelWarning {
  tripId: number;
  code: string;
  driver: string;
  ttbq: number;
  critical: boolean;
}

export interface DerivedData extends ReturnType<typeof deriveDashboardReportFinancials> {
  displayTrucks: Array<{ plate: string; trips: number; revenue: number; profit: number; driver: string }>;
  maxTruckProfit: number;
  prevRevenue: number | null;
  prevCosts: number | null;
  prevGross: number | null;
  prevNet: number | null;
}

export interface ReceivablesSummary {
  buckets: Array<{ range: string; label: string; count: number; amount: number }>;
  totalOutstanding: number;
  totalCustomers: number;
  overdueCustomers: number;
}

export interface DashboardAuditEntry {
  id: number;
  timestamp: string;
  userName: string;
  action: string;
  message: string;
  path?: string;
  category?: 'trip' | 'config' | 'finance' | 'auth' | 'penalty';
}

export function useDashboardData(currentMonth: number, currentYear: number) {

  const { data: stats, isLoading: loading } = useDashboardStats();
  const { data: pnlReport } = usePnlReport(currentMonth, currentYear);
  // Month-over-month comparisons need the previous calendar month (Jan rolls
  // back to Dec of the prior year), not the same month a year ago — the old
  // `(currentMonth, currentYear - 1)` query made every KPI pill read "Mới".
  const prevPeriod = previousPeriodOf(currentMonth, currentYear);
  const { data: prevPnlReport } = usePnlReport(prevPeriod.month, prevPeriod.year);
  const { data: allTrips = EMPTY_TRIPS } = useMonthlyTrips(currentYear, currentMonth);
  const { data: createdTrips = EMPTY_CREATED } = useCreatedTrips();
  const { data: fuelConfig } = useFuelConfig();
  const { data: renewalReminders = [] } = useRenewalReminders();
  const { data: receivablesSummary } = useQuery({
    queryKey: qk.dashboard.receivablesSummary,
    queryFn: () => api.get<ReceivablesSummary>('/reports/receivables-summary').catch(() => null),
    staleTime: 2 * 60 * 1000,
  });
  const { data: thisYearRaw = EMPTY_YEARLY } = useYearlyPnl(currentYear);
  const { data: lastYearRaw = EMPTY_YEARLY } = useYearlyPnl(currentYear - 1);

  // Latest audit-log activity for the dashboard widget.
  // Only ADMIN/MANAGER/ACCOUNTANT can access audit logs — skip the query entirely
  // for DRIVER/FORWARDER to avoid wasted 403s.
  const { user } = useAuth();
  const canSeeAudit = user?.role && (FINANCIAL_ROLES as readonly string[]).includes(user.role);
  const { data: recentAudit = [] } = useQuery<DashboardAuditEntry[]>({
    queryKey: qk.dashboard.auditRecent,
    queryFn: async () => {
      const res = await api.get<{ items: DashboardAuditEntry[]; total: number }>(
        '/audit-logs?page=1&limit=8',
      );
      return res.items ?? [];
    },
    enabled: !!canSeeAudit,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const yearlySeries = useMemo(() => {
    const out: Array<{ revenue: number; grossProfit: number }> = [];
    for (let i = 11; i >= 0; i--) {
      let m = currentMonth - i;
      let yArr = thisYearRaw;
      while (m <= 0) { m += 12; yArr = lastYearRaw; }
      const r: PnlReport | null | undefined = yArr[m - 1];
      out.push({
        revenue: Number(r?.totalRevenue ?? 0),
        grossProfit: Number(r?.grossProfit ?? 0),
      });
    }
    return out;
  }, [thisYearRaw, lastYearRaw, currentMonth]);

  const topOverdueCustomer = stats?.topOverdueCustomer ?? null;
  const topShareholder = stats?.topShareholder ?? null;

  const fuelWarnings = useMemo((): FuelWarning[] => {
    if (!fuelConfig || allTrips.length === 0) return [];
    const warnThreshold = parseThreshold(fuelConfig.warningThreshold, 0);
    const critThreshold = parseThreshold(fuelConfig.criticalThreshold, 0);
    if (!warnThreshold) return [];
    const flagged: FuelWarning[] = [];
    for (const t of allTrips) {
      const trip: TripDetail = t;
      const totalKm = trip.legs?.reduce((s: number, l: TripLeg) => s + Number(l.km), 0) ?? 0;
      const totalLiters = Number(trip.fuelLiters) || 0;
      if (totalKm <= 0 || totalLiters <= 0) continue;
      const ttbq = (totalLiters / totalKm) * 100;
      if (ttbq > warnThreshold) {
        flagged.push({
          tripId: trip.id,
          code: trip.tripCode ?? '—',
          driver: trip.driver?.name ?? '—',
          ttbq,
          critical: critThreshold > 0 && ttbq > critThreshold,
        });
      }
    }
    return flagged.sort((a, b) => b.ttbq - a.ttbq).slice(0, 5);
  }, [fuelConfig, allTrips]);

  const derived = useMemo((): DerivedData => {
    const financials = deriveDashboardReportFinancials(pnlReport);
    const sortedTrucks = pnlReport?.trucks
      ? [...pnlReport.trucks].sort((a, b) => b.profit - a.profit).slice(0, 5) : [];
    const displayTrucks = sortedTrucks.map(truck => ({
      plate: truck.plate, trips: truck.trips, revenue: truck.revenue, profit: truck.profit,
      driver: `Đầu kéo · ${truck.trips} chuyến`,
    }));
    return { ...financials, displayTrucks,
      maxTruckProfit: Math.max(...displayTrucks.map(truck => truck.profit), 1),
      ...previousComparisonValues(prevPnlReport) };
  }, [pnlReport, prevPnlReport]);

  const createdTripsCount = createdTrips.length;

  const formattedRevenue = derived.revenue === null ? '—' : formatCompact(derived.revenue);
  const formattedCosts = derived.costs === null ? '—' : formatCompact(derived.costs);
  const formattedTotalPie = derived.costTotal === null ? '—' : formatCompact(derived.costTotal);
  const formattedGross = derived.grossProfit === null ? '—' : formatCompact(derived.grossProfit);
  const formattedNet = derived.netProfit === null ? '—' : formatCompact(derived.netProfit);

  return {
    currentMonth,
    currentYear,
    stats,
    loading,
    pnlReport,
    prevPnlReport,
    allTrips,
    createdTrips,
    createdTripsCount,
    renewalReminders,
    receivablesSummary,
    yearlySeries,
    yearlyReports: thisYearRaw,
    topOverdueCustomer,
    topShareholder,
    fuelWarnings,
    recentAudit,
    derived,
    formattedRevenue,
    formattedCosts,
    formattedTotalPie,
    formattedGross,
    formattedNet,
  };
}
