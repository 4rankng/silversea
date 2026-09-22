import { and, eq, ne, notExists } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';

/** Legacy voids can leave a recorded billing projection behind. Read the
 * source status as well as the native status without rewriting history. */
export function liveDebitTripExpense() {
  return and(
    ne(s.tripExpenses.approvalStatus, 'VOIDED'),
    notExists(db.select({ id: s.expenseAccountingSources.id }).from(s.expenseAccountingSources)
      .where(and(eq(s.expenseAccountingSources.linkedTripExpenseId, s.tripExpenses.id),
        eq(s.expenseAccountingSources.status, 'VOIDED')))),
  );
}

export function liveDebitOpsExpense() {
  return and(
    ne(s.opsExpenseEntries.approvalStatus, 'VOIDED'),
    notExists(db.select({ id: s.expenseAccountingSources.id }).from(s.expenseAccountingSources)
      .where(and(eq(s.expenseAccountingSources.sourceKind, 'OPS'),
        eq(s.expenseAccountingSources.sourceId, s.opsExpenseEntries.id),
        eq(s.expenseAccountingSources.status, 'VOIDED')))),
  );
}

/** OPS customer charges already enter the lot summary from their native rows.
 * Billing projections keep document identity but are not a second receivable. */
export function standaloneDebitTripRevenue() {
  return notExists(db.select({ id: s.expenseAccountingSources.id }).from(s.expenseAccountingSources)
    .where(and(eq(s.expenseAccountingSources.linkedTripExpenseId, s.tripExpenses.id),
      eq(s.expenseAccountingSources.sourceKind, 'OPS'))));
}
