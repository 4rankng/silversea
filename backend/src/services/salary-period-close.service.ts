/**
 * Wave 3 M7.3 — salary period close service.
 *
 * Closes a salary period so no further driver-salary edits are allowed
 * for trips whose departureDate falls in the period range. Closing:
 *   1. Acquires a per-period advisory lock (serializes concurrent closes).
 *   2. Sums all DRIVER_SALARY credits in the period range (across all
 *      drivers) into periodTotalSalary.
 *   3. Posts ONE consolidated summary ledger entry on a synthetic
 *      COMPANY entity (entityType='DRIVER', entityId=0, txnType=
 *      ADJUSTMENT — NOT DRIVER_SALARY, so per-driver aggregate queries
 *      don't double-count).
 *   4. Inserts a salary_period_closes row pointing at the summary entry.
 *
 * Idempotent: re-closing the same period returns the existing row and
 * posts zero new ledger entries.
 *
 * "Lock" = per-period advisory lock via LedgerService.lockEntity on a
 * synthetic entityType ('SALARY_PERIOD_CLOSE') keyed by a stable hash
 * of the period string.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { TxnType, FINANCIAL_ROLES, TripStatus } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { resolveSalaryPeriodDateRange } from './salary-period.service';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  closePeriodLock,
  reopenPeriodLock,
  resolveSalaryPeriodAuthority,
} from './period-lock.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  approveGovernanceActionWithAdapter,
  checkGovernanceAction,
  type GovernanceActionRow,
  type GovernanceApplyResult,
} from './governance-action-core.service';
import { getAppSettings } from './app-settings.service';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CLOSE_ENTITY_TYPE = 'SALARY_PERIOD_CLOSE';
const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const SALARY_EXCLUSION_SUBJECT_TYPE = 'SALARY_PERIOD';
const SALARY_EXCLUSION_ACTION_KIND = 'FINANCIAL_EXCEPTION';
const SALARY_PERIOD_SUBJECT_TYPE = 'SALARY_PERIOD';
const SALARY_PERIOD_CLOSE_ACTION_KIND = 'SALARY_PERIOD_CLOSE';
const SALARY_PERIOD_REOPEN_ACTION_KIND = 'SALARY_PERIOD_REOPEN';
// entityId=0 is a sentinel for "company aggregate" — no real driver has
// id=0 (serial starts at 1). The summary entry is for audit/
// reconciliation, not for recomputing driver payable balances.
const COMPANY_DRIVER_ENTITY_ID = 0;

type SalaryDriverIssueCode =
  | 'UNCONFIRMED_SALARY'
  | 'PERSONAL_LEAVE_NOTE_MISSING'
  | 'MANUAL_TRIP_DAY'
  | 'MISSING_TRIP_DAY';

type SalaryExclusionHandlingMode = 'SUPPLEMENTARY_PERIOD' | 'ADJUSTMENT';

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
  actionId: number;
  version: number;
  period: string;
  driverId: number;
  status: 'PENDING_CHECK' | 'PENDING_APPROVAL' | 'APPROVED';
  handlingMode: SalaryExclusionHandlingMode;
  targetPeriod: string | null;
  reason: string;
  note: string | null;
  makerId: number;
  checkerId: number | null;
  approverId: number | null;
  followupStatus: 'PENDING' | 'COMPLETED' | null;
  followupCompletedAt: string | null;
}

function toBusinessDateString(value: Date | string | null | undefined): string | null {
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

function iterateInclusiveDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00.000Z`);
  const stop = new Date(`${end}T00:00:00.000Z`);
  while (current.getTime() <= stop.getTime()) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function exclusionSubjectKey(period: string, driverId: number): string {
  return `${period}:${driverId}`;
}

function parseExclusion(afterSnapshot: Record<string, unknown> | null | undefined): {
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

function normalizeExclusionHandling(input: {
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

async function loadApprovedExclusionMap(
  tx: Tx | typeof db,
  period: string,
): Promise<Map<number, SalaryPeriodApprovedExclusion>> {
  const rows = await tx.select({
    id: s.governanceActions.id,
    subjectKey: s.governanceActions.subjectKey,
    reason: s.governanceActions.reason,
    approverId: s.governanceActions.approverId,
    approvedAt: s.governanceActions.approvedAt,
    afterSnapshot: s.governanceActions.afterSnapshot,
    applicationResult: s.governanceActions.applicationResult,
    updatedAt: s.governanceActions.updatedAt,
  }).from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, SALARY_EXCLUSION_SUBJECT_TYPE),
      eq(s.governanceActions.actionKind, SALARY_EXCLUSION_ACTION_KIND),
      eq(s.governanceActions.status, 'APPROVED'),
      sql`${s.governanceActions.subjectKey} like ${`${period}:%`}`,
    ))
    .orderBy(desc(s.governanceActions.updatedAt), desc(s.governanceActions.id));

  const map = new Map<number, SalaryPeriodApprovedExclusion>();
  for (const row of rows) {
    if (!row.subjectKey) continue;
    const [, driverIdRaw] = row.subjectKey.split(':');
    const driverId = Number(driverIdRaw);
    if (!Number.isInteger(driverId) || driverId < 1 || map.has(driverId)) continue;
    const afterSnapshot = row.afterSnapshot as Record<string, unknown> | null;
    const parsed = parseExclusion(afterSnapshot);
    const applicationResult = row.applicationResult as Record<string, unknown> | null;
    const followupStatus = applicationResult?.followupStatus === 'COMPLETED'
      ? 'COMPLETED'
      : 'PENDING';
    map.set(driverId, {
      actionId: row.id,
      driverId,
      handlingMode: parsed.handlingMode,
      targetPeriod: parsed.targetPeriod,
      reason: row.reason,
      note: parsed.note,
      approvedBy: row.approverId,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      followupStatus,
      followupCompletedAt: typeof applicationResult?.followupCompletedAt === 'string'
        ? applicationResult.followupCompletedAt
        : null,
    });
  }
  return map;
}

async function buildSalaryPeriodReadinessSummary(
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

function throwSalaryReadinessBlocked(
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

async function assertSalaryPeriodCanReopen(tx: Tx, period: string): Promise<void> {
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
function periodLockKey(period: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < period.length; i++) {
    h ^= period.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 0x7fffffff;
}

/** Parse 'YYYY-MM' into { year, month }. Throws on malformed input. */
function parsePeriod(period: string): { year: number; month: number } {
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
async function sumDriverSalaryInPeriod(
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

function mapReopenBlockers(input: {
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

function requireGovernanceReason(
  reason: string | null | undefined,
  fallback: string,
): string {
  const normalized = reason?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function toGovernanceActionView(action: GovernanceActionRow) {
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

function assertSalaryPeriodGovernanceAction(
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

function buildCloseResult(
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

async function hasSalaryPeriodDriverPayout(tx: Tx | typeof db, period: string): Promise<boolean> {
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

/**
 * Close a salary period. Idempotent: re-closing the same period returns
 * the existing row and posts zero new ledger entries.
 */
export async function closeSalaryPeriod(input: {
  period: string;
  actorId: number;
  actorRole: string;
  note?: string | null;
  expectedVersion?: number | null;
  transaction?: Tx;
}): Promise<SalaryPeriodCloseResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền chốt kỳ lương');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  const { year, month } = parsePeriod(input.period);
  const authority = await resolveSalaryPeriodAuthority(input.period);

  const execute = async (tx: Tx) => {
    // Per-period advisory lock — concurrent closes serialize here.
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));

    // Idempotent: existing CLOSED row → return it unchanged.
    const [existing] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (input.expectedVersion != null) {
      if (!existing) {
        if (input.expectedVersion !== 0) {
          throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi chốt.');
        }
      } else if (existing.version !== input.expectedVersion) {
        throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi chốt.');
      }
    }
    if (existing && existing.status === 'CLOSED') {
      await closePeriodLock(tx, authority, input.actorId, existing.note);
      // Pull the summary amount from the original ledger entry.
      const summaryAmt = await readSummaryAmount(tx, existing.ledgerEntryId);
      return buildCloseResult(existing, summaryAmt, true);
    }

    // Resolve the date range for this period (override → default → calendar).
    const range = await resolveSalaryPeriodDateRange(month, year);
    const readiness = await buildSalaryPeriodReadinessSummary(tx, input.period);
    if (!readiness.canClose) {
      throwSalaryReadinessBlocked(input.period, readiness);
    }
    const periodTotalSalary = await sumDriverSalaryInPeriod(
      tx,
      range.start,
      range.end,
      readiness.drivers.map((driver) => driver.driverId),
    );

    // Post ONE consolidated summary entry. ADJUSTMENT txnType (NOT
    // DRIVER_SALARY) so per-driver payable aggregates don't double-count.
    // entityId=0 = company-aggregate sentinel.
    const note = input.note?.trim() || `Chốt kỳ lương T${month}/${year}`;
    const entry = await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      entityType: 'DRIVER',
      entityId: COMPANY_DRIVER_ENTITY_ID,
      debit: 0,
      credit: periodTotalSalary,
      note,
    });

    // Insert the close row (or revive a REOPENED row back to CLOSED).
    let closeRow: typeof s.salaryPeriodCloses.$inferSelect;
    if (existing && existing.status === 'REOPENED') {
      const [updated] = await tx.update(s.salaryPeriodCloses)
        .set({
          status: 'CLOSED',
          ledgerEntryId: entry.id,
          closedBy: input.actorId,
          closedAt: new Date(),
          note,
          payrollScope: readiness.scope,
          payrollBusinessUnitId: readiness.businessUnitId,
          payrollBusinessUnitName: readiness.businessUnitName,
          includedDriverIds: readiness.drivers.map((driver) => driver.driverId),
          excludedDriverIds: readiness.drivers
            .filter((driver) => driver.exclusion != null)
            .map((driver) => driver.driverId),
          payrollProvenanceCapturedAt: new Date(),
          version: sql`${s.salaryPeriodCloses.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(s.salaryPeriodCloses.id, existing.id))
        .returning();
      closeRow = updated!;
    } else {
      const [inserted] = await tx.insert(s.salaryPeriodCloses).values({
        period: input.period,
        status: 'CLOSED',
        ledgerEntryId: entry.id,
        closedBy: input.actorId,
        note,
        payrollScope: readiness.scope,
        payrollBusinessUnitId: readiness.businessUnitId,
        payrollBusinessUnitName: readiness.businessUnitName,
        includedDriverIds: readiness.drivers.map((driver) => driver.driverId),
        excludedDriverIds: readiness.drivers
          .filter((driver) => driver.exclusion != null)
          .map((driver) => driver.driverId),
        payrollProvenanceCapturedAt: new Date(),
      }).returning();
      closeRow = inserted!;
    }
    await closePeriodLock(tx, authority, input.actorId, note);

    return buildCloseResult(closeRow, periodTotalSalary, false);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

/**
 * Reopen a salary period (allows further edits). Posts a reversing
 * entry against the original summary so the company-aggregate total
 * reflects the open state. Idempotent on an already-REOPENED period.
 */
export async function reopenSalaryPeriod(input: {
  period: string;
  actorId: number;
  actorRole: string;
  note?: string | null;
  expectedVersion?: number | null;
  transaction?: Tx;
}): Promise<SalaryPeriodCloseResult> {
  if (input.actorRole !== 'ADMIN' && input.actorRole !== 'MANAGER') {
    throw new ApiError(403, 'Bạn không có quyền mở lại kỳ lương');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  parsePeriod(input.period); // validate format
  const authority = await resolveSalaryPeriodAuthority(input.period);

  const execute = async (tx: Tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));

    const [existing] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (!existing) {
      throw new ApiError(404, `Kỳ lương ${input.period} chưa được chốt, không thể mở lại`);
    }
    if (input.expectedVersion != null && existing.version !== input.expectedVersion) {
      throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi mở lại.');
    }
    if (existing.status === 'REOPENED') {
      const summaryAmt = await readSummaryAmount(tx, existing.ledgerEntryId);
      return buildCloseResult(existing, summaryAmt, true);
    }

    const reopenBlockers = mapReopenBlockers({
      period: input.period,
      payslipIssuedAt: existing.payslipIssuedAt,
      officialPostedAt: existing.officialPostedAt,
      hasDriverPayout: await hasSalaryPeriodDriverPayout(tx, input.period),
    });
    if (reopenBlockers.length > 0) {
      throw new ApiError(409, `${reopenBlockers[0]}, phải xử lý bằng điều chỉnh bổ sung.`);
    }
    await assertSalaryPeriodCanReopen(tx, input.period);

    // Post reversing entry mirroring the original summary.
    const originalAmount = await readSummaryAmount(tx, existing.ledgerEntryId);
    const reopenNote = input.note?.trim() || `Mở lại kỳ lương ${input.period}`;
    const entry = await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      entityType: 'DRIVER',
      entityId: COMPANY_DRIVER_ENTITY_ID,
      debit: originalAmount,
      credit: 0,
      note: reopenNote,
    });
    // Stamp the new reversal on the close row.
    const [updated] = await tx.update(s.salaryPeriodCloses)
      .set({
        status: 'REOPENED',
        ledgerEntryId: entry.id, // now points at the latest entry (reversal)
        note: reopenNote,
        version: sql`${s.salaryPeriodCloses.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(s.salaryPeriodCloses.id, existing.id))
      .returning();
    await reopenPeriodLock(tx, authority, input.actorId, reopenNote);
    return buildCloseResult(updated!, originalAmount, false);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

/** Read the credit amount of a summary ledger entry (0 if missing). */
async function readSummaryAmount(tx: Tx, ledgerEntryId: number | null): Promise<number> {
  if (!ledgerEntryId) return 0;
  const [row] = await tx.select({ credit: s.ledger.credit })
    .from(s.ledger)
    .where(eq(s.ledger.id, ledgerEntryId))
    .limit(1);
  return Number(row?.credit ?? 0);
}

/** Get one close row by period (or null). */
export async function getSalaryPeriodClose(period: string) {
  const [row] = await db.select()
    .from(s.salaryPeriodCloses)
    .where(eq(s.salaryPeriodCloses.period, period))
    .limit(1);
  return row ?? null;
}

export async function getSalaryPeriodLifecycle(period: string): Promise<SalaryPeriodLifecycleState> {
  parsePeriod(period);
  const closeRow = await getSalaryPeriodClose(period);
  const hasDriverPayout = await hasSalaryPeriodDriverPayout(db, period);

  if (!closeRow) {
    return {
      period,
      status: 'OPEN',
      closeId: null,
      version: null,
      ledgerEntryId: null,
      closedBy: null,
      closedAt: null,
      note: null,
      payslipIssuedBy: null,
      payslipIssuedAt: null,
      payslipIssuedNote: null,
      officialPostedBy: null,
      officialPostedAt: null,
      officialPostingNote: null,
      hasDriverPayout,
      canReopen: false,
      reopenBlockers: ['Kỳ lương chưa được chốt'],
    };
  }

  const reopenBlockers = closeRow.status === 'REOPENED'
    ? ['Kỳ lương đang ở trạng thái mở lại']
    : mapReopenBlockers({
        period,
        payslipIssuedAt: closeRow.payslipIssuedAt,
        officialPostedAt: closeRow.officialPostedAt,
        hasDriverPayout,
      });

  return {
    period,
    status: closeRow.status as 'CLOSED' | 'REOPENED',
    closeId: closeRow.id,
    version: closeRow.version,
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
    hasDriverPayout,
    canReopen: closeRow.status === 'CLOSED' && reopenBlockers.length === 0,
    reopenBlockers,
  };
}

/** List all close rows, newest first. */
export async function listSalaryPeriodCloses() {
  return db.select()
    .from(s.salaryPeriodCloses)
    .orderBy(desc(s.salaryPeriodCloses.period));
}

export async function issueSalaryPeriodPayslips(input: {
  period: string;
  actorId: number;
  actorRole: string;
  note?: string | null;
  expectedVersion?: number | null;
  transaction?: Tx;
}): Promise<SalaryPeriodCloseResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền phát hành phiếu lương');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  parsePeriod(input.period);

  const execute = async (tx: Tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));
    const [closeRow] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (!closeRow || closeRow.status !== 'CLOSED') {
      throw new ApiError(409, `Kỳ lương ${input.period} chưa ở trạng thái đã chốt để phát hành phiếu lương`);
    }
    if (input.expectedVersion != null && closeRow.version !== input.expectedVersion) {
      throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi phát hành phiếu lương.');
    }
    if (closeRow.payslipIssuedAt) {
      const summaryAmt = await readSummaryAmount(tx, closeRow.ledgerEntryId);
      return buildCloseResult(closeRow, summaryAmt, true);
    }

    const [updated] = await tx.update(s.salaryPeriodCloses)
      .set({
        payslipIssuedBy: input.actorId,
        payslipIssuedAt: new Date(),
        payslipIssuedNote: input.note?.trim() || null,
        version: sql`${s.salaryPeriodCloses.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(s.salaryPeriodCloses.id, closeRow.id))
      .returning();

    const summaryAmt = await readSummaryAmount(tx, updated!.ledgerEntryId);
    return buildCloseResult(updated!, summaryAmt, false);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function markSalaryPeriodOfficialPosting(input: {
  period: string;
  actorId: number;
  actorRole: string;
  note?: string | null;
  expectedVersion?: number | null;
  transaction?: Tx;
}): Promise<SalaryPeriodCloseResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền đánh dấu hạch toán chính thức');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  parsePeriod(input.period);

  const execute = async (tx: Tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));
    const [closeRow] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (!closeRow || closeRow.status !== 'CLOSED') {
      throw new ApiError(409, `Kỳ lương ${input.period} chưa ở trạng thái đã chốt để hạch toán chính thức`);
    }
    if (!closeRow.payslipIssuedAt) {
      throw new ApiError(409, `Kỳ lương ${input.period} chưa phát hành phiếu lương, chưa thể đánh dấu hạch toán chính thức`);
    }
    if (input.expectedVersion != null && closeRow.version !== input.expectedVersion) {
      throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi hạch toán chính thức.');
    }
    if (closeRow.officialPostedAt) {
      const summaryAmt = await readSummaryAmount(tx, closeRow.ledgerEntryId);
      return buildCloseResult(closeRow, summaryAmt, true);
    }

    const [updated] = await tx.update(s.salaryPeriodCloses)
      .set({
        officialPostedBy: input.actorId,
        officialPostedAt: new Date(),
        officialPostingNote: input.note?.trim() || null,
        version: sql`${s.salaryPeriodCloses.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(s.salaryPeriodCloses.id, closeRow.id))
      .returning();

    const summaryAmt = await readSummaryAmount(tx, updated!.ledgerEntryId);
    return buildCloseResult(updated!, summaryAmt, false);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function requestSalaryPeriodClose(input: {
  period: string;
  actorId: number;
  actorRole: string;
  reason?: string | null;
  note?: string | null;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction(SALARY_PERIOD_CLOSE_ACTION_KIND, input.actorRole);
  parsePeriod(input.period);
  const reason = requireGovernanceReason(
    input.reason,
    `Đề nghị chốt kỳ lương ${input.period}`,
  );
  const note = input.note?.trim() || null;

  const execute = async (tx: Tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));
    const [existingClose] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1)
      .for('update');
    if (existingClose?.status === 'CLOSED') {
      throw new ApiError(409, `Kỳ lương ${input.period} đã được chốt.`);
    }

    const readiness = await buildSalaryPeriodReadinessSummary(tx, input.period);
    if (!readiness.canClose) {
      throwSalaryReadinessBlocked(input.period, readiness);
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: SALARY_PERIOD_SUBJECT_TYPE,
      subjectKey: input.period,
      actionKind: SALARY_PERIOD_CLOSE_ACTION_KIND,
      status: 'PENDING_CHECK',
      reason,
      originalVersion: existingClose?.version ?? 0,
      beforeSnapshot: {
        lifecycle: existingClose
          ? {
              status: existingClose.status,
              version: existingClose.version,
              closeId: existingClose.id,
            }
          : {
              status: 'OPEN',
              version: 0,
              closeId: null,
            },
        readiness,
      },
      afterSnapshot: {
        period: input.period,
        requestedNote: note,
      },
      deltaSnapshot: null,
      makerId: input.actorId,
      makerRole: input.actorRole,
    }).returning();
    return toGovernanceActionView(action);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function checkSalaryPeriodClose(input: {
  period: string;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  transaction?: Tx;
}) {
  const action = await checkGovernanceAction({
    actionId: input.actionId,
    checkerId: input.actorId,
    checkerRole: input.actorRole,
    expectedVersion: input.expectedVersion,
    transaction: input.transaction,
  });
  assertSalaryPeriodGovernanceAction(action, input.period, SALARY_PERIOD_CLOSE_ACTION_KIND);
  return toGovernanceActionView(action);
}

export async function approveSalaryPeriodClose(input: {
  period: string;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  transaction?: Tx;
}) {
  const action = await approveGovernanceActionWithAdapter({
    actionId: input.actionId,
    approverId: input.actorId,
    approverRole: input.actorRole,
    expectedVersion: input.expectedVersion,
    transaction: input.transaction,
    apply: async (tx, governanceAction): Promise<GovernanceApplyResult> => {
      assertSalaryPeriodGovernanceAction(governanceAction, input.period, SALARY_PERIOD_CLOSE_ACTION_KIND);
      const afterSnapshot = governanceAction.afterSnapshot as Record<string, unknown> | null;
      const result = await closeSalaryPeriod({
        period: input.period,
        actorId: input.actorId,
        actorRole: input.actorRole,
        note: typeof afterSnapshot?.requestedNote === 'string' ? afterSnapshot.requestedNote : null,
        expectedVersion: governanceAction.originalVersion,
        transaction: tx,
      });
      return {
        ledgerEntryId: result.ledgerEntryId,
        applicationResult: {
          closeId: result.closeId,
          status: result.status,
          version: result.version,
          periodTotalSalary: result.periodTotalSalary,
        },
      };
    },
  });
  assertSalaryPeriodGovernanceAction(action, input.period, SALARY_PERIOD_CLOSE_ACTION_KIND);
  return toGovernanceActionView(action);
}

export async function requestSalaryPeriodReopen(input: {
  period: string;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  reason?: string | null;
  note?: string | null;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction(SALARY_PERIOD_REOPEN_ACTION_KIND, input.actorRole);
  parsePeriod(input.period);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  const reason = input.reason?.trim() || input.note?.trim() || '';
  if (!reason) {
    throw new ApiError(400, 'Cần nhập lý do mở lại kỳ lương');
  }
  const note = input.note?.trim() || reason;

  const execute = async (tx: Tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));
    const [existingClose] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1)
      .for('update');
    if (!existingClose) {
      throw new ApiError(404, `Kỳ lương ${input.period} chưa được chốt, không thể mở lại`);
    }
    if (existingClose.status !== 'CLOSED') {
      throw new ApiError(409, `Kỳ lương ${input.period} đang ở trạng thái ${existingClose.status}, không thể đề nghị mở lại`);
    }
    if (existingClose.version !== input.expectedVersion) {
      throw new ApiError(409, 'Kỳ lương đã thay đổi. Vui lòng tải lại trước khi mở lại.');
    }

    const reopenBlockers = mapReopenBlockers({
      period: input.period,
      payslipIssuedAt: existingClose.payslipIssuedAt,
      officialPostedAt: existingClose.officialPostedAt,
      hasDriverPayout: await hasSalaryPeriodDriverPayout(tx, input.period),
    });
    if (reopenBlockers.length > 0) {
      throw new ApiError(409, `${reopenBlockers[0]}, phải xử lý bằng điều chỉnh bổ sung.`);
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: SALARY_PERIOD_SUBJECT_TYPE,
      subjectKey: input.period,
      actionKind: SALARY_PERIOD_REOPEN_ACTION_KIND,
      status: 'PENDING_CHECK',
      reason,
      originalVersion: existingClose.version,
      beforeSnapshot: {
        lifecycle: {
          status: existingClose.status,
          version: existingClose.version,
          closeId: existingClose.id,
          closedAt: existingClose.closedAt.toISOString(),
          note: existingClose.note,
        },
      },
      afterSnapshot: {
        period: input.period,
        requestedNote: note,
      },
      deltaSnapshot: null,
      makerId: input.actorId,
      makerRole: input.actorRole,
    }).returning();
    return toGovernanceActionView(action);
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function checkSalaryPeriodReopen(input: {
  period: string;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  transaction?: Tx;
}) {
  const action = await checkGovernanceAction({
    actionId: input.actionId,
    checkerId: input.actorId,
    checkerRole: input.actorRole,
    expectedVersion: input.expectedVersion,
    transaction: input.transaction,
  });
  assertSalaryPeriodGovernanceAction(action, input.period, SALARY_PERIOD_REOPEN_ACTION_KIND);
  return toGovernanceActionView(action);
}

export async function approveSalaryPeriodReopen(input: {
  period: string;
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion: number;
  transaction?: Tx;
}) {
  const action = await approveGovernanceActionWithAdapter({
    actionId: input.actionId,
    approverId: input.actorId,
    approverRole: input.actorRole,
    expectedVersion: input.expectedVersion,
    transaction: input.transaction,
    apply: async (tx, governanceAction): Promise<GovernanceApplyResult> => {
      assertSalaryPeriodGovernanceAction(governanceAction, input.period, SALARY_PERIOD_REOPEN_ACTION_KIND);
      const afterSnapshot = governanceAction.afterSnapshot as Record<string, unknown> | null;
      const result = await reopenSalaryPeriod({
        period: input.period,
        actorId: input.actorId,
        actorRole: input.actorRole,
        note: typeof afterSnapshot?.requestedNote === 'string' ? afterSnapshot.requestedNote : null,
        expectedVersion: governanceAction.originalVersion,
        transaction: tx,
      });
      return {
        ledgerEntryId: result.ledgerEntryId,
        applicationResult: {
          closeId: result.closeId,
          status: result.status,
          version: result.version,
        },
      };
    },
  });
  assertSalaryPeriodGovernanceAction(action, input.period, SALARY_PERIOD_REOPEN_ACTION_KIND);
  return toGovernanceActionView(action);
}

export async function getSalaryPeriodReadiness(period: string): Promise<SalaryPeriodReadinessSummary> {
  parsePeriod(period);
  return buildSalaryPeriodReadinessSummary(db, period);
}

export async function listSalaryPeriodExclusions(period: string): Promise<SalaryPeriodApprovedExclusion[]> {
  parsePeriod(period);
  const exclusions = await loadApprovedExclusionMap(db, period);
  return [...exclusions.values()].sort((left, right) => left.driverId - right.driverId);
}

export async function createSalaryPeriodExclusion(input: {
  period: string;
  driverId: number;
  actorId: number;
  actorRole: string;
  reason: string;
  handlingMode: SalaryExclusionHandlingMode;
  targetPeriod?: string | null;
  note?: string | null;
  transaction?: Tx;
}): Promise<SalaryPeriodExclusionResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền đề nghị loại trừ kỳ lương');
  }
  parsePeriod(input.period);
  const handling = normalizeExclusionHandling(input);

  const execute = async (tx: Tx): Promise<SalaryPeriodExclusionResult> => {
    const readiness = await buildSalaryPeriodReadinessSummary(tx, input.period);
    const driver = readiness.drivers.find((item) => item.driverId === input.driverId);
    if (!driver) {
      throw new ApiError(404, `Không tìm thấy lái xe đã chọn trong phạm vi kỳ lương ${input.period}`);
    }
    if (driver.issues.length === 0) {
      throw new ApiError(409, `Lái xe ${driver.driverName} đã sẵn sàng, không cần loại trừ khỏi kỳ ${input.period}`);
    }

    const [created] = await tx.insert(s.governanceActions).values({
      subjectType: SALARY_EXCLUSION_SUBJECT_TYPE,
      subjectKey: exclusionSubjectKey(input.period, input.driverId),
      actionKind: SALARY_EXCLUSION_ACTION_KIND,
      status: 'PENDING_CHECK',
      reason: input.reason.trim(),
      originalVersion: 1,
      beforeSnapshot: {
        period: input.period,
        driverId: input.driverId,
        driverName: driver.driverName,
        readinessStatus: driver.status,
        issues: driver.issues,
      },
      afterSnapshot: {
        handlingMode: handling.handlingMode,
        targetPeriod: handling.targetPeriod,
        note: handling.note,
      },
      makerId: input.actorId,
      makerRole: input.actorRole,
    }).returning();

    return {
      actionId: created.id,
      version: created.version,
      period: input.period,
      driverId: input.driverId,
      status: 'PENDING_CHECK',
      handlingMode: handling.handlingMode,
      targetPeriod: handling.targetPeriod,
      reason: created.reason,
      note: handling.note,
      makerId: created.makerId,
      checkerId: null,
      approverId: null,
      followupStatus: null,
      followupCompletedAt: null,
    };
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function checkSalaryPeriodExclusion(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion?: number | null;
  note?: string | null;
  transaction?: Tx;
}): Promise<SalaryPeriodExclusionResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền kiểm tra loại trừ kỳ lương');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }

  const execute = async (tx: Tx): Promise<SalaryPeriodExclusionResult> => {
    const [existing] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId))
      .limit(1);
    if (!existing ||
      existing.subjectType !== SALARY_EXCLUSION_SUBJECT_TYPE ||
      existing.actionKind !== SALARY_EXCLUSION_ACTION_KIND) {
      throw new ApiError(404, 'Không tìm thấy đề nghị loại trừ đã chọn');
    }
    if (input.expectedVersion != null && existing.version !== input.expectedVersion) {
      throw new ApiError(409, 'Đề nghị loại trừ đã được cập nhật. Vui lòng tải lại.');
    }
    if (existing.makerId === input.actorId) {
      throw new ApiError(409, 'Người đề nghị không được tự kiểm tra loại trừ kỳ lương của mình');
    }
    if (existing.status !== 'PENDING_CHECK') {
      throw new ApiError(409, `Đề nghị loại trừ đang ở trạng thái ${existing.status}, không thể kiểm tra tiếp`);
    }

    const [updated] = await tx.update(s.governanceActions)
      .set({
        status: 'PENDING_APPROVAL',
        checkerId: input.actorId,
        checkerRole: input.actorRole,
        checkedAt: new Date(),
        version: sql`${s.governanceActions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.governanceActions.id, existing.id),
        eq(s.governanceActions.status, 'PENDING_CHECK'),
        input.expectedVersion != null
          ? eq(s.governanceActions.version, input.expectedVersion)
          : undefined,
      ))
      .returning();
    if (!updated) {
      throw new ApiError(409, 'Đề nghị loại trừ đã được người khác xử lý. Vui lòng tải lại.');
    }

    const afterSnapshot = updated!.afterSnapshot as Record<string, unknown> | null;
    const parsed = parseExclusion(afterSnapshot);
    const [period, driverIdRaw] = (updated!.subjectKey ?? '').split(':');

    return {
      actionId: updated!.id,
      version: updated!.version,
      period,
      driverId: Number(driverIdRaw),
      status: 'PENDING_APPROVAL',
      handlingMode: parsed.handlingMode,
      targetPeriod: parsed.targetPeriod,
      reason: updated!.reason,
      note: parsed.note,
      makerId: updated!.makerId,
      checkerId: updated!.checkerId,
      approverId: updated!.approverId,
      followupStatus: null,
      followupCompletedAt: null,
    };
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

export async function approveSalaryPeriodExclusion(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  expectedVersion?: number | null;
  transaction?: Tx;
}): Promise<SalaryPeriodExclusionResult> {
  if (input.actorRole !== 'ADMIN' && input.actorRole !== 'MANAGER') {
    throw new ApiError(403, 'Bạn không có quyền phê duyệt loại trừ kỳ lương');
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }

  const execute = async (tx: Tx): Promise<SalaryPeriodExclusionResult> => {
    const [existing] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId))
      .limit(1);
    if (!existing ||
      existing.subjectType !== SALARY_EXCLUSION_SUBJECT_TYPE ||
      existing.actionKind !== SALARY_EXCLUSION_ACTION_KIND) {
      throw new ApiError(404, 'Không tìm thấy đề nghị loại trừ đã chọn');
    }
    if (input.expectedVersion != null && existing.version !== input.expectedVersion) {
      throw new ApiError(409, 'Đề nghị loại trừ đã được cập nhật. Vui lòng tải lại.');
    }
    if (existing.makerId === input.actorId || existing.checkerId === input.actorId) {
      throw new ApiError(409, 'Loại trừ kỳ lương phải được phê duyệt bởi người khác với người đề nghị và người kiểm tra');
    }
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new ApiError(409, `Đề nghị loại trừ đang ở trạng thái ${existing.status}, không thể phê duyệt tiếp`);
    }

    const [updated] = await tx.update(s.governanceActions)
      .set({
        status: 'APPROVED',
        approverId: input.actorId,
        approverRole: input.actorRole,
        approvedAt: new Date(),
        applicationResult: {
          followupStatus: 'PENDING',
          handlingMode: parseExclusion(existing.afterSnapshot as Record<string, unknown> | null).handlingMode,
          targetPeriod: parseExclusion(existing.afterSnapshot as Record<string, unknown> | null).targetPeriod,
        },
        version: sql`${s.governanceActions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.governanceActions.id, existing.id),
        eq(s.governanceActions.status, 'PENDING_APPROVAL'),
        input.expectedVersion != null
          ? eq(s.governanceActions.version, input.expectedVersion)
          : undefined,
      ))
      .returning();
    if (!updated) {
      throw new ApiError(409, 'Đề nghị loại trừ đã được người khác xử lý. Vui lòng tải lại.');
    }

    const afterSnapshot = updated!.afterSnapshot as Record<string, unknown> | null;
    const parsed = parseExclusion(afterSnapshot);
    const [period, driverIdRaw] = (updated!.subjectKey ?? '').split(':');

    return {
      actionId: updated!.id,
      version: updated!.version,
      period,
      driverId: Number(driverIdRaw),
      status: 'APPROVED',
      handlingMode: parsed.handlingMode,
      targetPeriod: parsed.targetPeriod,
      reason: updated!.reason,
      note: parsed.note,
      makerId: updated!.makerId,
      checkerId: updated!.checkerId,
      approverId: updated!.approverId,
      followupStatus: 'PENDING',
      followupCompletedAt: null,
    };
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}

/**
 * Complete the explicit follow-up created by an approved exclusion.
 *
 * Supplementary handling is complete only when that driver is READY in the
 * declared target period. Adjustment handling is complete only after an
 * approved salary adjustment exists for the same source period and driver.
 * This keeps an excluded driver visible as pending instead of silently
 * disappearing after the main period closes.
 */
export async function completeSalaryPeriodExclusionFollowup(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  transaction?: Tx;
}): Promise<SalaryPeriodExclusionResult> {
  if (input.actorRole !== 'ADMIN' && input.actorRole !== 'MANAGER') {
    throw new ApiError(403, 'Bạn không có quyền hoàn tất xử lý lương bổ sung');
  }

  const execute = async (tx: Tx): Promise<SalaryPeriodExclusionResult> => {
    const [existing] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId))
      .limit(1)
      .for('update');
    if (
      !existing
      || existing.subjectType !== SALARY_EXCLUSION_SUBJECT_TYPE
      || existing.actionKind !== SALARY_EXCLUSION_ACTION_KIND
    ) {
      throw new ApiError(404, 'Không tìm thấy đề nghị loại trừ đã chọn');
    }
    if (existing.status !== 'APPROVED') {
      throw new ApiError(409, 'Chỉ có thể hoàn tất xử lý cho loại trừ đã được phê duyệt');
    }

    const [sourcePeriod, driverIdRaw] = (existing.subjectKey ?? '').split(':');
    const driverId = Number(driverIdRaw);
    const parsed = parseExclusion(existing.afterSnapshot as Record<string, unknown> | null);
    const existingResult = existing.applicationResult as Record<string, unknown> | null;
    if (!sourcePeriod || !Number.isInteger(driverId) || driverId < 1) {
      throw new ApiError(409, 'Đề nghị loại trừ không có định danh kỳ và lái xe hợp lệ');
    }
    // First completion is authoritative. A replay returns the persisted result
    // without rewriting its actor or timestamp.
    if (existingResult?.followupStatus === 'COMPLETED') {
        return {
          actionId: existing.id,
          version: existing.version,
          period: sourcePeriod,
        driverId,
        status: 'APPROVED',
        handlingMode: parsed.handlingMode,
        targetPeriod: parsed.targetPeriod,
        reason: existing.reason,
        note: parsed.note,
        makerId: existing.makerId,
        checkerId: existing.checkerId,
        approverId: existing.approverId,
        followupStatus: 'COMPLETED',
        followupCompletedAt: typeof existingResult.followupCompletedAt === 'string'
          ? existingResult.followupCompletedAt
          : null,
      };
    }

    if (parsed.handlingMode === 'SUPPLEMENTARY_PERIOD') {
      if (!parsed.targetPeriod || parsed.targetPeriod === sourcePeriod) {
        throw new ApiError(409, 'Kỳ bổ sung phải là một kỳ khác kỳ lương gốc');
      }
      const targetReadiness = await buildSalaryPeriodReadinessSummary(tx, parsed.targetPeriod);
      const targetDriver = targetReadiness.drivers.find((driver) => driver.driverId === driverId);
      if (!targetDriver || targetDriver.status !== 'READY' || targetDriver.exclusion != null) {
        throw new ApiError(409, 'Lái xe chưa sẵn sàng trong kỳ lương bổ sung đã khai báo');
      }
    } else {
      const [adjustment] = await tx.select({ id: s.salaryPeriodAdjustments.id })
        .from(s.salaryPeriodAdjustments)
        .where(and(
          eq(s.salaryPeriodAdjustments.sourcePeriod, sourcePeriod),
          eq(s.salaryPeriodAdjustments.driverId, driverId),
        ))
        .limit(1);
      if (!adjustment) {
        throw new ApiError(409, 'Chưa có khoản điều chỉnh đã duyệt cho lái xe và kỳ lương gốc');
      }
    }

    const completedAt = new Date().toISOString();
    const [updated] = await tx.update(s.governanceActions)
      .set({
        applicationResult: {
          followupStatus: 'COMPLETED',
          followupCompletedAt: completedAt,
          followupCompletedBy: input.actorId,
          handlingMode: parsed.handlingMode,
          targetPeriod: parsed.targetPeriod,
        },
        version: sql`${s.governanceActions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.governanceActions.id, existing.id),
        eq(s.governanceActions.version, existing.version),
      ))
      .returning();
    if (!updated) {
      throw new ApiError(409, 'Xử lý bổ sung đã được cập nhật bởi người khác');
    }

    return {
      actionId: updated.id,
      version: updated.version,
      period: sourcePeriod,
      driverId,
      status: 'APPROVED',
      handlingMode: parsed.handlingMode,
      targetPeriod: parsed.targetPeriod,
      reason: updated.reason,
      note: parsed.note,
      makerId: updated.makerId,
      checkerId: updated.checkerId,
      approverId: updated.approverId,
      followupStatus: 'COMPLETED',
      followupCompletedAt: completedAt,
    };
  };
  if (input.transaction) {
    return execute(input.transaction);
  }
  return db.transaction(execute);
}
