// Shared machinery for the salary-period-close leaf family: period constants,
// readiness-summary computation (confirmations / work days / completed trips /
// approved exclusions), close-result mapping, reopen blockers, payout checks,
// and governance-view helpers. Extracted from salary-period-close.service.ts
// verbatim (pure code movement); the lifecycle / payslips / exclusion leaves
// import these one-way.
import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { TripStatus, TxnType } from '@tingting/shared';
import { resolveSalaryPeriodDateRange } from './salary-period.service';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import type { GovernanceActionRow } from './governance-action-core.service';
import { getAppSettings } from './app-settings.service';

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const CLOSE_ENTITY_TYPE = 'SALARY_PERIOD_CLOSE';
export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const SALARY_EXCLUSION_SUBJECT_TYPE = 'SALARY_PERIOD';
export const SALARY_EXCLUSION_ACTION_KIND = 'FINANCIAL_EXCEPTION';
export const SALARY_PERIOD_SUBJECT_TYPE = 'SALARY_PERIOD';
export const SALARY_PERIOD_CLOSE_ACTION_KIND = 'SALARY_PERIOD_CLOSE';
export const SALARY_PERIOD_REOPEN_ACTION_KIND = 'SALARY_PERIOD_REOPEN';
// entityId=0 is a sentinel for "company aggregate" — no real driver has
// id=0 (serial starts at 1). The summary entry is for audit/
// reconciliation, not for recomputing driver payable balances.
export const COMPANY_DRIVER_ENTITY_ID = 0;

export type SalaryDriverIssueCode =
  | 'UNCONFIRMED_SALARY'
  | 'PERSONAL_LEAVE_NOTE_MISSING'
  | 'MANUAL_TRIP_DAY'
  | 'MISSING_TRIP_DAY';

export type SalaryExclusionHandlingMode = 'SUPPLEMENTARY_PERIOD' | 'ADJUSTMENT';

export interface SalaryPeriodDriverIssue {
  code: SalaryDriverIssueCode;
  message: string;
}

export interface SalaryPeriodApprovedExclusion {
  actionId: number;
  driverId: number;
  handlingMode: SalaryExclusionHandlingMode;
  targetPeriod: string | null;
  reason: string;
  note: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  followupStatus: 'PENDING' | 'COMPLETED';
  followupCompletedAt: string | null;
}

export interface SalaryPeriodDriverReadiness {
  driverId: number;
  driverName: string;
  status: 'READY' | 'PENDING';
  issues: SalaryPeriodDriverIssue[];
  exclusion: SalaryPeriodApprovedExclusion | null;
}

export interface SalaryPeriodReadinessSummary {
  period: string;
  scope: 'COMPANY' | 'BUSINESS_UNIT';
  businessUnitId: number | null;
  businessUnitName: string | null;
  canClose: boolean;
  blockingReason?: string | null;
  blockingDriverIds: number[];
  drivers: SalaryPeriodDriverReadiness[];
}

export interface SalaryPeriodCloseResult {
  closeId: number;
  period: string;
  status: string;
  version: number;
  periodTotalSalary: number;
  ledgerEntryId: number | null;
  closedBy: number | null;
  closedAt: string;
  note: string | null;
  payslipIssuedBy: number | null;
  payslipIssuedAt: string | null;
  payslipIssuedNote: string | null;
  officialPostedBy: number | null;
  officialPostedAt: string | null;
  officialPostingNote: string | null;
  /** True when this call found an existing close and did no new work. */
  idempotentNoop: boolean;
  scope: 'COMPANY' | 'BUSINESS_UNIT' | null;
  businessUnitId: number | null;
  businessUnitName: string | null;
  includedDriverIds: number[] | null;
  excludedDriverIds: number[] | null;
  payrollProvenanceCapturedAt: string | null;
}

