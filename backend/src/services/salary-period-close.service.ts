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
import { TxnType, FINANCIAL_ROLES } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { resolveSalaryPeriodDateRange } from './salary-period.service';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  closePeriodLock,
  reopenPeriodLock,
  resolveSalaryPeriodAuthority,
} from './period-lock.service';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CLOSE_ENTITY_TYPE = 'SALARY_PERIOD_CLOSE';
const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const SALARY_EXCLUSION_SUBJECT_TYPE = 'SALARY_PERIOD';
const SALARY_EXCLUSION_ACTION_KIND = 'FINANCIAL_EXCEPTION';
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
  scope: 'COMPANY';
  canClose: boolean;
  blockingDriverIds: number[];
  drivers: SalaryPeriodDriverReadiness[];
}

export interface SalaryPeriodCloseResult {
  closeId: number;
  period: string;
  status: string;
  periodTotalSalary: number;
  ledgerEntryId: number | null;
  closedBy: number | null;
  closedAt: string;
  note: string | null;
  /** True when this call found an existing close and did no new work. */
  idempotentNoop: boolean;
  scope: 'COMPANY';
  excludedDriverIds: number[];
}

export interface SalaryPeriodExclusionResult {
  actionId: number;
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
    map.set(driverId, {
      actionId: row.id,
      driverId,
      handlingMode: parsed.handlingMode,
      targetPeriod: parsed.targetPeriod,
      reason: row.reason,
      note: parsed.note,
      approvedBy: row.approverId,
      approvedAt: row.approvedAt?.toISOString() ?? null,
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

  const drivers = await tx.select({
    driverId: s.drivers.id,
    driverName: s.drivers.name,
  }).from(s.drivers)
    .leftJoin(s.users, eq(s.users.id, s.drivers.userId))
    .where(and(
      isNull(s.drivers.deletedAt),
      eq(s.drivers.status, 'ACTIVE'),
      or(isNull(s.users.id), eq(s.users.status, 'ACTIVE')),
    ))
    .orderBy(s.drivers.name);

  const driverIds = drivers.map((driver) => driver.driverId);
  if (driverIds.length === 0) {
    return {
      period,
      scope: 'COMPANY',
      canClose: true,
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
        ne(s.trips.status, 'CANCELED'),
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
    const completedDate = toBusinessDateString(trip.completedAt) ?? trip.departureDate;
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
          message: `Chuyến #${trip.tripId} hoàn thành trong kỳ nhưng thiếu ngày công thực tế ${date}.`,
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
    scope: 'COMPANY',
    canClose: blockingDriverIds.length === 0,
    blockingDriverIds,
    drivers: readinessDrivers,
  };
}

async function assertSalaryPeriodCanReopen(tx: Tx, period: string): Promise<void> {
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

  if (payout) {
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
async function sumDriverSalaryInPeriod(tx: Tx, start: string, end: string): Promise<number> {
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
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ));

  return rows.reduce((sum, row) => {
    const basisDate = toBusinessDateString(row.completedAt) ?? row.departureDate;
    if (!basisDate || basisDate < start || basisDate > end) return sum;
    return sum + Number(row.credit);
  }, 0);
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
}): Promise<SalaryPeriodCloseResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền chốt kỳ lương');
  }
  const { year, month } = parsePeriod(input.period);
  const authority = await resolveSalaryPeriodAuthority(input.period);

  return db.transaction(async (tx) => {
    // Per-period advisory lock — concurrent closes serialize here.
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));

    // Idempotent: existing CLOSED row → return it unchanged.
    const [existing] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (existing && existing.status === 'CLOSED') {
      await closePeriodLock(tx, authority, input.actorId, existing.note);
      // Pull the summary amount from the original ledger entry.
      const summaryAmt = await readSummaryAmount(tx, existing.ledgerEntryId);
      const readiness = await buildSalaryPeriodReadinessSummary(tx, input.period);
      return {
        closeId: existing.id,
        period: existing.period,
        status: existing.status,
        periodTotalSalary: summaryAmt,
        ledgerEntryId: existing.ledgerEntryId,
        closedBy: existing.closedBy,
        closedAt: existing.closedAt.toISOString(),
        note: existing.note,
        idempotentNoop: true,
        scope: readiness.scope,
        excludedDriverIds: readiness.drivers
          .filter((driver) => driver.exclusion != null)
          .map((driver) => driver.driverId),
      };
    }

