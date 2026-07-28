import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import type { PendingGovernanceResponse } from '../lib/governance';
import type {
  GovernanceActionKind,
  GovernanceActionStatus,
  GovernanceAllowedAction,
} from '@tingting/shared';
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
  postCloseAdjustment?: number;
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

export interface SalaryPeriodLifecycle {
  period: string;
  status: 'OPEN' | 'CLOSED' | 'REOPENED';
  closeId: number | null;
  version: number | null;
  ledgerEntryId: number | null;
  closedBy: number | null;
  closedAt: string | null;
  note: string | null;
  payslipIssuedBy: number | null;
  payslipIssuedAt: string | null;
  payslipIssuedNote: string | null;
  officialPostedBy: number | null;
  officialPostedAt: string | null;
  officialPostingNote: string | null;
  hasDriverPayout: boolean;
  canReopen: boolean;
  reopenBlockers: string[];
}

export interface SalaryPeriodAdjustmentItem {
  actionId: number;
  adjustmentId: number | null;
  version: number;
  sourcePeriod: string;
  targetPeriod: string;
  driverId: number;
  driverName: string;
  amount: number;
  reason: string;
  status: 'PENDING_CHECK' | 'PENDING_APPROVAL' | 'APPROVED';
  makerId: number;
  makerName: string | null;
  checkerId: number | null;
  checkerName: string | null;
  approverId: number | null;
  approverName: string | null;
  createdAt: string;
  approvedAt: string | null;
  relationship: 'SOURCE' | 'TARGET';
}

export interface SalaryPeriodGovernanceAction {
  id: number;
  subjectType: 'SALARY_PERIOD';
  subjectId: number | null;
  subjectKey: string | null;
  actionKind: Extract<GovernanceActionKind, 'SALARY_PERIOD_CLOSE' | 'SALARY_PERIOD_REOPEN'>;
  status: GovernanceActionStatus;
  version: number;
  reason: string;
  makerId: number;
  makerRole: string | null;
  checkerId: number | null;
  checkerRole: string | null;
  approverId: number | null;
  approverRole: string | null;
  createdAt: string;
  checkedAt: string | null;
  approvedAt: string | null;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  deltaSnapshot?: unknown;
  allowedActions: GovernanceAllowedAction[];
}

export interface SalaryConfirmationGovernanceAction {
  id: number;
  subjectType: 'SALARY_CONFIRMATION';
  subjectId: number | null;
  subjectKey: string | null;
  actionKind: Extract<GovernanceActionKind, 'SALARY_CONFIRMATION' | 'SALARY_REOPEN'>;
  status: GovernanceActionStatus;
  version: number;
  reason: string;
  makerId: number;
  makerRole: string | null;
  checkerId: number | null;
  checkerRole: string | null;
  approverId: number | null;
  approverRole: string | null;
  createdAt: string;
  checkedAt: string | null;
  approvedAt: string | null;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  deltaSnapshot?: unknown;
  allowedActions?: GovernanceAllowedAction[];
}

export interface SalaryPeriodOverview {
  lifecycle: SalaryPeriodLifecycle;
  adjustments: SalaryPeriodAdjustmentItem[];
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
    api.post<SalaryConfirmationGovernanceAction>(
      SALARY.CONFIRM(driverId, year, month), {}
    ),

  // Reopen a confirmed salary period for editing (CONFIRMED → DRAFT)
  unconfirmSalary: (driverId: number, year: number, month: number, reason: string) =>
    api.post<SalaryConfirmationGovernanceAction>(
      SALARY.UNCONFIRM(driverId, year, month), { reason }
    ),

  listDriverGovernanceActions: async (driverId: number, year: number, month: number) => {
    const subjectKey = `${driverId}:${year}-${String(month).padStart(2, '0')}`;
    const [confirmActions, reopenActions] = await Promise.all([
      api.get<SalaryConfirmationGovernanceAction[]>(`/governance-actions${toQuery({
        subjectType: 'SALARY_CONFIRMATION',
        actionKind: 'SALARY_CONFIRMATION',
        subjectKey,
        limit: 100,
      })}`),
      api.get<SalaryConfirmationGovernanceAction[]>(`/governance-actions${toQuery({
        subjectType: 'SALARY_CONFIRMATION',
        actionKind: 'SALARY_REOPEN',
        subjectKey,
        limit: 100,
      })}`),
    ]);

    return [...confirmActions, ...reopenActions]
      .filter((action) => action.subjectKey === subjectKey)
      .sort((left, right) => right.id - left.id);
  },

  checkConfirmSalary: (driverId: number, year: number, month: number, actionId: number, expectedVersion: number) =>
    api.post<SalaryConfirmationGovernanceAction>(
      `/salary/${driverId}/${year}/${month}/confirm-actions/${actionId}/check`,
      { expectedVersion },
    ),

  approveConfirmSalary: (driverId: number, year: number, month: number, actionId: number, expectedVersion: number) =>
    api.post<SalaryConfirmationGovernanceAction>(
      `/salary/${driverId}/${year}/${month}/confirm-actions/${actionId}/approve`,
      { expectedVersion },
    ),

  checkUnconfirmSalary: (driverId: number, year: number, month: number, actionId: number, expectedVersion: number) =>
    api.post<SalaryConfirmationGovernanceAction>(
      `/salary/${driverId}/${year}/${month}/unconfirm-actions/${actionId}/check`,
      { expectedVersion },
    ),

