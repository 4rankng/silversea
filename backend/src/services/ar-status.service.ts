// AR Status Service — Wave 3 M5.1.
//
// Surfaces the payment status of each customer AR document (trip revenue or
// billing document): paid amount, outstanding balance, overdue days, and
// payment history. Void entries leave an offsetting ledger line (M5.1 §1).
//
// This service reads from the existing `ledger` table — it does NOT modify
// any data. It computes the AR status from the raw ledger entries per
// document (trip or billing document) and returns a structured result.

import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { calendarDaysOverdue } from './business-calendar.service';

export interface ArDocumentStatus {
  documentType: 'TRIP' | 'BILLING_DOCUMENT';
  documentId: number;
  totalDebit: number;
  totalCredit: number;
  paid: number;
  outstanding: number;
  isFullyPaid: boolean;
  /** Days since the document's due date (if past). 0 = not overdue. */
  overdueDays: number;
  /** Contract date before weekend/holiday handling (Q19). */
  originalDueDate: string | null;
  /** Effective date used for overdue and reminder calculations (Q19). */
  processingDueDate: string | null;
  paymentHistory: Array<{
    ledgerId: number;
    txnType: string;
    amount: number;
    timestamp: string;
    note: string | null;
  }>;
}

/**
 * Get the AR status for a single trip document.
 *
 * AR debit = TRIP_REVENUE entries (what the customer owes).
 * AR credit = PAYMENT_RECEIVED entries (what they've paid).
 * Outstanding = debit - credit. Void trips leave an offsetting adjustment
 * (UNLOCK_REVERSAL) that reduces the debit — this is already in the ledger.
 */
export async function getTripArStatus(
  tripId: number,
  paymentTermDays: number = 30,
): Promise<ArDocumentStatus> {
  // Kept for API compatibility. The authoritative term is the immutable value
  // captured on the obligation, never a caller-supplied/current default.
  void paymentTermDays;
  const entries = await db.select()
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.txnId, tripId),
      sql`${s.ledger.txnType} IN ('TRIP_REVENUE', 'PAYMENT_RECEIVED', 'UNLOCK_REVERSAL')`,
    ))
    .orderBy(s.ledger.timestamp);

  let totalDebit = 0;
  let totalCredit = 0;
  const paymentHistory: ArDocumentStatus['paymentHistory'] = [];

  for (const e of entries) {
    const debit = Number(e.debit ?? 0);
    const credit = Number(e.credit ?? 0);
    totalDebit += debit;
    totalCredit += credit;
    if (credit > 0) {
      paymentHistory.push({
        ledgerId: e.id,
        txnType: e.txnType,
        amount: credit,
        timestamp: String(e.timestamp),
        note: e.note,
      });
    }
  }

  const outstanding = Math.max(0, totalDebit - totalCredit);
  const isFullyPaid = outstanding === 0;

  let overdueDays = 0;
  const obligation = [...entries].reverse().find((entry) =>
    entry.txnType === 'TRIP_REVENUE' && Number(entry.debit ?? 0) > 0
  );
  const originalDueDate = obligation?.originalDueDate ?? null;
  const processingDueDate = obligation?.processingDueDate ?? null;
  if (processingDueDate && !isFullyPaid) {
    overdueDays = calendarDaysOverdue(processingDueDate);
  }

  return {
    documentType: 'TRIP',
    documentId: tripId,
    totalDebit,
    totalCredit,
    paid: totalCredit,
    outstanding,
    isFullyPaid,
    overdueDays,
    originalDueDate,
    processingDueDate,
    paymentHistory,
  };
}

/**
 * Compute a summary of AR across all documents for a customer.
 * Returns total AR, total paid, total outstanding, and count of overdue docs.
 */
export async function getCustomerArSummary(
  customerId: number,
  paymentTermDays: number = 30,
) {
  const entries = await db.select()
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
    ));

  let totalDebit = 0;
  let totalCredit = 0;
  for (const e of entries) {
    totalDebit += Number(e.debit ?? 0);
    totalCredit += Number(e.credit ?? 0);
  }

  return {
    customerId,
    totalAr: totalDebit,
    totalPaid: totalCredit,
    outstanding: Math.max(0, totalDebit - totalCredit),
  };
}