    // Resolve the date range for this period (override → default → calendar).
    const range = await resolveSalaryPeriodDateRange(month, year);
    const readiness = await buildSalaryPeriodReadinessSummary(tx, input.period);
    if (!readiness.canClose) {
      const blockingNames = readiness.drivers
        .filter((driver) => readiness.blockingDriverIds.includes(driver.driverId))
        .map((driver) => driver.driverName);
      throw new ApiError(
        409,
        `Kỳ lương ${input.period} còn lái xe chờ xử lý: ${blockingNames.join(', ')}. Muốn chốt phần còn lại phải có loại trừ đã duyệt sang kỳ bổ sung hoặc điều chỉnh.`,
      );
    }
    const periodTotalSalary = await sumDriverSalaryInPeriod(tx, range.start, range.end);

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
      }).returning();
      closeRow = inserted!;
    }
    await closePeriodLock(tx, authority, input.actorId, note);

    return {
      closeId: closeRow.id,
      period: closeRow.period,
      status: closeRow.status,
      periodTotalSalary,
      ledgerEntryId: closeRow.ledgerEntryId,
      closedBy: closeRow.closedBy,
      closedAt: closeRow.closedAt.toISOString(),
      note: closeRow.note,
      idempotentNoop: false,
      scope: readiness.scope,
      excludedDriverIds: readiness.drivers
        .filter((driver) => driver.exclusion != null)
        .map((driver) => driver.driverId),
    };
  });
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
}): Promise<SalaryPeriodCloseResult> {
  // Q11: only director/delegate proxy (ADMIN) may reopen.
  if (input.actorRole !== 'ADMIN') {
    throw new ApiError(403, 'Bạn không có quyền mở lại kỳ lương');
  }
  parsePeriod(input.period); // validate format
  const authority = await resolveSalaryPeriodAuthority(input.period);

  return db.transaction(async (tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));
    await assertSalaryPeriodCanReopen(tx, input.period);

    const [existing] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (!existing) {
      throw new ApiError(404, `Kỳ lương ${input.period} chưa được chốt, không thể mở lại`);
    }
    if (existing.status === 'REOPENED') {
      const summaryAmt = await readSummaryAmount(tx, existing.ledgerEntryId);
      const readiness = await buildSalaryPeriodReadinessSummary(tx, input.period);
      return {
        closeId: existing.id,
        period: existing.period,
        status: existing.status,
        periodTotalSalary: summaryAmt,
        ledgerEntryId: existing.ledgerEntryId,
        closedBy: existing.closedBy,
        closedAt: existing.closedAt.toISOString(),
        note: existing.note,
        idempotentNoop: true,
        scope: readiness.scope,
        excludedDriverIds: readiness.drivers
          .filter((driver) => driver.exclusion != null)
          .map((driver) => driver.driverId),
      };
    }

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
        updatedAt: new Date(),
      })
      .where(eq(s.salaryPeriodCloses.id, existing.id))
      .returning();
    await reopenPeriodLock(tx, authority, input.actorId, reopenNote);
    const readiness = await buildSalaryPeriodReadinessSummary(tx, input.period);

    return {
      closeId: updated!.id,
      period: updated!.period,
      status: updated!.status,
      periodTotalSalary: originalAmount,
      ledgerEntryId: updated!.ledgerEntryId,
      closedBy: updated!.closedBy,
      closedAt: updated!.closedAt.toISOString(),
      note: updated!.note,
      idempotentNoop: false,
      scope: readiness.scope,
      excludedDriverIds: readiness.drivers
        .filter((driver) => driver.exclusion != null)
        .map((driver) => driver.driverId),
    };
  });
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

