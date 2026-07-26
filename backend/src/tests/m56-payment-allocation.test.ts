/**
 * Wave 3 M5.6 — payment allocation service tests.
 *
 * Verifies: oldest-first default, manual allocation, no over-allocation,
 * idempotency on receiptId, leftover (unallocated) reporting, persistence
 * of payment_allocations rows, and ledger posting via recordPayment.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { allocatePayment, listAllocationsForReceipt } from '../services/payment-allocation.service';
import { getTripArStatus } from '../services/ar-status.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdPaymentAllocationIds: number[] = [];
const receiptCounter = { n: 0 };

async function mkCustomer() {
  const [c] = await db.insert(s.customers).values({ name: `M56 customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkRoute() {
  const [r] = await db.insert(s.routes).values({ name: `M56 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(r.id);
  return r;
}

async function mkCargo() {
  const [c] = await db.insert(s.cargoTypes).values({ name: `M56 cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(c.id);
  return c;
}

async function mkTrip(customerId: number, routeId: number, cargoTypeId: number, departureDate: string) {
  const [t] = await db.insert(s.trips).values({
    tripCode: `M56-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId, routeId, cargoTypeId,
    status: 'COMPLETED', departureDate, carrierType: 'OWN',
  }).returning();
  createdTripIds.push(t.id);
  return t;
}

async function mkRevenue(customerId: number, tripId: number, amount: number) {
  const [e] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER' as const,
    entityId: customerId,
    txnType: 'TRIP_REVENUE' as const,
    txnId: tripId,
    debit: String(amount),
    credit: '0',
    balance: String(amount),
    note: null,
  }).returning();
  createdLedgerIds.push(e.id);
  return e;
}

function nextReceipt() {
  receiptCounter.n += 1;
  return `M56-RCPT-${suffix}-${receiptCounter.n}`;
}

async function fetchAllocRows(receiptId: string) {
  const rows = await db.select().from(s.paymentAllocations).where(eq(s.paymentAllocations.receiptId, receiptId));
  for (const r of rows) if (!createdPaymentAllocationIds.includes(r.id)) createdPaymentAllocationIds.push(r.id);
  return rows;
}

async function fetchPostedCredits(customerId: number, tripId: number) {
  const [row] = await db.select({
    paid: sql<string>`coalesce(sum(case when ${s.ledger.txnType} = 'PAYMENT_RECEIVED' then ${s.ledger.credit} else 0 end), 0)`,
  }).from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
      eq(s.ledger.txnId, tripId),
    ));
  return Number(row?.paid ?? 0);
}

after(async () => {
  // Pattern-based sweep: any row created by this test file (or any prior
  // interrupted run of it) carries our `suffix` marker. Delete in FK-safe
  // order. We deliberately don't rely solely on the `createdXxxIds` arrays
  // because interrupted runs leak rows not tracked in those arrays.
  const rcptPattern = `M56-RCPT-${suffix}%`;
  const tripCodePattern = `M56-${suffix}%`;
  const namePattern = `M56 %${suffix}%`;
  try {
    // 1. payment_allocations for this run's receipts (also covers orphan rows
    //    from prior interrupted runs of this same test file).
    await db.delete(s.paymentAllocations).where(sql`${s.paymentAllocations.receiptId} LIKE ${rcptPattern}`);
    // 2. PAYMENT_RECEIVED ledger rows posted by allocatePayment.
    await db.delete(s.ledger).where(sql`${s.ledger.receiptId} LIKE ${rcptPattern}`);
    // 3. TRIP_REVENUE ledger rows we inserted directly.
    if (createdLedgerIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    }
    // 4. Trips created by this test file (matched by trip_code prefix).
    await db.delete(s.trips).where(sql`${s.trips.tripCode} LIKE ${tripCodePattern}`);
    // 5. Customers/routes/cargo types — these don't have a clean pattern
    //    sentinel beyond the name, so use the per-run tracked IDs but as a
    //    fallback also sweep by name pattern.
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    }
    await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${namePattern}`);
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${namePattern}`);
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${namePattern}`);
  } catch (err) { console.warn('[m56] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M5.6 — allocatePayment', () => {
  test('rejects non-positive amount', async () => {
    const c = await mkCustomer();
    await assert.rejects(
      () => allocatePayment({ customerId: c.id, receiptId: nextReceipt(), amount: 0 }),
      (e: Error & { statusCode?: number }) => e.statusCode === 400,
    );
    await assert.rejects(
      () => allocatePayment({ customerId: c.id, receiptId: nextReceipt(), amount: -100 }),
      (e: Error & { statusCode?: number }) => e.statusCode === 400,
    );
  });

  test('rejects missing receiptId', async () => {
    const c = await mkCustomer();
    await assert.rejects(
      () => allocatePayment({ customerId: c.id, receiptId: '  ', amount: 1000 }),
      (e: Error & { statusCode?: number }) => e.statusCode === 400,
    );
  });

  test('MANUAL requires manual list', async () => {
    const c = await mkCustomer();
    await assert.rejects(
      () => allocatePayment({ customerId: c.id, receiptId: nextReceipt(), amount: 1000, method: 'MANUAL' }),
      (e: Error & { statusCode?: number }) => e.statusCode === 400,
    );
  });

  test('OLDEST_FIRST: pays oldest trip first, then next', async () => {
    const c = await mkCustomer(); const r = await mkRoute(); const cg = await mkCargo();
    const t1 = await mkTrip(c.id, r.id, cg.id, '2026-06-01');
    const t2 = await mkTrip(c.id, r.id, cg.id, '2026-06-10');
    await mkRevenue(c.id, t1.id, 3_000_000);
    await mkRevenue(c.id, t2.id, 2_000_000);

    const receipt = nextReceipt();
    const result = await allocatePayment({ customerId: c.id, receiptId: receipt, amount: 4_000_000 });

    assert.equal(result.method, 'OLDEST_FIRST');
    assert.equal(result.allocations.length, 2);
    assert.equal(result.allocations[0].tripId, t1.id);
    assert.equal(result.allocations[0].amount, 3_000_000);
    assert.equal(result.allocations[1].tripId, t2.id);
    assert.equal(result.allocations[1].amount, 1_000_000);
    assert.equal(result.allocatedTotal, 4_000_000);
    assert.equal(result.unallocated, 0);

    // Rows persisted.
    const rows = await fetchAllocRows(receipt);
    assert.equal(rows.length, 2);

    // Ledger credits posted via recordPayment.
    assert.equal(await fetchPostedCredits(c.id, t1.id), 3_000_000);
    assert.equal(await fetchPostedCredits(c.id, t2.id), 1_000_000);
  });

  test('OLDEST_FIRST: leftover returned when receipt exceeds total outstanding', async () => {
    const c = await mkCustomer(); const r = await mkRoute(); const cg = await mkCargo();
    const t1 = await mkTrip(c.id, r.id, cg.id, '2026-07-01');
    await mkRevenue(c.id, t1.id, 1_000_000);

    const result = await allocatePayment({ customerId: c.id, receiptId: nextReceipt(), amount: 5_000_000 });
    assert.equal(result.allocations.length, 1);
    assert.equal(result.allocatedTotal, 1_000_000);
    assert.equal(result.unallocated, 4_000_000);
  });

  test('OLDEST_FIRST: no outstanding trips → empty allocations, full leftover, no rows', async () => {
    const c = await mkCustomer(); const r = await mkRoute(); const cg = await mkCargo();
    await mkTrip(c.id, r.id, cg.id, '2026-07-01'); // no revenue → no outstanding

    const receipt = nextReceipt();
    const result = await allocatePayment({ customerId: c.id, receiptId: receipt, amount: 1_000_000 });
    assert.equal(result.allocations.length, 0);
    assert.equal(result.allocatedTotal, 0);
    assert.equal(result.unallocated, 1_000_000);
    const rows = await fetchAllocRows(receipt);
    assert.equal(rows.length, 0);
  });

  test('cannot over-allocate per trip: amount clamped to outstanding', async () => {
    const c = await mkCustomer(); const r = await mkRoute(); const cg = await mkCargo();
    const t1 = await mkTrip(c.id, r.id, cg.id, '2026-07-01');
    await mkRevenue(c.id, t1.id, 2_000_000);

    const result = await allocatePayment({ customerId: c.id, receiptId: nextReceipt(), amount: 10_000_000 });
    assert.equal(result.allocations.length, 1);
    assert.equal(result.allocations[0].amount, 2_000_000);
    assert.equal(result.allocatedTotal, 2_000_000);
    assert.equal(result.unallocated, 8_000_000);
    // Trip is now fully paid.
    const status = await getTripArStatus(t1.id);
    assert.equal(status.outstanding, 0);
    assert.equal(status.isFullyPaid, true);
  });

  test('MANUAL: applies explicit per-trip amounts, clamps over-outstanding intent', async () => {
    const c = await mkCustomer(); const r = await mkRoute(); const cg = await mkCargo();
    const t1 = await mkTrip(c.id, r.id, cg.id, '2026-07-01');
    const t2 = await mkTrip(c.id, r.id, cg.id, '2026-07-02');
    await mkRevenue(c.id, t1.id, 1_000_000);
    await mkRevenue(c.id, t2.id, 1_000_000);

    // Caller asks for 1.5M on t1 (only 1M outstanding) + 0.5M on t2 → 1.5M total
    const result = await allocatePayment({
      customerId: c.id, receiptId: nextReceipt(), amount: 2_000_000, method: 'MANUAL',
      manual: [{ tripId: t1.id, amount: 1_500_000 }, { tripId: t2.id, amount: 500_000 }],
    });
    assert.equal(result.method, 'MANUAL');
    assert.equal(result.allocations.length, 2);
    assert.equal(result.allocations[0].amount, 1_000_000); // clamped
    assert.equal(result.allocations[1].amount, 500_000);
    assert.equal(result.allocatedTotal, 1_500_000);
    assert.equal(result.unallocated, 500_000);
  });

  test('idempotent on receiptId: second call does not double-allocate', async () => {
    const c = await mkCustomer(); const r = await mkRoute(); const cg = await mkCargo();
    const t1 = await mkTrip(c.id, r.id, cg.id, '2026-07-01');
    await mkRevenue(c.id, t1.id, 5_000_000);

    const receipt = nextReceipt();
    const r1 = await allocatePayment({ customerId: c.id, receiptId: receipt, amount: 3_000_000 });
    assert.equal(r1.allocatedTotal, 3_000_000);

    // Second call with same receipt: t1's effective outstanding is now
    // 5_000_000 - 3_000_000 (prior) = 2_000_000; receipt amount 3_000_000.
    // Should allocate only the remaining 2_000_000, not 5_000_000 again.
    const r2 = await allocatePayment({ customerId: c.id, receiptId: receipt, amount: 3_000_000 });
    assert.equal(r2.allocatedTotal, 2_000_000);
    assert.equal(r2.unallocated, 1_000_000);

    // Total posted = 3M + 2M = 5M; trip fully paid, never negative.
    const paid = await fetchPostedCredits(c.id, t1.id);
    assert.equal(paid, 5_000_000);
    const status = await getTripArStatus(t1.id);
    assert.equal(status.outstanding, 0);
  });

  test('listAllocationsForReceipt returns persisted rows', async () => {
    const c = await mkCustomer(); const r = await mkRoute(); const cg = await mkCargo();
    const t1 = await mkTrip(c.id, r.id, cg.id, '2026-07-01');
    await mkRevenue(c.id, t1.id, 1_000_000);
    const receipt = nextReceipt();
    await allocatePayment({ customerId: c.id, receiptId: receipt, amount: 1_000_000 });
    const rows = await listAllocationsForReceipt(receipt);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].targetType, 'TRIP');
    assert.equal(rows[0].targetId, t1.id);
    assert.equal(Number(rows[0].amount), 1_000_000);
    assert.equal(rows[0].allocationMethod, 'OLDEST_FIRST');
  });
});
