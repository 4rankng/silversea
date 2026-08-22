import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { configClient } from '../api/configClient';
import { qk } from '../api/keys';
import { FINANCIAL } from '@tingting/shared';
import type { Driver, PenaltyReason, Truck, PenaltyStatus } from '@tingting/shared';

interface PenaltyRow {
  id: number;
  driverId: number;
  tripId: number | null;
  reasonId: number | null;
  customReason: string | null;
  amount: string;
  date: string;
  status: PenaltyStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  driverName?: string;
  reasonText?: string;
  tripCode?: string | null;
}

/** Server-side filters the penalty list endpoint understands (page/limit/search ride along). */
export type PenaltyTableFilters = {
  status?: PenaltyStatus;
  driverId?: number;
  dateFrom?: string;
  dateTo?: string;
};

/** Full-set status counts riding the list envelope (status filter excluded,
 *  so chip counts stay stable while a status chip is active). */
export interface PenaltyStatusCounts {
  all?: number;
  ACTIVE?: number;
  CANCELED?: number;
}

/** Envelope returned by GET /penalties. */
export interface PenaltyListEnvelope {
  items: PenaltyRow[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts?: PenaltyStatusCounts;
}

/** Endpoint for useTableQueryState — builds the backend-native query string. */
export async function fetchPenaltiesPage(
  params: PenaltyTableFilters & { search?: string; page?: number; limit?: number },
): Promise<PenaltyListEnvelope> {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 50),
  });
  if (params.search) qs.set('search', params.search);
  if (params.driverId) qs.set('driverId', String(params.driverId));
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  if (params.status) qs.set('status', params.status);
  return api.get<PenaltyListEnvelope>(`${FINANCIAL.PENALTIES}?${qs.toString()}`);
}

export interface PenaltyInsightsMonth {
  /** Số vụ vi phạm trong kỳ lương đang chọn. */
  incidentCount: number;
  /** Tổng tiền phạt trong kỳ. */
  totalAmount: number;
  /** Số vụ trong kỳ lương liền trước. */
  prevMonthCount: number;
  /** Nhãn so sánh với kỳ trước — display-ready verbatim. */
  comparisonLabel: string;
}

export interface PenaltyInsightsScoreboardRow {
  driverId: number;
  name: string;
  /** Số ngày liên tục không vi phạm (toàn bộ lịch sử). */
  streakDays: number;
  violations7d: number;
  violations30d: number;
  violations90d: number;
  violationsYtd: number;
  /** Tổng tiền phạt từ đầu năm. */
  fineYtd: number;
  /** Hạng A+/A/B/C theo vi phạm 90 ngày (cửa sổ mặc định). */
  grade: string;
  truckPlate: string | null;
}

export interface PenaltyInsights {
  month: PenaltyInsightsMonth;
  ytd: { count: number; total: number };
  /** Lái xe ACTIVE không có vi phạm nào trong kỳ. */
  safeDriverCount: number;
  driverTotal: number;
  /** Toàn bộ lái xe ACTIVE, sắp xếp theo chuỗi an toàn giảm dần. */
  scoreboard: PenaltyInsightsScoreboardRow[];
  longestStreak: number;
  streakLeader: string;
  avgStreak: number;
  driversOver90: number;
  driversOver6m: number;
}

/**
 * Server-computed KPI block for the selected period (KPI strip, scoreboard,
 * streak aggregates). One response carries every scoreboard window — the
 * 7d/30d/90d/YTD toggle is purely client-side.
 */
export function usePenaltyInsights(month: number, year: number) {
  return useQuery<PenaltyInsights>({
    queryKey: qk.penalties.insights(month, year),
    queryFn: () => api.get<PenaltyInsights>(`${FINANCIAL.PENALTIES}/insights?month=${month}&year=${year}`),
    staleTime: 30_000,
  });
}

export function usePenaltyCatalogs() {
  return useQuery<{
    drivers: Driver[];
    reasons: PenaltyReason[];
    trucks: Truck[];
  }>({
    queryKey: qk.penalties.catalogs,
    queryFn: async () => {
      const [drivers, reasons, trucks] = await Promise.all([
        configClient.getDrivers(),
        configClient.getPenaltyReasons(),
        configClient.getTrucks(),
      ]);
      return {
        drivers: drivers.filter((x: Driver) => x.status === 'ACTIVE'),
        reasons,
        trucks,
      };
    },
  });
}

export type { PenaltyRow };
