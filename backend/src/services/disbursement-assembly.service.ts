// Disbursement Assembly Service — Wave 2 M3.5.
//
// Extends the billing document line assembly to:
//   1. Exclude unapproved disbursements (PENDING/REJECTED) from the official
//      debit note. Only APPROVED expenses appear in the document.
//   2. Return a "pending list" of unapproved expenses that are available for
//      the NEXT period's debit note — so the operator sees what's waiting.
//
// This service works alongside the existing billing-document.service.ts and
// the M4.5 disbursement-period guard (assertCanAllocateDisbursement). The
// assembly function queries a customer's approved + pending expenses within
// a date range and partitions them into two lists.

import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';

export interface DisbursementAssemblyResult {
  /** Expenses APPROVED and ready for inclusion in the debit note. */
  approved: Array<{
    id: number;
    tripId: number;
    tripCode: string | null;
    expenseType: string;
    buyAmount: string;
    sellAmount: string;
    description: string;
  }>;
  /** Expenses PENDING or REJECTED — NOT included in the official document.
   *  Shown to the operator as "available for next period." */
  pending: Array<{
    id: number;
    tripId: number;
    tripCode: string | null;
    expenseType: string;
    buyAmount: string;
    sellAmount: string;
    approvalStatus: string;
    description: string;
  }>;
}

/**
 * Assemble disbursements for a customer's debit note. Partitions the customer's
 * trip expenses within the date range into:
 *   - approved: APPROVED expenses ready for the debit note.
 *   - pending: PENDING/REJECTED expenses shown as "pending for next period."
 *
 * This does NOT create billing_document_lines — it returns the data so the
 * caller (billing-document.service.ts or the route handler) can decide what
 * to include.
 */
export async function assembleDisbursementsForPeriod(
  customerId: number,
  rangeFrom: string,
  rangeTo: string,
): Promise<DisbursementAssemblyResult> {
  // Query trip expenses for the customer's trips within the date range.
  const expenses = await db.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    tripCode: s.trips.tripCode,
    expenseType: s.tripExpenses.expenseType,
    buyAmount: s.tripExpenses.buyAmount,
    sellAmount: s.tripExpenses.sellAmount,
    approvalStatus: s.tripExpenses.approvalStatus,
  })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .where(and(
      eq(s.trips.customerId, customerId),
      sql`${s.trips.departureDate} >= ${rangeFrom}`,
      sql`${s.trips.departureDate} <= ${rangeTo}`,
      sql`${s.trips.status} <> 'CANCELED'`,
    ));

  const approved: DisbursementAssemblyResult['approved'] = [];
  const pending: DisbursementAssemblyResult['pending'] = [];

  for (const e of expenses) {
    const desc = `${e.expenseType} — chuyến ${e.tripCode ?? e.tripId}`;
    if (e.approvalStatus === 'APPROVED') {
      approved.push({
        id: e.id, tripId: e.tripId, tripCode: e.tripCode,
        expenseType: e.expenseType, buyAmount: e.buyAmount,
        sellAmount: e.sellAmount, description: desc,
      });
    } else {
      pending.push({
        id: e.id, tripId: e.tripId, tripCode: e.tripCode,
        expenseType: e.expenseType, buyAmount: e.buyAmount,
        sellAmount: e.sellAmount,
        approvalStatus: e.approvalStatus,
        description: desc,
      });
    }
  }

  return { approved, pending };
}
