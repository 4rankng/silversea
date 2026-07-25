/**
 * Wave 3 M5.4 — AR split report tests.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { getArSplitReport } from '../services/ar-split-report.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdLedgerIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers).values({ name: `M54 customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkLedger(customerId: number, txnType: string, debit: number) {
  const [e] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER' as const,
    entityId: customerId,
    txnType: txnType as never,
    txnId: 0,
    debit: String(debit),
    credit: '0',
    balance: String(debit),
  }).returning();
  createdLedgerIds.push(e.id);
  return e;
}

after(async () => {
  try {
    if (createdLedgerIds.length > 0) await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  } catch (err) { console.warn('[m54] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M5.4 — getArSplitReport', () => {
  test('empty customer → all zeros, invariant holds', async () => {
    const c = await mkCustomer();
    const report = await getArSplitReport(c.id);
    assert.equal(report.freight, 0);
    assert.equal(report.disbursement, 0);
    assert.equal(report.other, 0);
    assert.equal(report.totalAr, 0);
    assert.equal(report.invariantHolds, true);
  });

  test('freight only → freight = total, invariant holds', async () => {
    const c = await mkCustomer();
    await mkLedger(c.id, 'TRIP_REVENUE', 5_000_000);
    await mkLedger(c.id, 'FUEL_EXPENSE', 500_000);
    const report = await getArSplitReport(c.id);
    assert.equal(report.freight, 5_500_000);
    assert.equal(report.disbursement, 0);
    assert.equal(report.other, 0);
    assert.equal(report.totalAr, 5_500_000);
    assert.equal(report.invariantHolds, true);
  });

  test('mixed types → split correctly, invariant holds', async () => {
    const c = await mkCustomer();
    await mkLedger(c.id, 'TRIP_REVENUE', 3_000_000);      // freight
    await mkLedger(c.id, 'SERVICE_FEE', 800_000);          // disbursement
    await mkLedger(c.id, 'EXTERNAL_CARRIER_COST', 1_200_000); // disbursement
    await mkLedger(c.id, 'PENALTY', 200_000);              // other
    await mkLedger(c.id, 'MANAGEMENT_FEE', 100_000);       // other
    const report = await getArSplitReport(c.id);
    assert.equal(report.freight, 3_000_000);
    assert.equal(report.disbursement, 2_000_000);
    assert.equal(report.other, 300_000);
    assert.equal(report.totalAr, 5_300_000);
    assert.equal(report.invariantHolds, true);
  });

  test('FORWARDER_ADVANCE goes to disbursement', async () => {
    const c = await mkCustomer();
    await mkLedger(c.id, 'FORWARDER_ADVANCE', 400_000);
    const report = await getArSplitReport(c.id);
    assert.equal(report.disbursement, 400_000);
    assert.equal(report.freight, 0);
    assert.equal(report.other, 0);
  });

  test('invariant always holds (sum = total by construction)', async () => {
    const c = await mkCustomer();
    await mkLedger(c.id, 'TRIP_REVENUE', 1_000_000);
    await mkLedger(c.id, 'ADJUSTMENT', 50_000);
    const report = await getArSplitReport(c.id);
    assert.equal(report.invariantHolds, true);
    assert.equal(report.totalAr, report.freight + report.disbursement + report.other);
  });
});
