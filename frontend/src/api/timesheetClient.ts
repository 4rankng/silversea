// Driver timesheet (chấm công lái xe) — API client over /timesheet.
// Thin helpers mirroring salaryClient.ts / depositRefundClient.ts. The symbol
// vocabulary and the money rules come from @tingting/shared so the grid can
// never count a Q as one trip.

import { api } from '../lib/api';
import type { TimesheetSalaryMode, TimesheetSalaryResult, TimesheetSymbol } from '@tingting/shared';

export type { TimesheetSalaryMode, TimesheetSymbol };

export interface TimesheetDayCell {
  id: number | null;
  workDate: string;
  symbol: TimesheetSymbol | null;
  trips: number;
  isSunday: boolean;
  tripAdjustment: number;
  note: string | null;
  enteredBy: number | null;
  enteredAt: string | null;
  adjustedBy: number | null;
  adjustedAt: string | null;
}

export interface TimesheetMonth {
  id: number;
  driverId: number;
  driverName: string;
  year: number;
  month: number;
  salaryMode: TimesheetSalaryMode;
  dailyBase: number | null;
  flatAmount: number | null;
  status: 'OPEN' | 'RECONCILED';
  reconciledBy: number | null;
  reconciledAt: string | null;
  reconcileNote: string | null;
  days: TimesheetDayCell[];
  salary: TimesheetSalaryResult;
  warnings: string[];
}

export interface TimesheetDriverRow {
  id: number;
  name: string;
  status: string;
  monthId: number | null;
  salaryMode: TimesheetSalaryMode | null;
  monthStatus: 'OPEN' | 'RECONCILED' | null;
}

export interface TimesheetRollupRow {
  driverId: number;
  driverName: string;
  donCount: number;
  kepCount: number;
  quayDauCount: number;
  luuCaCount: number;
  nghiCount: number;
  nghiPhepCount: number;
  trips: number;
  workdays: number;
  bonusTrips: number;
  salaryMode: TimesheetSalaryMode | null;
  salary: number;
  perTripPay: number;
  extraTripBonus: number;
  dailyBasePay: number;
  status: 'OPEN' | 'RECONCILED' | null;
  sundayTrips: number;
  revenue: number | null;
  cost: number | null;
  salaryRatio: number | null;
  tripsCompleted: number;
}

function period(year: number, month: number): string {
  return `year=${year}&month=${month}`;
}

export async function listTimesheetDrivers(year: number, month: number) {
  const result = await api.get<{ items: TimesheetDriverRow[] }>(`/timesheet/drivers?${period(year, month)}`);
  return result.items;
}

export async function listTimesheetMonths(year: number, month: number) {
  const result = await api.get<{ items: TimesheetMonth[] }>(`/timesheet/months?${period(year, month)}`);
  return result.items;
}

export async function getTimesheetMonth(id: number) {
  return api.get<TimesheetMonth>(`/timesheet/months/${id}`);
}

export async function createTimesheetMonth(body: {
  driverId: number; year: number; month: number;
  salaryMode?: TimesheetSalaryMode; dailyBase?: number | null; flatAmount?: number | null;
}) {
  return api.post<TimesheetMonth>('/timesheet/months', body);
}

export async function updateTimesheetMode(id: number, body: {
  salaryMode?: TimesheetSalaryMode; dailyBase?: number | null; flatAmount?: number | null;
}) {
  return api.patch<TimesheetMonth>(`/timesheet/months/${id}/mode`, body);
}

/** Symbols only — the API rejects a client-supplied trip count by design. */
export async function saveTimesheetDays(id: number, days: Array<{ workDate: string; symbol: TimesheetSymbol | null }>) {
  return api.put<TimesheetMonth>(`/timesheet/months/${id}/days`, { days });
}

export async function adjustTimesheetDay(monthId: number, dayId: number, tripAdjustment: number) {
  return api.put<TimesheetMonth>(`/timesheet/months/${monthId}/days/${dayId}/adjustment`, { tripAdjustment });
}

export async function reconcileTimesheetMonth(id: number, note?: string | null) {
  return api.post<TimesheetMonth>(`/timesheet/months/${id}/reconcile`, { note: note ?? null });
}

export async function reopenTimesheetMonth(id: number) {
  return api.post<TimesheetMonth>(`/timesheet/months/${id}/reopen`, {});
}

export async function getTimesheetRollup(year: number, month: number) {
  const result = await api.get<{ items: TimesheetRollupRow[] }>(`/timesheet/rollup?${period(year, month)}`);
  return result.items;
}