export interface SalaryPeriodLifecycleState {
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

export interface SalaryPeriodExclusionResult {
  /** Exclusion record id in salary_period_exclusions. */
  actionId: number;
  period: string;
  driverId: number;
  handlingMode: SalaryExclusionHandlingMode;
  targetPeriod: string | null;
  reason: string;
  note: string | null;
  followupStatus: 'PENDING' | 'COMPLETED';
  followupCompletedAt: string | null;
}

export function toBusinessDateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function iterateInclusiveDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00.000Z`);
  const stop = new Date(`${end}T00:00:00.000Z`);
  while (current.getTime() <= stop.getTime()) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export function exclusionSubjectKey(period: string, driverId: number): string {
  return `${period}:${driverId}`;
}

export function parseExclusion(afterSnapshot: Record<string, unknown> | null | undefined): {
  handlingMode: SalaryExclusionHandlingMode;
  targetPeriod: string | null;
  note: string | null;
} {
  const rawMode = afterSnapshot?.handlingMode;
  const handlingMode: SalaryExclusionHandlingMode =
    rawMode === 'ADJUSTMENT' ? 'ADJUSTMENT' : 'SUPPLEMENTARY_PERIOD';
  const targetPeriod = typeof afterSnapshot?.targetPeriod === 'string' ? afterSnapshot.targetPeriod : null;
  const note = typeof afterSnapshot?.note === 'string' ? afterSnapshot.note : null;
  return { handlingMode, targetPeriod, note };
}

export function normalizeExclusionHandling(input: {
  period: string;
  handlingMode: SalaryExclusionHandlingMode;
  targetPeriod?: string | null;
  note?: string | null;
}): {
  handlingMode: SalaryExclusionHandlingMode;
  targetPeriod: string | null;
  note: string | null;
} {
  const note = input.note?.trim() || null;
  if (input.handlingMode === 'ADJUSTMENT') {
    return {
      handlingMode: 'ADJUSTMENT',
      targetPeriod: null,
      note,
    };
  }

  const targetPeriod = input.targetPeriod?.trim() || null;
  if (!targetPeriod) {
    throw new ApiError(400, 'Kỳ bổ sung là bắt buộc khi chọn xử lý bằng kỳ lương bổ sung');
  }
  parsePeriod(targetPeriod);
  if (targetPeriod === input.period) {
    throw new ApiError(400, 'Kỳ bổ sung phải khác kỳ lương gốc');
  }
  return {
    handlingMode: 'SUPPLEMENTARY_PERIOD',
    targetPeriod,
    note,
  };
}

/**
 * Approved exclusions now live in salary_period_exclusions (migration 0070);
 * latest row per driver wins, mirroring the old governance-map ordering.
 */
export async function loadApprovedExclusionMap(
  tx: Tx | typeof db,
  period: string,
): Promise<Map<number, SalaryPeriodApprovedExclusion>> {
  const rows = await tx.select()
    .from(s.salaryPeriodExclusions)
    .where(eq(s.salaryPeriodExclusions.period, period))
    .orderBy(desc(s.salaryPeriodExclusions.updatedAt), desc(s.salaryPeriodExclusions.id));

  const map = new Map<number, SalaryPeriodApprovedExclusion>();
  for (const row of rows) {
    if (map.has(row.driverId)) continue;
    map.set(row.driverId, {
      actionId: row.id,
      driverId: row.driverId,
      handlingMode: row.handlingMode as SalaryExclusionHandlingMode,
      targetPeriod: row.targetPeriod,
      reason: row.reason,
      note: row.note,
      approvedBy: row.requestedBy,
      approvedAt: row.requestedAt.toISOString(),
      followupStatus: row.followupStatus === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
      followupCompletedAt: row.followupCompletedAt?.toISOString() ?? null,
    });
  }
  return map;
}

export async function buildSalaryPeriodReadinessSummary(
  tx: Tx | typeof db,
  period: string,
): Promise<SalaryPeriodReadinessSummary> {
  const { year, month } = parsePeriod(period);
  const range = await resolveSalaryPeriodDateRange(month, year);
  const { salaryPayrollBusinessUnitId } = await getAppSettings();

  const drivers = await tx.selectDistinct({
    driverId: s.drivers.id,
    driverName: s.drivers.name,
  }).from(s.drivers)
    .leftJoin(s.users, eq(s.users.id, s.drivers.userId))
    .leftJoin(
      s.userBusinessUnitLinks,
      eq(s.userBusinessUnitLinks.userId, s.drivers.userId),
    )
    .where(and(
      isNull(s.drivers.deletedAt),
      eq(s.drivers.status, 'ACTIVE'),
      or(isNull(s.users.id), eq(s.users.status, 'ACTIVE')),
      salaryPayrollBusinessUnitId == null
        ? undefined
        : eq(s.userBusinessUnitLinks.businessUnitId, salaryPayrollBusinessUnitId),
    ))
    .orderBy(s.drivers.name);

  const [payrollUnit] = salaryPayrollBusinessUnitId == null
    ? []
    : await tx.select({
      id: s.businessUnits.id,
      name: s.businessUnits.name,
    }).from(s.businessUnits)
      .where(and(
        eq(s.businessUnits.id, salaryPayrollBusinessUnitId),
        eq(s.businessUnits.status, 'ACTIVE'),
      ))
      .limit(1);
  if (salaryPayrollBusinessUnitId != null && !payrollUnit) {
    throw new ApiError(
      409,
      'Đơn vị tính lương đã cấu hình không còn hoạt động. Vui lòng chọn lại trong Cài đặt ứng dụng.',
    );
  }
  const scope = salaryPayrollBusinessUnitId == null ? 'COMPANY' : 'BUSINESS_UNIT';

  const driverIds = drivers.map((driver) => driver.driverId);
  if (driverIds.length === 0) {
    const blockingReason = scope === 'BUSINESS_UNIT'
      ? `Đơn vị tính lương${payrollUnit?.name ? ` "${payrollUnit.name}"` : ''} chưa có lái xe đang hoạt động nên chưa thể chốt kỳ lương ${period}.`
      : `Chưa có lái xe đang hoạt động nên chưa thể chốt kỳ lương ${period}.`;
    return {
      period,
      scope,
      businessUnitId: payrollUnit?.id ?? null,
      businessUnitName: payrollUnit?.name ?? null,
      canClose: false,
      blockingReason,
      blockingDriverIds: [],
      drivers: [],
    };
  }

  const [confirmations, workDays, completedTrips, approvedExclusions] = await Promise.all([
    tx.select({
      driverId: s.salaryConfirmations.driverId,
      status: s.salaryConfirmations.status,
    }).from(s.salaryConfirmations)
      .where(and(
        inArray(s.salaryConfirmations.driverId, driverIds),
        eq(s.salaryConfirmations.year, year),
        eq(s.salaryConfirmations.month, month),
      )),
    tx.select({
      driverId: s.driverWorkDays.driverId,
      date: s.driverWorkDays.date,
      status: s.driverWorkDays.status,
      tripId: s.driverWorkDays.tripId,
      note: s.driverWorkDays.note,
    }).from(s.driverWorkDays)
      .where(and(
        inArray(s.driverWorkDays.driverId, driverIds),
        gte(s.driverWorkDays.date, range.start),
        lte(s.driverWorkDays.date, range.end),
      )),
    tx.select({
      id: s.trips.id,
      driverId: s.trips.driverId,
      departureDate: s.trips.departureDate,
      completedAt: s.trips.completedAt,
      status: s.trips.status,
    }).from(s.trips)
      .where(and(
        inArray(s.trips.driverId, driverIds),
        isNull(s.trips.deletedAt),
        eq(s.trips.status, TripStatus.COMPLETED),
        sql`${s.trips.completedAt} is not null`,
      )),
    loadApprovedExclusionMap(tx, period),
  ]);

  const confirmationMap = new Map(confirmations.map((row) => [row.driverId, row.status]));
  const workDayMap = new Map<string, { status: string; tripId: number | null; note: string | null }>();
  for (const row of workDays) {
    workDayMap.set(`${row.driverId}:${row.date}`, {
      status: row.status,
      tripId: row.tripId,
      note: row.note,
    });
  }

  const completedTripsByDriver = new Map<number, Array<{ tripId: number; departureDate: string; completedDate: string }>>();
  for (const trip of completedTrips) {
    const driverId = trip.driverId ?? null;
    if (!driverId) continue;
    const completedDate = toBusinessDateString(trip.completedAt);
    if (!completedDate) continue;
    if (completedDate < range.start || completedDate > range.end) continue;
    const existing = completedTripsByDriver.get(driverId) ?? [];
    existing.push({
      tripId: trip.id,
      departureDate: trip.departureDate,
      completedDate,
    });
    completedTripsByDriver.set(driverId, existing);
  }

  const readinessDrivers: SalaryPeriodDriverReadiness[] = drivers.map((driver) => {
    const issues: SalaryPeriodDriverIssue[] = [];

    if (confirmationMap.get(driver.driverId) !== 'CONFIRMED') {
      issues.push({
        code: 'UNCONFIRMED_SALARY',
        message: 'Lương kỳ này chưa được xác nhận.',
      });
    }

    for (const row of workDays) {
      if (row.driverId !== driver.driverId) continue;
      if (row.status === 'PERSONAL_LEAVE' && !(row.note ?? '').trim()) {
        issues.push({
          code: 'PERSONAL_LEAVE_NOTE_MISSING',
          message: `Ngày nghỉ riêng ${row.date} thiếu ghi chú bắt buộc.`,
        });
      }
      if (row.status === 'TRIP_DAY' && row.tripId == null) {
        issues.push({
          code: 'MANUAL_TRIP_DAY',
          message: `Ngày đi chuyến ${row.date} không gắn với chuyến hoàn thành thực tế.`,
        });
      }
    }

    for (const trip of completedTripsByDriver.get(driver.driverId) ?? []) {
      for (const date of iterateInclusiveDates(trip.departureDate, trip.completedDate)) {
        if (date < range.start || date > range.end) continue;
        const row = workDayMap.get(`${driver.driverId}:${date}`);
        if (row?.status === 'TRIP_DAY' && row.tripId === trip.tripId) continue;
        issues.push({
          code: 'MISSING_TRIP_DAY',
          message: `Chuyến chưa có mã hoàn thành trong kỳ nhưng thiếu ngày công thực tế ${date}.`,
        });
        break;
      }
    }

    const uniqueIssues = issues.filter((issue, index, arr) =>
      arr.findIndex((candidate) => candidate.code === issue.code && candidate.message === issue.message) === index);
    const exclusion = approvedExclusions.get(driver.driverId) ?? null;
    return {
      driverId: driver.driverId,
      driverName: driver.driverName,
      status: uniqueIssues.length === 0 ? 'READY' : 'PENDING',
      issues: uniqueIssues,
      exclusion,
    };
  });

  const blockingDriverIds = readinessDrivers
    .filter((driver) => driver.status !== 'READY' && driver.exclusion == null)
    .map((driver) => driver.driverId);

  return {
    period,
    scope,
    businessUnitId: payrollUnit?.id ?? null,
    businessUnitName: payrollUnit?.name ?? null,
    canClose: blockingDriverIds.length === 0,
    blockingReason: null,
    blockingDriverIds,
    drivers: readinessDrivers,
  };
}

export function throwSalaryReadinessBlocked(
  period: string,
  readiness: SalaryPeriodReadinessSummary,
): never {
  if (readiness.blockingDriverIds.length === 0 && readiness.blockingReason) {
    throw new ApiError(409, readiness.blockingReason);
  }
  const blockingNames = readiness.drivers
    .filter((driver) => readiness.blockingDriverIds.includes(driver.driverId))
    .map((driver) => driver.driverName);
  throw new ApiError(
    409,
    `Kỳ lương ${period} còn lái xe chờ xử lý: ${blockingNames.join(', ')}. Muốn chốt phần còn lại phải có loại trừ đã duyệt sang kỳ bổ sung hoặc điều chỉnh.`,
  );
}

export async function assertSalaryPeriodCanReopen(tx: Tx, period: string): Promise<void> {
  if (await hasSalaryPeriodDriverPayout(tx, period)) {
    throw new ApiError(
      409,
      `Kỳ lương ${period} đã có thanh toán, phải xử lý bằng điều chỉnh bổ sung thay vì mở lại trực tiếp.`,
    );
  }
}

/**
 * Stable 32-bit hash of the period string → used as the advisory-lock
 * entityId. Same period → same key across processes.
 */
export function periodLockKey(period: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < period.length; i++) {
    h ^= period.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 0x7fffffff;
}

/** Parse 'YYYY-MM' into { year, month }. Throws on malformed input. */
export function parsePeriod(period: string): { year: number; month: number } {
  if (!PERIOD_PATTERN.test(period)) {
    throw new ApiError(400, `Kỳ lương không hợp lệ (nhận "${period}", phải dạng YYYY-MM)`);
  }
  const [yearStr, monthStr] = period.split('-');
  return { year: Number(yearStr), month: Number(monthStr) };
}

/**
 * Sum all DRIVER_SALARY credits in the period range. Per-driver entries
 * posted by trip locks have entityType='DRIVER', txnType=DRIVER_SALARY,
 * and credit=driverSalary. Sum the credit column for entries whose
 * timestamp falls in [start, end].
 */
export async function sumDriverSalaryInPeriod(
  tx: Tx,
  start: string,
  end: string,
  driverIds: number[],
): Promise<number> {
  if (driverIds.length === 0) return 0;
  const rows = await tx.select({
    credit: s.ledger.credit,
    departureDate: s.trips.departureDate,
    completedAt: s.trips.completedAt,
  })
    .from(s.ledger)
    .innerJoin(s.trips, eq(s.trips.id, s.ledger.txnId))
    .where(and(
      eq(s.ledger.entityType, 'DRIVER'),
      eq(s.ledger.txnType, TxnType.DRIVER_SALARY),
      sql`${s.ledger.entityId} <> ${COMPANY_DRIVER_ENTITY_ID}`,
      inArray(s.ledger.entityId, driverIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ));

  return rows.reduce((sum, row) => {
    const basisDate = toBusinessDateString(row.completedAt) ?? row.departureDate;
    if (!basisDate || basisDate < start || basisDate > end) return sum;
    return sum + Number(row.credit);
  }, 0);
}

export function mapReopenBlockers(input: {
  period: string;
  payslipIssuedAt: Date | null;
  officialPostedAt: Date | null;
  hasDriverPayout: boolean;
}): string[] {
  const blockers: string[] = [];
  if (input.payslipIssuedAt) {
    blockers.push(`Kỳ lương ${input.period} đã phát hành phiếu lương`);
  }
  if (input.hasDriverPayout) {
    blockers.push(`Kỳ lương ${input.period} đã có thanh toán cho lái xe`);
  }
  if (input.officialPostedAt) {
    blockers.push(`Kỳ lương ${input.period} đã được đánh dấu hạch toán chính thức`);
  }
  return blockers;
}

export function requireGovernanceReason(
  reason: string | null | undefined,
  fallback: string,
): string {
  const normalized = reason?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

export function toGovernanceActionView(action: GovernanceActionRow) {
  return {
    id: action.id,
    subjectType: action.subjectType,
    subjectId: action.subjectId,
    subjectKey: action.subjectKey,
    actionKind: action.actionKind,
    status: action.status,
    version: action.version,
    reason: action.reason,
    makerId: action.makerId,
    makerRole: action.makerRole,
    checkerId: action.checkerId,
    checkerRole: action.checkerRole,
    approverId: action.approverId,
    approverRole: action.approverRole,
    createdAt: action.createdAt.toISOString(),
    checkedAt: action.checkedAt?.toISOString() ?? null,
    approvedAt: action.approvedAt?.toISOString() ?? null,
    beforeSnapshot: action.beforeSnapshot,
    afterSnapshot: action.afterSnapshot,
    deltaSnapshot: action.deltaSnapshot,
  };
}

export function assertSalaryPeriodGovernanceAction(
  action: GovernanceActionRow,
  period: string,
  actionKind: typeof SALARY_PERIOD_CLOSE_ACTION_KIND | typeof SALARY_PERIOD_REOPEN_ACTION_KIND,
): void {
  if (
    action.subjectType !== SALARY_PERIOD_SUBJECT_TYPE
    || action.subjectKey !== period
    || action.actionKind !== actionKind
  ) {
    throw new ApiError(404, 'Không tìm thấy yêu cầu quản trị kỳ lương phù hợp');
  }
}

export function buildCloseResult(
  closeRow: typeof s.salaryPeriodCloses.$inferSelect,
  periodTotalSalary: number,
  idempotentNoop: boolean,
): SalaryPeriodCloseResult {
  return {
    closeId: closeRow.id,
    period: closeRow.period,
    status: closeRow.status,
    version: closeRow.version,
    periodTotalSalary,
    ledgerEntryId: closeRow.ledgerEntryId,
    closedBy: closeRow.closedBy,
    closedAt: closeRow.closedAt.toISOString(),
    note: closeRow.note,
    payslipIssuedBy: closeRow.payslipIssuedBy,
    payslipIssuedAt: closeRow.payslipIssuedAt?.toISOString() ?? null,
    payslipIssuedNote: closeRow.payslipIssuedNote,
    officialPostedBy: closeRow.officialPostedBy,
    officialPostedAt: closeRow.officialPostedAt?.toISOString() ?? null,
    officialPostingNote: closeRow.officialPostingNote,
    idempotentNoop,
    scope: closeRow.payrollScope as 'COMPANY' | 'BUSINESS_UNIT' | null,
    businessUnitId: closeRow.payrollBusinessUnitId,
    businessUnitName: closeRow.payrollBusinessUnitName,
    includedDriverIds: closeRow.includedDriverIds,
    excludedDriverIds: closeRow.excludedDriverIds,
    payrollProvenanceCapturedAt: closeRow.payrollProvenanceCapturedAt?.toISOString() ?? null,
  };
}

export async function hasSalaryPeriodDriverPayout(tx: Tx | typeof db, period: string): Promise<boolean> {
  const { year, month } = parsePeriod(period);
  const range = await resolveSalaryPeriodDateRange(month, year);
  const [payout] = await tx.select({ id: s.ledger.id })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'DRIVER'),
      eq(s.ledger.txnType, TxnType.DRIVER_PAYOUT),
      gte(sql`coalesce(date(${s.ledger.timestamp}), date(${s.ledger.createdAt}))`, range.start),
      lte(sql`coalesce(date(${s.ledger.timestamp}), date(${s.ledger.createdAt}))`, range.end),
    ))
    .limit(1);
  return Boolean(payout);
}
/** Read the credit amount of a summary ledger entry (0 if missing). */
export async function readSummaryAmount(tx: Tx, ledgerEntryId: number | null): Promise<number> {
  if (!ledgerEntryId) return 0;
  const [row] = await tx.select({ credit: s.ledger.credit })
    .from(s.ledger)
    .where(eq(s.ledger.id, ledgerEntryId))
    .limit(1);
  return Number(row?.credit ?? 0);
}
