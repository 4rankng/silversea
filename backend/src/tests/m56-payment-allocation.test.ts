import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  listAllocationsForReceipt,
  recordPaymentReceipt,
  recordPaymentReceiptIdempotent,
} from '../services/payment-allocation.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdPaymentReceiptIds: number[] = [];
const receiptCounter = { n: 0 };

async function mkCustomer() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `M56 customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute() {
  const [route] = await db.insert(s.routes)
    .values({ name: `M56 route ${suffix}-${createdRouteIds.length}` })
    .returning();
  createdRouteIds.push(route.id);
  return route;
}

async function mkCargo() {
  const [cargo] = await db.insert(s.cargoTypes)
    .values({ name: `M56 cargo ${suffix}-${createdCargoTypeIds.length}` })
    .returning();
  createdCargoTypeIds.push(cargo.id);
  return cargo;
}

async function mkTrip(customerId: number, routeId: number, cargoTypeId: number, departureDate: string) {
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M56-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId,
    routeId,
    cargoTypeId,
    status: 'COMPLETED',
    departureDate,
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function mkRevenue(args: {
  customerId: number;
  tripId: number;
  amount: number;
  timestamp: string;
  originalDueDate: string;
  processingDueDate: string;
}) {
  const [entry] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER',
    entityId: args.customerId,
    txnType: 'TRIP_REVENUE',
    txnId: args.tripId,
    debit: String(args.amount),
    credit: '0',
    balance: String(args.amount),
    note: null,
    timestamp: new Date(args.timestamp),
    originalDueDate: args.originalDueDate,
    processingDueDate: args.processingDueDate,
  }).returning();
  createdLedgerIds.push(entry.id);
  return entry;
}

function nextReceipt() {
  receiptCounter.n += 1;
  return `M56-RCPT-${suffix}-${receiptCounter.n}`;
}

async function fetchReceipt(receiptId: string) {
  const [row] = await db.select().from(s.paymentReceipts)
    .where(eq(s.paymentReceipts.receiptId, receiptId))
    .limit(1);
  if (row && !createdPaymentReceiptIds.includes(row.id)) createdPaymentReceiptIds.push(row.id);
  return row ?? null;
}

async function fetchReceiptCount(receiptId: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.paymentReceipts)
    .where(eq(s.paymentReceipts.receiptId, receiptId));
  return Number(total ?? 0);
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

async function fetchUnappliedCredit(customerId: number, receiptId: string) {
  const [row] = await db.select({
    credit: sql<string>`coalesce(sum(${s.ledger.credit}), 0)`,
  }).from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
      eq(s.ledger.txnType, 'PAYMENT_RECEIVED'),
      eq(s.ledger.txnId, 0),
      eq(s.ledger.receiptId, receiptId),
    ));
  return Number(row?.credit ?? 0);
}

after(async () => {
  const receiptPattern = `M56-RCPT-${suffix}%`;
  const tripCodePattern = `M56-${suffix}%`;
  const namePattern = `M56 %${suffix}%`;
  try {
    if (createdPaymentReceiptIds.length > 0) {
      await db.delete(s.idempotencyKeys).where(and(
        eq(s.idempotencyKeys.entityType, 'payment_receipt'),
        inArray(s.idempotencyKeys.entityId, createdPaymentReceiptIds),
      ));
    }
    await db.delete(s.paymentAllocations).where(sql`${s.paymentAllocations.receiptId} LIKE ${receiptPattern}`);
    await db.delete(s.paymentReceipts).where(sql`${s.paymentReceipts.receiptId} LIKE ${receiptPattern}`);
    await db.delete(s.ledger).where(sql`${s.ledger.receiptId} LIKE ${receiptPattern}`);
    if (createdLedgerIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    }
    await db.delete(s.trips).where(sql`${s.trips.tripCode} LIKE ${tripCodePattern}`);
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
  } catch (err) {
    console.warn('[m56] cleanup:', (err as Error).message);
  }
  await client.end();
});

describe('M5.6 / Q03 payment receipts', () => {
  test('OLDEST_DUE allocates by processingDueDate, then issue timestamp, then trip id', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const tripA = await mkTrip(customer.id, route.id, cargo.id, '2026-07-10');
    const tripB = await mkTrip(customer.id, route.id, cargo.id, '2026-07-11');
    const tripC = await mkTrip(customer.id, route.id, cargo.id, '2026-07-12');

    await mkRevenue({
      customerId: customer.id,
      tripId: tripA.id,
      amount: 1_000_000,
      timestamp: '2026-07-02T09:00:00.000Z',
      originalDueDate: '2026-07-05',
      processingDueDate: '2026-07-05',
    });
    await mkRevenue({
      customerId: customer.id,
      tripId: tripB.id,
      amount: 1_000_000,
      timestamp: '2026-07-01T09:00:00.000Z',
      originalDueDate: '2026-07-05',
      processingDueDate: '2026-07-05',
    });
    await mkRevenue({
      customerId: customer.id,
      tripId: tripC.id,
      amount: 1_000_000,
      timestamp: '2026-07-03T09:00:00.000Z',
      originalDueDate: '2026-07-04',
      processingDueDate: '2026-07-04',
    });

    const receiptId = nextReceipt();
    const result = await recordPaymentReceipt({
      customerId: customer.id,
      receiptId,
      amount: 2_500_000,
    });

    assert.equal(result.created, true);
    assert.equal(result.allocationMethod, 'OLDEST_DUE');
    assert.deepEqual(
      result.allocations.map((allocation) => [allocation.tripId, allocation.amount]),
      [
        [tripC.id, 1_000_000],
        [tripB.id, 1_000_000],
        [tripA.id, 500_000],
      ],
    );
    assert.equal(result.allocatedTotal, 2_500_000);
    assert.equal(result.unappliedAmount, 0);
  });

  test('EXPLICIT honors the instructed trips exactly and persists unapplied credit', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip1 = await mkTrip(customer.id, route.id, cargo.id, '2026-07-20');
    const trip2 = await mkTrip(customer.id, route.id, cargo.id, '2026-07-21');

    await mkRevenue({
      customerId: customer.id,
      tripId: trip1.id,
      amount: 1_000_000,
      timestamp: '2026-07-20T08:00:00.000Z',
      originalDueDate: '2026-07-25',
      processingDueDate: '2026-07-25',
    });
    await mkRevenue({
      customerId: customer.id,
      tripId: trip2.id,
      amount: 1_500_000,
      timestamp: '2026-07-21T08:00:00.000Z',
      originalDueDate: '2026-07-26',
      processingDueDate: '2026-07-26',
    });

    const receiptId = nextReceipt();
    const result = await recordPaymentReceipt({
      customerId: customer.id,
      receiptId,
      amount: 3_000_000,
      payments: [{ tripId: trip2.id, amount: 500_000 }],
    });

    assert.equal(result.allocationMethod, 'EXPLICIT');
    assert.deepEqual(
      result.allocations.map((allocation) => [allocation.tripId, allocation.amount]),
      [[trip2.id, 500_000]],
    );
    assert.equal(result.allocatedTotal, 500_000);
    assert.equal(result.unappliedAmount, 2_500_000);
    assert.equal(await fetchPostedCredits(customer.id, trip2.id), 500_000);
    assert.equal(await fetchPostedCredits(customer.id, trip1.id), 0);
    assert.equal(await fetchUnappliedCredit(customer.id, receiptId), 2_500_000);
  });

  test('EXPLICIT rejects instructions that exceed the remaining outstanding amount', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip = await mkTrip(customer.id, route.id, cargo.id, '2026-07-22');

    await mkRevenue({
      customerId: customer.id,
      tripId: trip.id,
      amount: 1_000_000,
      timestamp: '2026-07-22T08:00:00.000Z',
      originalDueDate: '2026-07-27',
      processingDueDate: '2026-07-27',
    });

    const receiptId = nextReceipt();
    await assert.rejects(
      () => recordPaymentReceipt({
        customerId: customer.id,
        receiptId,
        payments: [{ tripId: trip.id, amount: 1_100_000 }],
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 422 && error.message.includes('vượt quá số dư'),
    );
    assert.equal(await fetchReceiptCount(receiptId), 0);
  });

  test('same receipt id + same canonical payload replays; changed payload conflicts', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip = await mkTrip(customer.id, route.id, cargo.id, '2026-07-23');

    await mkRevenue({
      customerId: customer.id,
      tripId: trip.id,
      amount: 2_000_000,
      timestamp: '2026-07-23T08:00:00.000Z',
      originalDueDate: '2026-07-28',
      processingDueDate: '2026-07-28',
    });

    const receiptId = nextReceipt();
    const first = await recordPaymentReceipt({
      customerId: customer.id,
      receiptId,
      amount: 2_000_000,
    });
    const replay = await recordPaymentReceipt({
      customerId: customer.id,
      receiptId,
      amount: 2_000_000,
    });

    assert.equal(first.id, replay.id);
    assert.equal(replay.created, false);
    assert.equal(await fetchReceiptCount(receiptId), 1);
    assert.equal(await fetchPostedCredits(customer.id, trip.id), 2_000_000);

    await assert.rejects(
      () => recordPaymentReceipt({
        customerId: customer.id,
        receiptId,
        amount: 1_000_000,
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 409 && error.message.includes('Mã biên lai đã tồn tại'),
    );
  });

  test('legacy ambiguous receipt id fails closed', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip = await mkTrip(customer.id, route.id, cargo.id, '2026-07-24');

    const receiptId = nextReceipt();
    const [legacyEntry] = await db.insert(s.ledger).values({
      entityType: 'CUSTOMER',
      entityId: customer.id,
      txnType: 'PAYMENT_RECEIVED',
      txnId: trip.id,
      receiptId,
      debit: '0',
      credit: '1000',
      balance: '0',
      note: 'legacy payment',
    }).returning();
    createdLedgerIds.push(legacyEntry.id);

    await assert.rejects(
      () => recordPaymentReceipt({
        customerId: customer.id,
        receiptId,
        amount: 1_000,
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 409 && error.message.includes('dữ liệu cũ'),
    );
  });

  test('request idempotency key replays same result and rejects a changed payload', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip = await mkTrip(customer.id, route.id, cargo.id, '2026-07-25');

    await mkRevenue({
      customerId: customer.id,
      tripId: trip.id,
      amount: 1_000_000,
      timestamp: '2026-07-25T08:00:00.000Z',
      originalDueDate: '2026-07-30',
      processingDueDate: '2026-07-30',
    });

    const receiptId = nextReceipt();
    const key = `m56-idempotency-${suffix}`;
    const first = await recordPaymentReceiptIdempotent({
      input: {
        customerId: customer.id,
        receiptId,
        amount: 1_000_000,
      },
      idempotencyKey: key,
    });
    const replay = await recordPaymentReceiptIdempotent({
      input: {
        customerId: customer.id,
        receiptId,
        amount: 1_000_000,
      },
      idempotencyKey: key,
    });

    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(first.result.id, replay.result.id);

    await assert.rejects(
      () => recordPaymentReceiptIdempotent({
        input: {
          customerId: customer.id,
          receiptId: nextReceipt(),
          amount: 900_000,
        },
        idempotencyKey: key,
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 409 && error.message.includes('Khóa giao dịch trùng'),
    );
  });

  test('listAllocationsForReceipt returns persisted rows in allocation order', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip1 = await mkTrip(customer.id, route.id, cargo.id, '2026-07-26');
    const trip2 = await mkTrip(customer.id, route.id, cargo.id, '2026-07-27');

    await mkRevenue({
      customerId: customer.id,
      tripId: trip1.id,
      amount: 1_000_000,
      timestamp: '2026-07-26T08:00:00.000Z',
      originalDueDate: '2026-07-31',
      processingDueDate: '2026-07-31',
    });
    await mkRevenue({
      customerId: customer.id,
      tripId: trip2.id,
      amount: 1_000_000,
      timestamp: '2026-07-27T08:00:00.000Z',
      originalDueDate: '2026-08-01',
      processingDueDate: '2026-08-01',
    });

    const receiptId = nextReceipt();
    await recordPaymentReceipt({
      customerId: customer.id,
      receiptId,
      payments: [
        { tripId: trip2.id, amount: 250_000 },
        { tripId: trip1.id, amount: 500_000 },
      ],
      amount: 750_000,
    });

    const rows = await listAllocationsForReceipt(receiptId);
    assert.deepEqual(
      rows.map((row) => [row.targetId, Number(row.amount), row.allocationOrder]),
      [
        [trip1.id, 500_000, 1],
        [trip2.id, 250_000, 2],
      ],
    );
    const receipt = await fetchReceipt(receiptId);
    assert.ok(receipt);
    assert.equal(Number(receipt!.allocatedTotal), 750_000);
  });
});
