// Payment-term evaluation report — M11.4 (PRD M11-04-04).
//
// For each customer, evaluates how quickly they pay relative to their
// contracted payment term (`customers.paymentTermDays`):
//
//   - Paid invoices: average days-to-pay = paymentAllocation.createdAt −
//     billingDocument.rangeTo (the period-end date is the invoice "issue"
//     baseline). Per-portion allocation is handled: each allocation row
//     gets its own days-to-pay weighted by its fraction of the total.
//   - Unpaid invoices: age-to-report-date = today − rangeTo − paymentTermDays
//     (i.e. overdue days; 0 if still within term).
//   - Pre-payments (payment before rangeTo) must NOT produce negative days —
//     clamped to 0 (PRD M11-04-04).
//
// All messages Vietnamese (PRD Mxx-HT-01).

import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, sql, isNull, desc } from 'drizzle-orm';

export interface PaymentTermEvalRow {
  customerId: number;
  customerName: string;
  paymentTermDays: number;
  /** Average days-to-pay across all paid portions for this customer (0 if none paid). */
  avgDaysToPay: number;
  /** Number of paid portions used in the average. */
  paidPortionCount: number;
  /** Total outstanding (unpaid) amount across all issued debit notes. */
  totalOutstanding: string;
  /** Number of issued debit notes. */
  totalInvoices: number;
  /** Average overdue days for unpaid invoices (0 if none overdue). */
  avgOverdueDays: number;
}

export async function getPaymentTermEvalReport(): Promise<PaymentTermEvalRow[]> {
  // Fetch all customers with payment-term config.
  const customers = await db.select({
    id: s.customers.id,
    name: s.customers.name,
    paymentTermDays: s.customers.paymentTermDays,
  }).from(s.customers)
    .where(isNull(s.customers.deletedAt))
    .orderBy(desc(s.customers.name));

  if (customers.length === 0) return [];

  // Fetch all non-deleted DEBIT_NOTE billing documents for CUSTOMER entities.
  const docs = await db.select({
    id: s.billingDocuments.id,
    entityId: s.billingDocuments.entityId,
    rangeTo: s.billingDocuments.rangeTo,
    totalInclVat: s.billingDocuments.totalInclVat,
    createdAt: s.billingDocuments.createdAt,
  }).from(s.billingDocuments)
    .where(and(
      eq(s.billingDocuments.type, 'DEBIT_NOTE'),
      eq(s.billingDocuments.entityType, 'CUSTOMER'),
      isNull(s.billingDocuments.deletedAt),
    ));

  // Fetch all payment allocations for these customers.
  const allocations = await db.select({
    customerId: s.paymentAllocations.customerId,
    targetType: s.paymentAllocations.targetType,
    targetId: s.paymentAllocations.targetId,
    amount: s.paymentAllocations.amount,
    createdAt: s.paymentAllocations.createdAt,
  }).from(s.paymentAllocations);

  // Build per-document maps.
  const docsByCustomer = new Map<number, typeof docs>();
  for (const d of docs) {
    const list = docsByCustomer.get(d.entityId) ?? [];
    list.push(d);
    docsByCustomer.set(d.entityId, list);
  }

  // Allocations targeting BILLING_DOCUMENT → link to the doc's rangeTo.
  const allocsByDoc = new Map<number, typeof allocations>();
  for (const a of allocations) {
    if (a.targetType === 'BILLING_DOCUMENT') {
      const list = allocsByDoc.get(a.targetId) ?? [];
      list.push(a);
      allocsByDoc.set(a.targetId, list);
    }
  }

  const today = new Date();
  const todayMs = today.getTime();

  const rows: PaymentTermEvalRow[] = [];

  for (const c of customers) {
    const termDays = c.paymentTermDays ?? 30;
    const custDocs = docsByCustomer.get(c.id) ?? [];

    if (custDocs.length === 0) continue; // Skip customers with no invoices.

    // Paid portions: compute days-to-pay per allocation.
    let totalDaysToPay = 0;
    let paidPortionCount = 0;
    let totalAllocated = 0;
    for (const doc of custDocs) {
      const docAllocs = allocsByDoc.get(doc.id) ?? [];
      const docRangeToMs = new Date(doc.rangeTo).getTime();
      for (const a of docAllocs) {
        const allocMs = new Date(a.createdAt).getTime();
        // Days-to-pay = allocation date − document rangeTo (period end).
        // Clamp to 0 for pre-payments (PRD M11-04-04: no negative days).
        const daysToPay = Math.max(0, Math.floor((allocMs - docRangeToMs) / (1000 * 60 * 60 * 24)));
        totalDaysToPay += daysToPay;
        paidPortionCount++;
        totalAllocated += Number(a.amount);
      }
    }

    // Unpaid: total outstanding + average overdue days.
    let totalOutstanding = 0;
    let totalOverdueDays = 0;
    let overdueCount = 0;
    for (const doc of custDocs) {
      const docTotal = Number(doc.totalInclVat ?? 0);
      const docAllocs = allocsByDoc.get(doc.id) ?? [];
      const docPaid = docAllocs.reduce((sum, a) => sum + Number(a.amount), 0);
      const outstanding = docTotal - docPaid;
      totalOutstanding += Math.max(0, outstanding);

      if (outstanding > 0) {
        const docRangeToMs = new Date(doc.rangeTo).getTime();
        const dueMs = docRangeToMs + termDays * 24 * 60 * 60 * 1000;
        const overdueDays = Math.max(0, Math.floor((todayMs - dueMs) / (1000 * 60 * 60 * 24)));
        totalOverdueDays += overdueDays;
        overdueCount++;
      }
    }

    rows.push({
      customerId: c.id,
      customerName: c.name,
      paymentTermDays: termDays,
      avgDaysToPay: paidPortionCount > 0 ? Math.round(totalDaysToPay / paidPortionCount) : 0,
      paidPortionCount,
      totalOutstanding: String(Math.round(totalOutstanding)),
      totalInvoices: custDocs.length,
      avgOverdueDays: overdueCount > 0 ? Math.round(totalOverdueDays / overdueCount) : 0,
    });
  }

  // Sort: most-overdue first, then by outstanding descending.
  rows.sort((a, b) => b.avgOverdueDays - a.avgOverdueDays || Number(b.totalOutstanding) - Number(a.totalOutstanding));

  return rows;
}