  approveUnconfirmSalary: (driverId: number, year: number, month: number, actionId: number, expectedVersion: number) =>
    api.post<SalaryConfirmationGovernanceAction>(
      `/salary/${driverId}/${year}/${month}/unconfirm-actions/${actionId}/approve`,
      { expectedVersion },
    ),

  getPeriodOverview: (period: string, driverId?: number | null) =>
    api.get<SalaryPeriodOverview>(`/salary/periods/${period}/overview${toQuery({ driverId: driverId ?? undefined })}`),

  listPeriodGovernanceActions: async (period: string) => {
    const [closeActions, reopenActions] = await Promise.all([
      api.get<SalaryPeriodGovernanceAction[]>(`/governance-actions${toQuery({
        subjectType: 'SALARY_PERIOD',
        actionKind: 'SALARY_PERIOD_CLOSE',
        subjectKey: period,
        limit: 100,
      })}`),
      api.get<SalaryPeriodGovernanceAction[]>(`/governance-actions${toQuery({
        subjectType: 'SALARY_PERIOD',
        actionKind: 'SALARY_PERIOD_REOPEN',
        subjectKey: period,
        limit: 100,
      })}`),
    ]);

    return [...closeActions, ...reopenActions]
      .filter((action) => action.subjectKey === period)
      .sort((left, right) => right.id - left.id);
  },

  closePeriod: (period: string, note?: string | null) =>
    api.post<SalaryPeriodGovernanceAction>(`/salary/periods/${period}/close`, { note: note ?? null }),

  checkClosePeriod: (period: string, actionId: number, expectedVersion: number) =>
    api.post<SalaryPeriodGovernanceAction>(`/salary/periods/${period}/close-actions/${actionId}/check`, { expectedVersion }),

  approveClosePeriod: (period: string, actionId: number, expectedVersion: number) =>
    api.post<SalaryPeriodGovernanceAction>(`/salary/periods/${period}/close-actions/${actionId}/approve`, { expectedVersion }),

  reopenPeriod: (period: string, payload: { expectedVersion: number; reason: string }) =>
    api.post<SalaryPeriodGovernanceAction>(`/salary/periods/${period}/reopen`, payload),

  checkReopenPeriod: (period: string, actionId: number, expectedVersion: number) =>
    api.post<SalaryPeriodGovernanceAction>(`/salary/periods/${period}/reopen-actions/${actionId}/check`, { expectedVersion }),

  approveReopenPeriod: (period: string, actionId: number, expectedVersion: number) =>
    api.post<SalaryPeriodGovernanceAction>(`/salary/periods/${period}/reopen-actions/${actionId}/approve`, { expectedVersion }),

  issuePayslips: (period: string, payload: { expectedVersion: number; note?: string | null }) =>
    api.post<SalaryPeriodGovernanceAction>(`/salary/periods/${period}/issue`, payload),

  postOfficial: (period: string, payload: { expectedVersion: number; note?: string | null }) =>
    api.post<SalaryPeriodGovernanceAction>(`/salary/periods/${period}/post`, payload),

  checkIssuePayslips: (period: string, actionId: number, expectedVersion: number) =>
    api.post<SalaryPeriodGovernanceAction>(
      `/salary/periods/${period}/issue-actions/${actionId}/check`,
      { expectedVersion },
    ),

  approveIssuePayslips: (period: string, actionId: number, expectedVersion: number) =>
    api.post<SalaryPeriodGovernanceAction>(
      `/salary/periods/${period}/issue-actions/${actionId}/approve`,
      { expectedVersion },
    ),

  checkPostOfficial: (period: string, actionId: number, expectedVersion: number) =>
    api.post<SalaryPeriodGovernanceAction>(
      `/salary/periods/${period}/post-actions/${actionId}/check`,
      { expectedVersion },
    ),

  approvePostOfficial: (period: string, actionId: number, expectedVersion: number) =>
    api.post<SalaryPeriodGovernanceAction>(
      `/salary/periods/${period}/post-actions/${actionId}/approve`,
      { expectedVersion },
    ),

  requestPostCloseAdjustment: (period: string, payload: {
    driverId: number;
    targetPeriod: string;
    amount: number;
    reason: string;
    expectedVersion: number;
  }) => api.post(`/salary/periods/${period}/adjustments`, payload),

  checkPostCloseAdjustment: (period: string, actionId: number, expectedVersion: number) =>
    api.post(`/salary/periods/${period}/adjustments/${actionId}/check`, { expectedVersion }),

  approvePostCloseAdjustment: (period: string, actionId: number, expectedVersion: number) =>
    api.post(`/salary/periods/${period}/adjustments/${actionId}/approve`, { expectedVersion }),
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
    api.put<SalaryPeriodDefault | PendingGovernanceResponse>(
      CONFIG.SALARY_PERIOD_DEFAULT,
      { defaultStartDay, defaultEndDay },
    ),
  resolve: (year: number, month: number) =>
    api.get<SalaryPeriodRange>(`${CONFIG.SALARY_PERIOD_RESOLVE}${toQuery({ year, month })}`),
  delete: (id: number) => api.delete<{ ok: boolean }>(`${CONFIG.SALARY_PERIODS}/${id}`),
};
