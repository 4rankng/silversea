import { and, eq, or, sql } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import * as s from '../db/schema';

export const tripExpenseServiceReceiptId = (expenseId: number) => `trip-expense-service:${expenseId}`;

/** Include prior corrections so another save posts only the remaining delta.
 * Legacy corrections lack a receipt key; their exact source-specific note
 * distinguishes them from unrelated trip adjustments with a coincident ID. */
export function tripExpenseServiceLedgerCondition(expenseId: number, customerId: number) {
  return and(
    eq(s.ledger.entityType, 'CUSTOMER'),
    eq(s.ledger.entityId, customerId),
    eq(s.ledger.txnId, expenseId),
    or(
      eq(s.ledger.receiptId, tripExpenseServiceReceiptId(expenseId)),
      eq(s.ledger.txnType, TxnType.SERVICE_FEE),
      and(eq(s.ledger.txnType, TxnType.ADJUSTMENT), sql`${s.ledger.note} LIKE 'Điều chỉnh phí chi hộ chuyến %'`),
    ),
  );
}
