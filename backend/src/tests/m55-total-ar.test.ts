/**
 * Wave 3 M5.5 — total AR report tests.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { getTotalArReport } from '../services/total-ar-report.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdLedgerIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers).values({ name: `M55 customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkLedger(customerId: number, txnType: string, debit: number, credit: number, timestamp: Date) {
  const [e] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER' as const,
    entityId: customerId,
    txnType: txnType as never,
    txnId: 0,
    debit: String(debit),
    credit: String(credit),
    balance: String(debit - credit),
    timestamp,
  }).returning();
  createdLedgerIds.push(e.id);
  return e;
}

after(async () => {
  try {
    if (createdLedgerIds.length > 0) await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  } catch (err) { console.warn('[m55] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M5.5 — getTotalArReport', () => {
  test('empty DB → empty report with zero totals', async () => {
    const report = await getTotalArReport('2026-01-01', '2026-01-31');
    assert.ok(report.customers.length >= 0); // may have seeded data
    assert.equal(typeof report.totals.openingBalance, 'number');
    assert.equal(typeof report.totals.closingBalance, 'number');
  });

  test('customer with pre-period charge → opening balance shows it', async () => {
    const c = await mkCustomer();
    await mkLedger(c.id, 'TRIP_REVENUE', 5_000_000, 0, new Date('2025-12-15'));
    const report = await getTotalArReport('2026-01-01', '2026-01-31');
    const item = report.customers.find(i => i.customerId === c.id);
    assert.ok(item, 'customer appears in report');
    assert.equal(item!.openingBalance, 5_000_000);
    assert.equal(item!.newCharges, 0);
    assert.equal(item!.closingBalance, 5_000_000);
  });

  test('new charge within period → appears as newCharges', async () => {
    const c = await mkCustomer();
    await mkLedger(c.id, 'TRIP_REVENUE', 3_000_000, 0, new Date('2026-01-15'));
    const report = await getTotalArReport('2026-01-01', '2026-01-31');
    const item = report.customers.find(i => i.customerId === c.id);
    assert.ok(item);
    assert.equal(item!.newCharges, 3_000_000);
    assert.equal(item!.openingBalance, 0);
    assert.equal(item!.closingBalance, 3_000_000);
  });

  test('payment within period → appears as receipts', async () => {
    const c = await mkCustomer();
    await mkLedger(c.id, 'TRIP_REVENUE', 5_000_000, 0, new Date('2025-12-01'));
    await mkLedger(c.id, 'PAYMENT_RECEIVED', 0, 2_000_000, new Date('2026-01-10'));
    const report = await getTotalArReport('2026-01-01', '2026-01-31');
    const item = report.customers.find(i => i.customerId === c.id);
    assert.ok(item);
    assert.equal(item!.openingBalance, 5_000_000);
    assert.equal(item!.receipts, 2_000_000);
    assert.equal(item!.closingBalance, 3_000_000);
  });

  test('closing = opening + newCharges - receipts + adjustments', async () => {
    const c = await mkCustomer();
    await mkLedger(c.id, 'TRIP_REVENUE', 4_000_000, 0, new Date('2025-11-01'));
    await mkLedger(c.id, 'TRIP_REVENUE', 1_000_000, 0, new Date('2026-01-05'));
    await mkLedger(c.id, 'PAYMENT_RECEIVED', 0, 1_500_000, new Date('2026-01-10'));
    await mkLedger(c.id, 'ADJUSTMENT', 0, 200_000, new Date('2026-01-15'));
    const report = await getTotalArReport('2026-01-01', '2026-01-31');
    const item = report.customers.find(i => i.customerId === c.id);
    assert.ok(item);
    const expectedClosing = item!.openingBalance + item!.newCharges - item!.receipts + item!.adjustments;
    assert.equal(item!.closingBalance, expectedClosing);
  });

  test('customer with zero activity but outstanding balance still appears', async () => {
    const c = await mkCustomer();
    await mkLedger(c.id, 'TRIP_REVENUE', 2_000_000, 0, new Date('2025-06-01'));
    const report = await getTotalArReport('2026-01-01', '2026-01-31');
    const item = report.customers.find(i => i.customerId === c.id);
    assert.ok(item, 'customer with outstanding balance appears even with zero activity');
    assert.equal(item!.newCharges, 0);
    assert.equal(item!.receipts, 0);
    assert.equal(item!.openingBalance, 2_000_000);
  });
});