/** List all close rows, newest first. */
export async function listSalaryPeriodCloses() {
  return db.select()
    .from(s.salaryPeriodCloses)
    .orderBy(desc(s.salaryPeriodCloses.period));
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
}): Promise<SalaryPeriodExclusionResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền đề nghị loại trừ kỳ lương');
  }
  parsePeriod(input.period);
  if (input.handlingMode === 'SUPPLEMENTARY_PERIOD' && input.targetPeriod) {
    parsePeriod(input.targetPeriod);
  }

  return db.transaction(async (tx) => {
    const readiness = await buildSalaryPeriodReadinessSummary(tx, input.period);
    const driver = readiness.drivers.find((item) => item.driverId === input.driverId);
    if (!driver) {
      throw new ApiError(404, `Không tìm thấy lái xe #${input.driverId} trong phạm vi kỳ lương ${input.period}`);
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
        handlingMode: input.handlingMode,
        targetPeriod: input.targetPeriod ?? null,
        note: input.note?.trim() || null,
      },
      makerId: input.actorId,
      makerRole: input.actorRole,
    }).returning();

    return {
      actionId: created.id,
      period: input.period,
      driverId: input.driverId,
      status: 'PENDING_CHECK',
      handlingMode: input.handlingMode,
      targetPeriod: input.targetPeriod ?? null,
      reason: created.reason,
      note: input.note?.trim() || null,
      makerId: created.makerId,
      checkerId: null,
      approverId: null,
    };
  });
}

export async function checkSalaryPeriodExclusion(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
  note?: string | null;
}): Promise<SalaryPeriodExclusionResult> {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền kiểm tra loại trừ kỳ lương');
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId))
      .limit(1);
    if (!existing ||
      existing.subjectType !== SALARY_EXCLUSION_SUBJECT_TYPE ||
      existing.actionKind !== SALARY_EXCLUSION_ACTION_KIND) {
      throw new ApiError(404, `Không tìm thấy đề nghị loại trừ #${input.actionId}`);
    }
    if (existing.makerId === input.actorId) {
      throw new ApiError(409, 'Người đề nghị không được tự kiểm tra loại trừ kỳ lương của mình');
    }
    if (existing.status !== 'PENDING_CHECK') {
      throw new ApiError(409, `Đề nghị loại trừ #${input.actionId} đang ở trạng thái ${existing.status}, không thể kiểm tra tiếp`);
    }

    const [updated] = await tx.update(s.governanceActions)
      .set({
        status: 'PENDING_APPROVAL',
        checkerId: input.actorId,
        checkerRole: input.actorRole,
        checkedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(s.governanceActions.id, existing.id))
      .returning();

    const afterSnapshot = updated!.afterSnapshot as Record<string, unknown> | null;
    const parsed = parseExclusion(afterSnapshot);
    const [period, driverIdRaw] = (updated!.subjectKey ?? '').split(':');

    return {
      actionId: updated!.id,
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
    };
  });
}

export async function approveSalaryPeriodExclusion(input: {
  actionId: number;
  actorId: number;
  actorRole: string;
}): Promise<SalaryPeriodExclusionResult> {
  if (input.actorRole !== 'ADMIN' && input.actorRole !== 'MANAGER') {
    throw new ApiError(403, 'Bạn không có quyền phê duyệt loại trừ kỳ lương');
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, input.actionId))
      .limit(1);
    if (!existing ||
      existing.subjectType !== SALARY_EXCLUSION_SUBJECT_TYPE ||
      existing.actionKind !== SALARY_EXCLUSION_ACTION_KIND) {
      throw new ApiError(404, `Không tìm thấy đề nghị loại trừ #${input.actionId}`);
    }
    if (existing.makerId === input.actorId || existing.checkerId === input.actorId) {
      throw new ApiError(409, 'Loại trừ kỳ lương phải được phê duyệt bởi người khác với người đề nghị và người kiểm tra');
    }
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new ApiError(409, `Đề nghị loại trừ #${input.actionId} đang ở trạng thái ${existing.status}, không thể phê duyệt tiếp`);
    }

    const [updated] = await tx.update(s.governanceActions)
      .set({
        status: 'APPROVED',
        approverId: input.actorId,
        approverRole: input.actorRole,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(s.governanceActions.id, existing.id))
      .returning();

    const afterSnapshot = updated!.afterSnapshot as Record<string, unknown> | null;
    const parsed = parseExclusion(afterSnapshot);
    const [period, driverIdRaw] = (updated!.subjectKey ?? '').split(':');

    return {
      actionId: updated!.id,
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
    };
  });
}
