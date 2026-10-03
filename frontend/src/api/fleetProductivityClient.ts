import { api } from '../lib/api';
import type {
  DailyFleetProductivityResponse,
  MonthlyFleetProductivityResponse,
} from '@tingting/shared';

export const fleetProductivityClient = {
  async getDaily(date: string): Promise<DailyFleetProductivityResponse> {
    const res = await api.get<{ success: boolean; data: DailyFleetProductivityResponse }>(
      `/fleet/productivity/daily?date=${encodeURIComponent(date)}`
    );
    return res.data;
  },

  async getMonthly(
    year: number,
    month: number,
    truckId?: number
  ): Promise<MonthlyFleetProductivityResponse> {
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
    });
    if (truckId != null) {
      params.set('truckId', String(truckId));
    }
    const res = await api.get<{ success: boolean; data: MonthlyFleetProductivityResponse }>(
      `/fleet/productivity/monthly?${params.toString()}`
    );
    return res.data;
  },

  getMonthlyExportUrl(year: number, month: number): string {
    return `/api/fleet/productivity/monthly/export?year=${year}&month=${month}`;
  },
};
