import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../services/idempotency.service';
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
const createdStandaloneIdempotencyKeys: string[] = [];
const receiptCounter = { n: 0 };
let customerCounter = 0;
let routeCounter = 0;
let cargoCounter = 0;
let tripCounter = 0;

async function mkCustomer() {
  customerCounter += 1;
  const [customer] = await db.insert(s.customers)
    .values({ name: `M56 customer ${suffix}-${customerCounter}` })
    .returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute() {
  routeCounter += 1;
  const [route] = await db.insert(s.routes)
    .values({ name: `M56 route ${suffix}-${routeCounter}` })
    .returning();
  createdRouteIds.push(route.id);
  return route;
}

async function mkCargo() {
  cargoCounter += 1;
  const [cargo] = await db.insert(s.cargoTypes)
    .values({ name: `M56 cargo ${suffix}-${cargoCounter}` })
    .returning();
  createdCargoTypeIds.push(cargo.id);
  return cargo;
}

async function mkTrip(customerId: number, routeId: number, cargoTypeId: number, departureDate: string) {
  tripCounter += 1;
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M56-${suffix}-${tripCounter}`.slice(0, 50),
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
  originalDueDate: string | null;
  processingDueDate: string | null;
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

async function mkAdjustment(args: {
  customerId: number;
  tripId: number;
  amount: number;
  timestamp: string;
  originalDueDate?: string | null;
  processingDueDate?: string | null;
}) {
  const debit = args.amount > 0 ? args.amount : 0;
  const credit = args.amount < 0 ? Math.abs(args.amount) : 0;
  const [entry] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER',
    entityId: args.customerId,
    txnType: 'ADJUSTMENT',
    txnId: args.tripId,
    debit: String(debit),
    credit: String(credit),
    balance: String(debit - credit),
    note: 'adjustment',
    timestamp: new Date(args.timestamp),
    originalDueDate: args.originalDueDate ?? null,
    processingDueDate: args.processingDueDate ?? null,
  }).returning();
  createdLedgerIds.push(entry.id);
  return entry;
}

async function mkUnlockReversal(args: {
  customerId: number;
  tripId: number;
  amount: number;
  timestamp: string;
}) {
  const [entry] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER',
    entityId: args.customerId,
    txnType: 'UNLOCK_REVERSAL',
    txnId: args.tripId,
    debit: '0',
    credit: String(args.amount),
    balance: String(-args.amount),
    note: 'unlock reversal',
    timestamp: new Date(args.timestamp),
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

async function fetchTripOutstanding(customerId: number, tripId: number) {
  const [row] = await db.select({
    outstanding: sql<string>`coalesce(sum(${s.ledger.debit}), 0) - coalesce(sum(${s.ledger.credit}), 0)`,
  }).from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
      eq(s.ledger.txnId, tripId),
      sql`${s.ledger.txnType} IN ('TRIP_REVENUE', 'PAYMENT_RECEIVED', 'ADJUSTMENT', 'UNLOCK_REVERSAL')`,
    ));
  return Math.max(0, Number(row?.outstanding ?? 0));
}

async function fetchPaymentLedgerCount(receiptId: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.receiptId, receiptId),
      eq(s.ledger.txnType, 'PAYMENT_RECEIVED'),
    ));
  return Number(total ?? 0);
}

async function fetchAllocationCount(receiptId: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.paymentAllocations)
    .where(eq(s.paymentAllocations.receiptId, receiptId));
  return Number(total ?? 0);
}

async function fetchIdempotencyCount(idempotencyKey: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.idempotencyKeys)
    .where(and(
      eq(s.idempotencyKeys.endpoint, IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE),
      eq(s.idempotencyKeys.idempotencyKey, idempotencyKey),
    ));
  return Number(total ?? 0);
}

after(async () => {
  const receiptPattern = `M56-%${suffix}%`;
  const tripCodePattern = `M56-${suffix}%`;
  const namePattern = `M56 %${suffix}%`;
  try {
    if (createdStandaloneIdempotencyKeys.length > 0) {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, createdStandaloneIdempotencyKeys));
    }
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
      processingDueDate: null,
    });
    await mkRevenue({
      customerId: customer.id,
      tripId: tripB.id,
      amount: 1_000_000,
      timestamp: '2026-07-01T09:00:00.000Z',
      originalDueDate: '2026-07-06',
      processingDueDate: '2026-07-05',
    });
    await mkRevenue({
      customerId: customer.id,
      tripId: tripC.id,
      amount: 1_000_000,
      timestamp: '2026-07-03T09:00:00.000Z',
      originalDueDate: null,
      processingDueDate: null,
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
    assert.equal(await fetchTripOutstanding(customer.id, tripA.id), 500_000);
    assert.equal(await fetchTripOutstanding(customer.id, tripB.id), 0);
    assert.equal(await fetchTripOutstanding(customer.id, tripC.id), 0);
  });

  test('EXPLICIT preserves caller order and persists unapplied credit', async () => {
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
      payments: [
        { tripId: trip2.id, amount: 500_000 },
        { tripId: trip1.id, amount: 400_000 },
      ],
    });

    assert.equal(result.allocationMethod, 'EXPLICIT');
    assert.deepEqual(
      result.allocations.map((allocation) => [allocation.tripId, allocation.amount]),
      [
        [trip2.id, 500_000],
        [trip1.id, 400_000],
      ],
    );
    assert.equal(result.allocatedTotal, 900_000);
    assert.equal(result.unappliedAmount, 2_100_000);
    assert.equal(await fetchPostedCredits(customer.id, trip2.id), 500_000);
    assert.equal(await fetchPostedCredits(customer.id, trip1.id), 400_000);
    assert.equal(await fetchUnappliedCredit(customer.id, receiptId), 2_100_000);
    assert.equal(await fetchAllocationCount(receiptId), 2);
  });

  test('EXPLICIT honors authoritative outstanding including adjustments and unlock reversals', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const tripDebit = await mkTrip(customer.id, route.id, cargo.id, '2026-07-22');
    const tripCredit = await mkTrip(customer.id, route.id, cargo.id, '2026-07-23');

    await mkRevenue({
      customerId: customer.id,
      tripId: tripDebit.id,
      amount: 1_000_000,
      timestamp: '2026-07-22T08:00:00.000Z',
      originalDueDate: '2026-07-27',
      processingDueDate: '2026-07-27',
    });
    await mkAdjustment({
      customerId: customer.id,
      tripId: tripDebit.id,
      amount: 300_000,
      timestamp: '2026-07-22T09:00:00.000Z',
      originalDueDate: '2026-07-27',
      processingDueDate: '2026-07-27',
    });
    await mkRevenue({
      customerId: customer.id,
      tripId: tripCredit.id,
      amount: 1_000_000,
      timestamp: '2026-07-23T08:00:00.000Z',
      originalDueDate: '2026-07-28',
      processingDueDate: '2026-07-28',
    });
    await mkAdjustment({
      customerId: customer.id,
      tripId: tripCredit.id,
      amount: -200_000,
      timestamp: '2026-07-23T09:00:00.000Z',
      originalDueDate: '2026-07-28',
      processingDueDate: '2026-07-28',
    });
    await mkUnlockReversal({
      customerId: customer.id,
      tripId: tripCredit.id,
      amount: 400_000,
      timestamp: '2026-07-23T10:00:00.000Z',
    });

    const receiptId = nextReceipt();
    const result = await recordPaymentReceipt({
      customerId: customer.id,
      receiptId,
      amount: 1_700_000,
      payments: [
        { tripId: tripDebit.id, amount: 1_300_000 },
        { tripId: tripCredit.id, amount: 400_000 },
      ],
    });

    assert.deepEqual(
      result.allocations.map((allocation) => [allocation.tripId, allocation.amount]),
      [
        [tripDebit.id, 1_300_000],
        [tripCredit.id, 400_000],
      ],
    );
    assert.equal(await fetchTripOutstanding(customer.id, tripDebit.id), 0);
    assert.equal(await fetchTripOutstanding(customer.id, tripCredit.id), 0);

    const rejectReceiptId = nextReceipt();
    await assert.rejects(
      () => recordPaymentReceipt({
        customerId: customer.id,
        receiptId: rejectReceiptId,
        payments: [{ tripId: tripCredit.id, amount: 401_000 }],
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 422 && error.message.includes('vượt quá số dư'),
    );
    assert.equal(await fetchReceiptCount(rejectReceiptId), 0);
  });

  test('same receipt id replays the exact persisted result and rejects changed payloads or customer', async () => {
    const customer = await mkCustomer();
    const otherCustomer = await mkCustomer();
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
    await mkRevenue({
      customerId: customer.id,
      tripId: trip.id,
      amount: 500_000,
      timestamp: '2026-07-22T08:00:00.000Z',
      originalDueDate: '2026-07-26',
      processingDueDate: '2026-07-26',
    });

    const receiptId = nextReceipt();
    const first = await recordPaymentReceipt({
      customerId: customer.id,
      receiptId,
      amount: 2_000_000,
    });
    await mkRevenue({
      customerId: customer.id,
      tripId: trip.id,
      amount: 250_000,
      timestamp: '2026-07-24T08:00:00.000Z',
      originalDueDate: '2026-07-29',
      processingDueDate: '2026-07-29',
    });
    const replay = await recordPaymentReceipt({
      customerId: customer.id,
      receiptId,
      amount: 2_000_000,
    });

    assert.equal(first.id, replay.id);
    assert.equal(replay.created, false);
    assert.deepEqual(replay, { ...first, created: false });
    assert.equal(await fetchReceiptCount(receiptId), 1);
    assert.equal(await fetchPostedCredits(customer.id, trip.id), 2_000_000);
    assert.equal(await fetchAllocationCount(receiptId), 1);
    assert.equal(await fetchPaymentLedgerCount(receiptId), 1);

    await assert.rejects(
      () => recordPaymentReceipt({
        customerId: customer.id,
        receiptId,
        amount: 1_000_000,
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 409 && error.message.includes('Mã biên lai đã tồn tại'),
    );
    await assert.rejects(
      () => recordPaymentReceipt({
        customerId: otherCustomer.id,
        receiptId,
        amount: 2_000_000,
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
    assert.deepEqual(replay.result, first.result);
    assert.equal(await fetchAllocationCount(receiptId), 1);
    assert.equal(await fetchPaymentLedgerCount(receiptId), 1);

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

  test('runIdempotent replays the stored response snapshot instead of mutable current state', async () => {
    const idempotencyKey = `m56-snapshot-${suffix}`;
    createdStandaloneIdempotencyKeys.push(idempotencyKey);

    const first = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE,
      idempotencyKey,
      payload: { receiptId: `M56-SNAPSHOT-${suffix}` },
      create: async () => ({
        nested: { amount: 1250000, note: 'original snapshot' },
        status: 'CONFIRMED',
      }),
      load: async () => {
        throw new Error('replay should use response snapshot, not load');
      },
    });

    first.result.nested.amount = 0;
    first.result.nested.note = 'mutated caller copy';

    const replay = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE,
      idempotencyKey,
      payload: { receiptId: `M56-SNAPSHOT-${suffix}` },
      create: async () => {
        throw new Error('create should not run on replay');
      },
      load: async () => {
        throw new Error('replay should use response snapshot, not load');
      },
    });

    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, {
      nested: { amount: 1250000, note: 'original snapshot' },
      status: 'CONFIRMED',
    });
  });

  test('inactive and deleted customers fail before any receipt or ledger write', async () => {
    const route = await mkRoute();
    const cargo = await mkCargo();

    const [lockedCustomer] = await db.insert(s.customers)
      .values({ name: `M56 locked customer ${suffix}`, status: 'LOCKED' })
      .returning();
    createdCustomerIds.push(lockedCustomer.id);
    const lockedTrip = await mkTrip(lockedCustomer.id, route.id, cargo.id, '2026-07-24');
    await mkRevenue({
      customerId: lockedCustomer.id,
      tripId: lockedTrip.id,
      amount: 1_000_000,
      timestamp: '2026-07-24T08:00:00.000Z',
      originalDueDate: '2026-07-29',
      processingDueDate: '2026-07-29',
    });

    const lockedReceiptId = nextReceipt();
    await assert.rejects(
      () => recordPaymentReceipt({
        customerId: lockedCustomer.id,
        receiptId: lockedReceiptId,
        amount: 500_000,
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 422 && error.message.includes('không thể ghi nhận thanh toán'),
    );
    assert.equal(await fetchReceiptCount(lockedReceiptId), 0);
    assert.equal(await fetchPaymentLedgerCount(lockedReceiptId), 0);

    const deletedCustomer = await mkCustomer();
    const deletedTrip = await mkTrip(deletedCustomer.id, route.id, cargo.id, '2026-07-25');
    await mkRevenue({
      customerId: deletedCustomer.id,
      tripId: deletedTrip.id,
      amount: 1_000_000,
      timestamp: '2026-07-25T08:00:00.000Z',
      originalDueDate: '2026-07-30',
      processingDueDate: '2026-07-30',
    });
    await db.update(s.customers)
      .set({ deletedAt: new Date('2026-07-26T00:00:00.000Z') })
      .where(eq(s.customers.id, deletedCustomer.id));

    const deletedReceiptId = nextReceipt();
    await assert.rejects(
      () => recordPaymentReceipt({
        customerId: deletedCustomer.id,
        receiptId: deletedReceiptId,
        amount: 500_000,
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 404 && error.message.includes('Khách hàng không tồn tại'),
    );
    assert.equal(await fetchReceiptCount(deletedReceiptId), 0);
    assert.equal(await fetchPaymentLedgerCount(deletedReceiptId), 0);
  });

  test('runIdempotent rolls back business rows when create fails', async () => {
    const customer = await mkCustomer();
    const idempotencyKey = `m56-rollback-${suffix}`;
    const receiptId = `M56-ROLLBACK-${suffix}`;

    await assert.rejects(
      () => runIdempotent({
        endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE,
        idempotencyKey,
        payload: { customerId: customer.id, receiptId, amount: 123_000 },
        entityType: 'payment_receipt',
        create: async (tx) => {
          await tx.insert(s.paymentReceipts).values({
            receiptId,
            customerId: customer.id,
            receivedAmount: '123000',
            allocatedTotal: '0',
            unappliedAmount: '123000',
            allocationMethod: 'OLDEST_DUE',
            requestHash: 'rollback-test',
          });
          throw new Error('forced rollback');
        },
        load: async () => {
          throw new Error('load should not be called');
        },
      }),
      /forced rollback/,
    );

    assert.equal(await fetchReceiptCount(receiptId), 0);
    assert.equal(await fetchIdempotencyCount(idempotencyKey), 0);
  });

  test('default oldest-due allocation rejects receipts that would span more than 200 trips', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();

    for (let index = 0; index < 201; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0');
      const trip = await mkTrip(customer.id, route.id, cargo.id, `2026-07-${day}`);
      await mkRevenue({
        customerId: customer.id,
        tripId: trip.id,
        amount: 10_000,
        timestamp: `2026-07-${day}T08:00:00.000Z`,
        originalDueDate: `2026-08-${day}`,
        processingDueDate: `2026-08-${day}`,
      });
    }

    const receiptId = nextReceipt();
    await assert.rejects(
      () => recordPaymentReceipt({
        customerId: customer.id,
        receiptId,
        amount: 2_010_000,
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 422 && error.message.includes('Thanh toán tự động chỉ hỗ trợ tối đa 200 chuyến mỗi lần'),
    );

    assert.equal(await fetchReceiptCount(receiptId), 0);
    assert.equal(await fetchPaymentLedgerCount(receiptId), 0);
  });

  test('payment receipt idempotency does not deadlock under pool-sized unique concurrency', async () => {
    const route = await mkRoute();
    const cargo = await mkCargo();
    const customers = await Promise.all(
      Array.from({ length: 11 }, async (_value, index) => {
        const customer = await mkCustomer();
        const trip = await mkTrip(customer.id, route.id, cargo.id, `2026-07-${String(index + 1).padStart(2, '0')}`);
        await mkRevenue({
          customerId: customer.id,
          tripId: trip.id,
          amount: 100_000,
          timestamp: `2026-07-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
          originalDueDate: `2026-07-${String(index + 10).padStart(2, '0')}`,
          processingDueDate: `2026-07-${String(index + 10).padStart(2, '0')}`,
        });
        return { customer, trip, index };
      }),
    );

    const tasks = customers.map(({ customer, index }) => recordPaymentReceiptIdempotent({
      input: {
        customerId: customer.id,
        receiptId: `M56-CONC-${suffix}-${index}`,
        amount: 100_000,
      },
      idempotencyKey: `m56-concurrency-${suffix}-${index}`,
    }));

    const results = await Promise.race([
      Promise.all(tasks),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('timed out waiting for concurrent idempotent receipts')), 8_000);
      }),
    ]);

    assert.equal(results.length, 11);
    assert.ok(results.every((result) => result.replayed === false));
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
      rows.map((row) => [
        row.targetId,
        Number(row.amount),
        row.allocationOrder,
        row.processingDueDateSnapshot,
        new Date(row.issueTimestampSnapshot ?? 0).toISOString(),
      ]),
      [
        [trip2.id, 250_000, 1, '2026-08-01', '2026-07-27T08:00:00.000Z'],
        [trip1.id, 500_000, 2, '2026-07-31', '2026-07-26T08:00:00.000Z'],
      ],
    );
    const receipt = await fetchReceipt(receiptId);
    assert.ok(receipt);
    assert.equal(Number(receipt!.allocatedTotal), 750_000);
  });
});
