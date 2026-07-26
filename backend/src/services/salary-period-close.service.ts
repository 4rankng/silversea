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
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { TxnType, FINANCIAL_ROLES } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { resolveSalaryPeriodDateRange } from './salary-period.service';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CLOSE_ENTITY_TYPE = 'SALARY_PERIOD_CLOSE';
// entityId=0 is a sentinel for "company aggregate" — no real driver has
// id=0 (serial starts at 1). The summary entry is for audit/
// reconciliation, not for recomputing driver payable balances.
const COMPANY_DRIVER_ENTITY_ID = 0;

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
  const [row] = await tx.select({
    total: sql<string>`coalesce(sum(${s.ledger.credit}), 0)`,
  })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'DRIVER'),
      eq(s.ledger.txnType, TxnType.DRIVER_SALARY),
      sql`${s.ledger.entityId} <> ${COMPANY_DRIVER_ENTITY_ID}`,
      gte(sql`DATE(${s.ledger.timestamp})`, start),
      lte(sql`DATE(${s.ledger.timestamp})`, end),
    ));
  return Number(row?.total ?? 0);
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

  return db.transaction(async (tx) => {
    // Per-period advisory lock — concurrent closes serialize here.
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));

    // Idempotent: existing CLOSED row → return it unchanged.
    const [existing] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (existing && existing.status === 'CLOSED') {
      // Pull the summary amount from the original ledger entry.
      const summaryAmt = await readSummaryAmount(tx, existing.ledgerEntryId);
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
      };
    }

    // Resolve the date range for this period (override → default → calendar).
    const range = await resolveSalaryPeriodDateRange(month, year);
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
  // ADMIN/MANAGER only — stricter than close.
  if (input.actorRole !== 'ADMIN' && input.actorRole !== 'MANAGER') {
    throw new ApiError(403, 'Bạn không có quyền mở lại kỳ lương');
  }
  parsePeriod(input.period); // validate format

  return db.transaction(async (tx) => {
    await LedgerService.lockEntity(tx, CLOSE_ENTITY_TYPE, periodLockKey(input.period));

    const [existing] = await tx.select()
      .from(s.salaryPeriodCloses)
      .where(eq(s.salaryPeriodCloses.period, input.period))
      .limit(1);
    if (!existing) {
      throw new ApiError(404, `Kỳ lương ${input.period} chưa được chốt, không thể mở lại`);
    }
    if (existing.status === 'REOPENED') {
      const summaryAmt = await readSummaryAmount(tx, existing.ledgerEntryId);
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
