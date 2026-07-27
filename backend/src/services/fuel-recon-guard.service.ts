/**
 * Wave 3 M6.1 slice 2 — fuel-recon approval guard + explanations CRUD.
 *
 * Guards expense approval: when an accountant approves a fuel-typed
 * trip_expense, the supplier's fuel-AP reconciliation for the expense's
 * invoice month must be either 'OK' (within threshold) OR have a recorded
 * explanation in `fuel_recon_explanations`. Otherwise the approval is
 * rejected with a 409 until the variance is explained.
 *
 * The recon logic itself lives in fuel-ap-recon.service (slice 1). This
 * service owns the explanation storage and the guard hook.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { getFuelApReconciliation } from './fuel-ap-recon.service';
import { assertFuelPeriodCanAbsorbLateApproval } from './period-lock.service';

/** True when an expense's expenseType indicates fuel (case-insensitive 'fuel'). */
export function isFuelExpenseType(expenseType: string): boolean {
  return expenseType.toLowerCase().includes('fuel');
}

/**
 * Compute the [first-of-month, last-of-month] date range (YYYY-MM-DD) for
 * the calendar month containing `dateStr`. Used as the recon period for a
 * single expense's invoiceDate.
 *
 * Returns null when dateStr is empty/invalid.
 */
export function monthRangeFromDate(dateStr: string | null): { from: string; to: string } | null {
  if (!dateStr) return null;
  // Accept either 'YYYY-MM-DD' or full ISO timestamps.
  const dayPart = dateStr.slice(0, 10);
  const match = dayPart.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  const from = `${match[1]}-${match[2]}-01`;
  // Last day of the month: next month day 0.
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth - 1, 0)).getUTCDate();
  const to = `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/**
 * Determine whether the supplier's recon for the given period has a
 * recorded explanation. Returns true when an explanation row exists.
 */
export async function hasFuelReconExplanation(
  supplierId: number,
  periodFrom: string,
  periodTo: string,
): Promise<boolean> {
  const [row] = await db.select({ id: s.fuelReconExplanations.id })
    .from(s.fuelReconExplanations)
    .where(and(
      eq(s.fuelReconExplanations.supplierId, supplierId),
      eq(s.fuelReconExplanations.periodFrom, periodFrom),
      eq(s.fuelReconExplanations.periodTo, periodTo),
    ))
    .limit(1);
  return !!row;
}

/**
 * Record (or update) an explanation for a supplier's recon period.
 * Idempotent on (supplierId, periodFrom, periodTo) via the unique index —
 * a second call upserts the text + resolved variance.
 */
export async function recordFuelReconExplanation(input: {
  supplierId: number;
  periodFrom: string;
  periodTo: string;
  explanationText: string;
  resolvedVariance: number;
  createdBy?: number | null;
  note?: string | null;
}) {
  if (!input.explanationText?.trim()) {
    throw new ApiError(400, 'Nội dung giải trình không được để trống');
  }
  // Find existing row first so we can update in place rather than relying
  // on a thrown unique constraint (which would surface as a 500 to the
  // caller). Single round-trip in the common (no-prior-row) case.
  const [existing] = await db.select({ id: s.fuelReconExplanations.id })
    .from(s.fuelReconExplanations)
    .where(and(
      eq(s.fuelReconExplanations.supplierId, input.supplierId),
      eq(s.fuelReconExplanations.periodFrom, input.periodFrom),
      eq(s.fuelReconExplanations.periodTo, input.periodTo),
    ))
    .limit(1);

  if (existing) {
    const [updated] = await db.update(s.fuelReconExplanations)
      .set({
        explanationText: input.explanationText,
        resolvedVariance: String(input.resolvedVariance),
        note: input.note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(s.fuelReconExplanations.id, existing.id))
      .returning();
    return updated;
  }

  const [row] = await db.insert(s.fuelReconExplanations).values({
    supplierId: input.supplierId,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    explanationText: input.explanationText,
    resolvedVariance: String(input.resolvedVariance),
    createdBy: input.createdBy ?? null,
    note: input.note ?? null,
  }).returning();
  return row;
}

/** List explanations, optionally filtered by supplier and/or period range. */
export async function listFuelReconExplanations(opts: {
  supplierId?: number;
  periodFrom?: string;
  periodTo?: string;
} = {}) {
  const conditions = [];
  if (opts.supplierId) conditions.push(eq(s.fuelReconExplanations.supplierId, opts.supplierId));
  if (opts.periodFrom) conditions.push(gte(s.fuelReconExplanations.periodFrom, opts.periodFrom));
  if (opts.periodTo) conditions.push(lte(s.fuelReconExplanations.periodTo, opts.periodTo));
  const query = db.select().from(s.fuelReconExplanations);
  const rows = conditions.length > 0
    ? await query.where(and(...conditions)).orderBy(asc(s.fuelReconExplanations.periodFrom))
    : await query.orderBy(asc(s.fuelReconExplanations.periodFrom));
  return rows;
}

/**
 * Approval guard. Call BEFORE transitioning a trip_expense to APPROVED.
 *
 * Behaviour:
 *   - non-fuel expenseType       → no-op
 *   - fuel expenseType AND status='OK' → no-op
 *   - fuel expenseType AND status='VARIANCE' AND explanation exists → no-op
 *   - fuel expenseType AND status='VARIANCE' AND NO explanation → throw 409
 *
 * `tx` is optional so the guard can run either inside the caller's
 * transaction or standalone (e.g. for a pre-flight check from a UI).
 */
export async function assertFuelReconClear(
  expenseId: number,
  tx?: Tx,
): Promise<void> {
  const q = tx ?? db;
  const [expense] = await q.select({
    id: s.tripExpenses.id,
    supplierId: s.tripExpenses.supplierId,
    expenseType: s.tripExpenses.expenseType,
    invoiceDate: s.tripExpenses.invoiceDate,
    createdAt: s.tripExpenses.createdAt,
  })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);

  if (!expense) return; // missing expense → let the transition's own 404 fire
  if (!expense.supplierId) return; // no supplier → recon doesn't apply
  if (!isFuelExpenseType(expense.expenseType)) return; // non-fuel → no guard

  // Period = calendar month of invoiceDate (fallback createdAt).
  const period = monthRangeFromDate(expense.invoiceDate ?? String(expense.createdAt));
  if (!period) return; // undetermined period → fail open (don't block)
  await assertFuelPeriodCanAbsorbLateApproval(q, period.from, new Date().toISOString().slice(0, 10));

  const report = await getFuelApReconciliation({
    from: period.from,
    to: period.to,
    supplierId: expense.supplierId,
  });
  const row = report.suppliers.find(r => r.supplierId === expense.supplierId);
  if (!row || row.status === 'OK') return;

  // VARIANCE — require an explanation.
  const explained = await hasFuelReconExplanation(expense.supplierId, period.from, period.to);
  if (explained) return;

  const varianceAbs = Math.abs(row.variance);
  const pct = row.variancePct !== null ? `${(row.variancePct * 100).toFixed(1)}%` : 'N/A';
  throw new ApiError(
    409,
    `Chênh lệch nhiên liệu ${varianceAbs.toLocaleString('vi-VN')} ₫ (${pct}) cho nhà cung cấp ` +
    `${row.supplierName} trong kỳ ${period.from} → ${period.to}. ` +
    `Cần ghi giải trình trước khi phê duyệt.`,
  );
}
