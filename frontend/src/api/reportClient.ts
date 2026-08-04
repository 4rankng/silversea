import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { REPORTS } from '@tingting/shared';
import type { DashboardStats, PnlReport, RenewalReminder, Distribution, DashboardWidgets } from '@tingting/shared';

export interface ExtendedDashboardStats extends DashboardStats {
  topOverdueCustomer?: { name: string; balance: number; days: number } | null;
  topShareholder?: { name: string; percentage: number } | null;
}

export const reportClient = {
  getDashboard: async () => {
    return api.get<ExtendedDashboardStats>(REPORTS.DASHBOARD);
  },

  getPnl: async (month: number, year: number) => {
    return api.get<PnlReport>(`${REPORTS.PNL}${toQuery({ month, year })}`);
  },

  getDashboardWidgets: async (month: number, year: number) => {
    return api.get<DashboardWidgets>(`/reports/dashboard-widgets${toQuery({ month, year })}`);
  },

  getDistributionHistory: async () => {
    const res = await api.get<
      | Distribution[]
      | { items: Distribution[] }
    >('/reports/distribution-history');
    return Array.isArray(res) ? res : res.items ?? [];
  },

  getRenewals: async () => {
    return api.get<RenewalReminder[]>(REPORTS.RENEWALS);
  },
};
