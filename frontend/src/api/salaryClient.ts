import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { SALARY, CONFIG } from '@tingting/shared';

export interface WorkDayRecord {
  id: number;
  driverId: number;
  date: string;
  status: 'TRIP_DAY' | 'STANDBY' | 'PERSONAL_LEAVE' | 'WEEKLY_OFF';
  tripId: number | null;
  note: string | null;
  trip?: { id: number; tripCode: string | null; routeName: string | null } | null;
}

export interface AttendanceSalary {
  driverId: number;
  year: number;
  month: number;
  periodStart: string;
  periodEnd: string;
  standardWorkDays: number;
  tripDays: number;
  standbyDays: number;
  personalLeaveDays: number;
  weeklyOffDays: number;
  paidDays: number;
  baseSalary: number;
  socialInsurance: number;
  dailyRate: number;
  totalTripSalary: number;
  supplementPay: number;
  leaveDeduction: number;
  adjustment: number;
  totalPenalties: number;
  netSalary: number;
  workDays?: WorkDayRecord[];
  confirmationStatus: 'DRAFT' | 'CONFIRMED';
  confirmedBy: number | null;
  confirmedAt: string | null;
}

export interface SalaryConfirmation {
  id: number;
  driverId: number;
  year: number;
  month: number;
  status: 'DRAFT' | 'CONFIRMED';
  confirmedBy: number | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DriverSalarySummary {
  id: number;
  name: string;
  baseSalary: string | null;
  status: string;
  salary: AttendanceSalary | null;
}

export interface WorkDayUpdate {
  date: string;
  status: 'TRIP_DAY' | 'STANDBY' | 'PERSONAL_LEAVE' | 'WEEKLY_OFF' | null;
  note?: string | null;
}

export const salaryClient = {
  // List all drivers with salary summary for a month
  getAll: (year: number, month: number) =>
    api.get<{ year: number; month: number; items: DriverSalarySummary[] }>(
      `${SALARY.LIST}${toQuery({ year, month })}`
    ),

  // Full salary computation for one driver
  getSalary: (driverId: number, year: number, month: number) =>
    api.get<AttendanceSalary>(SALARY.DRIVER_MONTH(driverId, year, month)),

  // Get raw work day records for calendar view
  getWorkDays: (driverId: number, year: number, month: number) =>
    api.get<{ period: { start: string; end: string; label: string }; workDays: WorkDayRecord[] }>(
      SALARY.WORK_DAYS(driverId, year, month)
    ),

  // Batch update work days
  updateWorkDays: (driverId: number, year: number, month: number, items: WorkDayUpdate[]) =>
    api.put<{ results: Array<{ date: string; action: string; reason?: string }>; salary: AttendanceSalary }>(
      SALARY.WORK_DAYS(driverId, year, month),
      { items }
    ),

  // Confirm salary period (DRAFT → CONFIRMED)
  confirmSalary: (driverId: number, year: number, month: number) =>
    api.post<{ confirmation: SalaryConfirmation; salary: AttendanceSalary }>(
      SALARY.CONFIRM(driverId, year, month), {}
    ),

  // Reopen a confirmed salary period for editing (CONFIRMED → DRAFT)
  unconfirmSalary: (driverId: number, year: number, month: number) =>
    api.post<{ ok: true; salary: AttendanceSalary }>(
      SALARY.UNCONFIRM(driverId, year, month), {}
    ),
};

// ─── Salary Period Config ─────────────────────────────────────────
export interface SalaryPeriodDefault {
  id: number;
  defaultStartDay: number;
  defaultEndDay: number;
  isDefault: boolean;
  updatedAt: string;
}
export interface SalaryPeriodRange {
  month: number;
  year: number;
  start: string;
  end: string;
  label: string;
}
export const salaryPeriodConfigClient = {
  getDefault: () => api.get<SalaryPeriodDefault | null>(CONFIG.SALARY_PERIOD_DEFAULT),
  updateDefault: (defaultStartDay: number, defaultEndDay: number) =>
    api.put<SalaryPeriodDefault>(CONFIG.SALARY_PERIOD_DEFAULT, { defaultStartDay, defaultEndDay }),
  resolve: (year: number, month: number) =>
    api.get<SalaryPeriodRange>(`${CONFIG.SALARY_PERIOD_RESOLVE}${toQuery({ year, month })}`),
  delete: (id: number) => api.delete<{ ok: boolean }>(`${CONFIG.SALARY_PERIODS}/${id}`),
};

