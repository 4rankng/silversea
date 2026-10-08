/**
 * Ops wallet "Lịch sử chi phí" status census (card 20261008_2): FULL-set
 * per-status counts for the status filter tabs over BOTH sources the list
 * merges — native `opsExpenseEntries` rows and the legacy trip-sourced rows
 * behind `expenseAccountingSources` — because the list is paginated/capped and
 * a page count sizes nothing.
 *
 * Every bucket equals exactly what clicking that status tab reveals as a full
 * set (`listOpsExpenses({ paidById, status })` minus its slice), so a numeral
 * can never disagree with the list behind it:
 *
 *   - native rows count through the SAME WHERE set the list applies
 *     (paidById / settlementId) with the status lens itself excluded, so all
 *     buckets come from one GROUP BY;
 *   - legacy rows count through the SAME `listLegacyOpsExpenseHistory` the
 *     list loads — one rule, two callers, deliberately no SQL mirror of its
 *     dedupe / void-suppression — INCLUDING its asymmetry: it only serves the
 *     unfiltered, RECORDED and APPROVED views (returns [] for DRAFT / VOIDED /
 *     PENDING / REJECTED) and every legacy row displays as RECORDED. So the
 *     legacy rows land in `all`, `RECORDED` and `APPROVED` — exactly the tabs
 *     that show them — and nowhere else.
 */
import { and, count, eq } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { listLegacyOpsExpenseHistory } from './ops-legacy-expense-history.service';

type OpsExpenseStatus = typeof s.opsExpenseEntries.$inferSelect['approvalStatus'];

/** `all` + one bucket per approval status. Every key is always present. */
export type OpsExpenseStatusCounts = { all: number } & Record<OpsExpenseStatus, number>;

/** The scope the wallet list reads under (the status lens is the caller's). */
export interface OpsExpenseHistoryScope {
  paidById?: number;
  settlementId?: number;
}

export async function loadOpsExpenseStatusCounts(scope: OpsExpenseHistoryScope): Promise<OpsExpenseStatusCounts> {
  const conditions = [];
  if (scope.paidById != null) conditions.push(eq(s.opsExpenseEntries.paidById, scope.paidById));
  if (scope.settlementId != null) conditions.push(eq(s.opsExpenseEntries.opsSettlementId, scope.settlementId));
  const statusRows = await db
    .select({ status: s.opsExpenseEntries.approvalStatus, rows: count() })
    .from(s.opsExpenseEntries)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(s.opsExpenseEntries.approvalStatus);

  // The list's own gate: legacy rows join only the payer-scoped, settlement-
  // free history. Counted through the same loader the rows come from.
  const legacyRows = scope.paidById != null && scope.settlementId == null
    ? await listLegacyOpsExpenseHistory(scope.paidById)
    : [];
  const legacy = legacyRows.length;

  const counts: OpsExpenseStatusCounts = {
    all: legacy,
    DRAFT: 0,
    RECORDED: legacy,
    VOIDED: 0,
    PENDING: 0,
    APPROVED: legacy,
    REJECTED: 0,
  };
  for (const row of statusRows) {
    counts[row.status] += Number(row.rows);
    counts.all += Number(row.rows);
  }
  return counts;
}
