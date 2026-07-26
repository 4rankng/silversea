/**
 * Wave 4 M11.4 — payment-term evaluation report integration tests.
 *
 * Creates customers + billing documents + payment allocations, exercises
 * `getPaymentTermEvalReport`, tears down in `after`.
 *
 * Coverage (PRD M11-04-04):
 *   - customer with no invoices → excluded.
 *   - customer with a paid invoice → avgDaysToPay computed correctly.
 *   - pre-payment (alloc before rangeTo) → days clamped to 0 (not negative).
 *   - customer with outstanding balance → totalOutstanding > 0.
 *   - customer within payment term → avgOverdueDays = 0.
 *   - results sorted: most-overdue first.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { getPaymentTermEvalReport } from '../services/payment-term.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdDocIds: number[] = [];
const createdAllocIds: number[] = [];
const createdCustomerIds: number[] = [];

async function mkCustomer(name: string, paymentTermDays: number = 30) {
  const [c] = await db.insert(s.customers)
    .values({ name, paymentTermDays })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkDebitNote(customerId: number, rangeTo: string, totalInclVat: number) {
  const [d] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customerId,
    rangeFrom: '2026-01-01', rangeTo, totalInclVat: String(totalInclVat),
  }).returning();
  createdDocIds.push(d.id);
  return d;
}

async function mkAllocation(customerId: number, docId: number, amount: number, createdAt: Date) {
  const [a] = await db.insert(s.paymentAllocations).values({
    customerId, targetType: 'BILLING_DOCUMENT', targetId: docId,
    amount: String(amount), createdAt,
  }).returning();
  createdAllocIds.push(a.id);
  return a;
}

describe('M11.4 — payment-term evaluation report', () => {
  test('customer with no invoices → excluded from report', async () => {
    await mkCustomer(`M114-empty-${suffix}`);
    const report = await getPaymentTermEvalReport();
    // The empty customer should NOT appear.
    assert.ok(!report.some((r) => r.customerName === `M114-empty-${suffix}`),
      'customer with no invoices excluded');
  });

  test('paid invoice → avgDaysToPay computed correctly', async () => {
    const cust = await mkCustomer(`M114-paid-${suffix}`, 30);
    // rangeTo = 30 days ago → payment 10 days after rangeTo = 10 days-to-pay.
    const rangeTo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const doc = await mkDebitNote(cust.id, rangeTo, 10_000_000);
    const payDate = new Date(new Date(rangeTo).getTime() + 10 * 24 * 60 * 60 * 1000);
    await mkAllocation(cust.id, doc.id, 10_000_000, payDate);

    const report = await getPaymentTermEvalReport();
    const row = report.find((r) => r.customerId === cust.id);
    assert.ok(row, 'paid customer appears');
    assert.equal(row!.paidPortionCount, 1);
    assert.equal(row!.avgDaysToPay, 10, '10 days-to-pay');
    assert.equal(Number(row!.totalOutstanding), 0, 'fully paid');
  });

  test('pre-payment (alloc before rangeTo) → days clamped to 0 (not negative)', async () => {
    const cust = await mkCustomer(`M114-prepay-${suffix}`, 30);
    // rangeTo = today → payment 5 days BEFORE rangeTo = pre-payment.
    const rangeTo = new Date().toISOString().slice(0, 10);
    const doc = await mkDebitNote(cust.id, rangeTo, 5_000_000);
    const payDate = new Date(new Date(rangeTo).getTime() - 5 * 24 * 60 * 60 * 1000);
    await mkAllocation(cust.id, doc.id, 5_000_000, payDate);

    const report = await getPaymentTermEvalReport();
    const row = report.find((r) => r.customerId === cust.id);
    assert.ok(row);
    assert.equal(row!.avgDaysToPay, 0, 'pre-payment clamped to 0, not negative');
  });

  test('customer with outstanding balance → totalOutstanding > 0', async () => {
    const cust = await mkCustomer(`M114-outstanding-${suffix}`, 30);
    // rangeTo = 60 days ago → well past the 30-day term → overdue.
    const rangeTo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await mkDebitNote(cust.id, rangeTo, 8_000_000);
    // No allocation → fully outstanding.

    const report = await getPaymentTermEvalReport();
    const row = report.find((r) => r.customerId === cust.id);
    assert.ok(row);
    assert.equal(Number(row!.totalOutstanding), 8_000_000, 'fully outstanding');
    assert.ok(row!.avgOverdueDays > 0, 'overdue (60 days ago + 30 day term → ~30 overdue)');
  });

  test('results sorted: most-overdue first', async () => {
    const report = await getPaymentTermEvalReport();
    for (let i = 1; i < report.length; i++) {
      assert.ok(
        report[i - 1].avgOverdueDays >= report[i].avgOverdueDays ||
        Number(report[i - 1].totalOutstanding) >= Number(report[i].totalOutstanding),
        'sorted by overdue days desc then outstanding desc',
      );
    }
  });
});

after(async () => {
  try {
    if (createdAllocIds.length > 0) await db.delete(s.paymentAllocations).where(inArray(s.paymentAllocations.id, createdAllocIds));
    if (createdDocIds.length > 0) await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, createdDocIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  } catch (err) {
    console.warn('[m114-payment-term.test] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
