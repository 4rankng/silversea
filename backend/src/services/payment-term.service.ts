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
import {
  calendarDaysOverdue,
} from './business-calendar.service';
import { getCustomerReceivableSnapshots } from './customer-receivable-authority.service';

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

  // Fetch all issued DEBIT_NOTE billing documents for CUSTOMER entities.
  const docs = await db.select({
    id: s.billingDocuments.id,
    entityId: s.billingDocuments.entityId,
    rangeTo: s.billingDocuments.rangeTo,
    createdAt: s.billingDocuments.createdAt,
    issuedAt: s.billingDocuments.issuedAt,
    processingDueDate: s.billingDocuments.processingDueDate,
    paymentTermDaysApplied: s.billingDocuments.paymentTermDaysApplied,
  }).from(s.billingDocuments)
    .where(and(
      eq(s.billingDocuments.type, 'DEBIT_NOTE'),
      eq(s.billingDocuments.entityType, 'CUSTOMER'),
      isNull(s.billingDocuments.deletedAt),
      sql`coalesce(${s.billingDocuments.debitNoteStatus}, 'DRAFT') not in ('DRAFT', 'CANCELED')`,
    ));

  const snapshotMap = await getCustomerReceivableSnapshots(customers.map((customer) => customer.id));

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
  const rows: PaymentTermEvalRow[] = [];

  for (const c of customers) {
    const custDocs = docsByCustomer.get(c.id) ?? [];

    if (custDocs.length === 0) continue; // Skip customers with no invoices.
    const latestDoc = [...custDocs].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    )[0];
    const termDays = latestDoc?.paymentTermDaysApplied ?? c.paymentTermDays ?? 30;

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
    const authoritativeDocs = (snapshotMap.get(c.id)?.obligations ?? [])
      .filter((obligation) => obligation.authorityType === 'BILLING_DOCUMENT');
    const outstandingByDocId = new Map(authoritativeDocs.map((obligation) => [obligation.authorityId, obligation.outstanding]));
    for (const doc of custDocs) {
      const outstanding = outstandingByDocId.get(doc.id) ?? 0;
      totalOutstanding += Math.max(0, outstanding);

      if (outstanding > 0 && doc.processingDueDate) {
        const overdueDays = calendarDaysOverdue(doc.processingDueDate, today);
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
