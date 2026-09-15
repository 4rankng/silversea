import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { DRIVER } from '@tingting/shared';

export const driverFinanceClient = {
  getEarnings: async (month: number, year: number) => {
    return api.get<{
      salarySnapshotState?: 'LIVE' | 'CONFIRMED' | 'UNAVAILABLE';
      salaryReconciliationRequired?: boolean;
      postCloseAdjustment?: number;
      baseSalary: string;
      tripIncome: string;
      penalties: string;
      netIncome: string;
      // F2 / B2 — trip-based income + outstanding payable.
      productionSalary: string;
      roadAllowance: string;
      paidOrAdvanced: string;
      payableBalance: string;
      adjustment?: number;
      supplementPay?: number;
      leaveDeduction?: number;
      standardWorkDays?: number;
      paidDays?: number;
      dailyRate?: number;
      periodStart?: string;
      periodEnd?: string;
    }>(`${DRIVER.EARNINGS}${toQuery({ month, year })}`);
  },

  /** M8.6 — list the driver's issued payslip periods with earnings. */
  getPayslips: async () => {
    return api.get<{ items: Array<{
      period: string;
      status: string;
      closedAt: string | null;
      closedByName: string | null;
      note: string | null;
      earnings: {
        salarySnapshotState?: 'LIVE' | 'CONFIRMED' | 'UNAVAILABLE';
        salaryReconciliationRequired?: boolean;
        netIncome: string;
        productionSalary: string;
        roadAllowance: string;
        penalties: string;
        paidOrAdvanced: string;
        payableBalance: string;
        periodStart: string;
        periodEnd: string;
      };
    }> }>(DRIVER.PAYSLIPS);
  },
};
