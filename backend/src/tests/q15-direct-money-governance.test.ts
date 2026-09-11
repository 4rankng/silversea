import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import paymentsRoutes from '../routes/financial/payments.routes';
import penaltiesRoutes from '../routes/financial/penalties.routes';
import { createPenalty } from '../services/financial.service';
import { ApiError } from '../errors';
import { rejectGovernanceAction } from '../services/governance-transition.service';

const actorIds: number[] = [];
const customerIds: number[] = [];
const supplierIds: number[] = [];
const driverIds: number[] = [];
const tripIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const governanceActionIds: number[] = [];
const paymentReceiptIds: number[] = [];
const penaltyIds: number[] = [];

let actors: Array<{ id: number; role: Role }> = [];
let server: http.Server;
let baseUrl = '';
let commandSequence = 0;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function api(
  method: string,
  path: string,
  body: Record<string, unknown> | undefined,
  actorIndex: number,
  idempotencyKey?: string,
) {
  const commandKey = idempotencyKey ?? `q15-direct-money-${suffix}-${++commandSequence}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Test-Actor': String(actorIndex),
    'Idempotency-Key': commandKey,
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function createFixture(label: string) {
  const [customer] = await db.insert(s.customers).values({
    name: `Q15 Customer ${label} ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  customerIds.push(customer.id);

  const [supplier] = await db.insert(s.suppliers).values({
    name: `Q15 Supplier ${label} ${suffix}`,
  }).returning();
  supplierIds.push(supplier.id);

  const [commissionSupplier] = await db.insert(s.suppliers).values({
    name: `Q15 Commission Supplier ${label} ${suffix}`,
  }).returning();
  supplierIds.push(commissionSupplier.id);

  const [carrier] = await db.insert(s.customers).values({
    name: `Q15 Carrier ${label} ${suffix}`,
    status: 'ACTIVE',
    isCarrier: true,
  }).returning();
  customerIds.push(carrier.id);

  const [payoutDriver] = await db.insert(s.drivers).values({
    name: `Q15 Payout Driver ${label} ${suffix}`,
  }).returning();
  driverIds.push(payoutDriver.id);

  const [penaltyCreateDriver] = await db.insert(s.drivers).values({
    name: `Q15 Penalty Create Driver ${label} ${suffix}`,
  }).returning();
  driverIds.push(penaltyCreateDriver.id);

  const [penaltyCancelDriver] = await db.insert(s.drivers).values({
    name: `Q15 Penalty Cancel Driver ${label} ${suffix}`,
  }).returning();
  driverIds.push(penaltyCancelDriver.id);

  const [route] = await db.insert(s.routes).values({
    name: `Q15 Route ${label} ${suffix}`,
  }).returning();
  routeIds.push(route.id);

  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q15 Cargo ${label} ${suffix}`,
  }).returning();
  cargoTypeIds.push(cargoType.id);

  const trip = await insertTripComposite(db, {
    tripCode: `Q15-${label}-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    departureDate: '2026-07-27',
    status: 'COMPLETED',
    revenue: '500000',
    carrierType: 'OWN',
  });
  tripIds.push(trip.id);

  await db.insert(s.ledger).values({
    entityType: 'CUSTOMER',
    entityId: customer.id,
    txnType: TxnType.TRIP_REVENUE,
    txnId: trip.id,
    debit: '500000',
    credit: '0',
    balance: '500000',
    note: `Q15 receivable ${label}`,
    timestamp: new Date('2026-07-27T00:00:00+07:00'),
  });

  await db.insert(s.ledger).values({
    entityType: 'VENDOR',
    entityId: supplier.id,
    txnType: TxnType.COMMISSION,
    txnId: trip.id,
    debit: '0',
    credit: '900000',
    balance: '900000',
    note: `Q15 vendor payable ${label}`,
    timestamp: new Date('2026-07-27T00:00:00+07:00'),
  });

  await db.insert(s.ledger).values({
    entityType: 'CUSTOMER',
    entityId: carrier.id,
    txnType: TxnType.EXTERNAL_CARRIER_COST,
    txnId: trip.id,
    debit: '0',
    credit: '700000',
    balance: '-700000',
    note: `Q15 carrier payable ${label}`,
    timestamp: new Date('2026-07-27T00:00:00+07:00'),
  });

  await db.insert(s.ledger).values({
    entityType: 'DRIVER',
    entityId: payoutDriver.id,
    txnType: TxnType.DRIVER_SALARY,
    txnId: trip.id,
    debit: '0',
    credit: '600000',
    balance: '600000',
    note: `Q15 driver payable ${label}`,
    timestamp: new Date('2026-07-27T00:00:00+07:00'),
  });

  const seededPenalty = await createPenalty({
    driverId: penaltyCancelDriver.id,
    tripId: trip.id,
    customReason: `Q15 seeded penalty ${label} ${suffix}`,
    amount: 125000,
    date: '2026-07-27',
  });
  penaltyIds.push(seededPenalty.id);

  return {
    customer,
    supplier,
    commissionSupplier,
    carrier,
    payoutDriver,
    penaltyCreateDriver,
    penaltyCancelDriver,
    trip,
    seededPenalty,
  };
}

async function trackGovernanceAction(responseBody: Record<string, unknown>) {
  const actionId = Number(responseBody.id);
  governanceActionIds.push(actionId);
  return actionId;
}

async function trackPaymentReceipt(receiptId: string) {
  const [receipt] = await db.select({ id: s.paymentReceipts.id })
    .from(s.paymentReceipts)
    .where(eq(s.paymentReceipts.receiptId, receiptId))
    .limit(1);
  if (receipt) paymentReceiptIds.push(receipt.id);
  return receipt;
}

async function fetchLedgerCount(args: {
  entityType: 'CUSTOMER' | 'VENDOR' | 'CARRIER' | 'DRIVER';
  entityId: number;
  txnType: TxnType;
  receiptId?: string;
  txnId?: number;
}) {
  const clauses = [
    eq(s.ledger.entityType, args.entityType),
    eq(s.ledger.entityId, args.entityId),
    eq(s.ledger.txnType, args.txnType),
  ];
  if (args.receiptId) clauses.push(eq(s.ledger.receiptId, args.receiptId));
  if (args.txnId !== undefined) clauses.push(eq(s.ledger.txnId, args.txnId));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.ledger)
    .where(and(...clauses));
  return Number(total ?? 0);
}

async function fetchPenaltyByReason(customReason: string) {
  const [row] = await db.select()
    .from(s.penalties)
    .where(eq(s.penalties.customReason, customReason))
    .limit(1);
  if (row && !penaltyIds.includes(row.id)) penaltyIds.push(row.id);
  return row;
}

async function fetchPaymentReceiptCount(receiptId: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.paymentReceipts)
    .where(eq(s.paymentReceipts.receiptId, receiptId));
  return Number(total ?? 0);
}

async function fetchPenaltyReversalCount(penaltyId: number, driverId: number) {
  return fetchLedgerCount({
    entityType: 'DRIVER',
    entityId: driverId,
    txnType: TxnType.ADJUSTMENT,
    txnId: penaltyId,
  });
}

before(async () => {
  const actorRows = await db.insert(s.users).values([
    { username: `q15-direct-maker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT, status: 'ACTIVE' },
    { username: `q15-direct-checker-${suffix}`, passwordHash: 'x', role: Role.MANAGER, status: 'ACTIVE' },
    { username: `q15-direct-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN, status: 'ACTIVE' },
  ]).returning({ id: s.users.id, role: s.users.role });
  actors = actorRows.map((actor) => ({ id: actor.id, role: actor.role as Role }));
  actorIds.push(...actors.map((actor) => actor.id));

  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    const actorIndex = Number(req.header('X-Test-Actor') ?? 0);
    const actor = actors[actorIndex] ?? actors[0]!;
    req.user = {
      userId: actor.id,
      username: `q15-${actor.id}`,
      email: null,
      fullName: null,
      role: actor.role,
    };
    next();
  });
  app.use('/api', paymentsRoutes);
  app.use('/api', penaltiesRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  if (governanceActionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, governanceActionIds));
  }
  if (actorIds.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, actorIds));
    await db.delete(s.notifications).where(inArray(s.notifications.userId, actorIds));
  }
  if (paymentReceiptIds.length > 0) {
    await db.delete(s.paymentAllocations).where(inArray(s.paymentAllocations.paymentReceiptId, paymentReceiptIds));
    await db.delete(s.paymentReceipts).where(inArray(s.paymentReceipts.id, paymentReceiptIds));
  }
  if (tripIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, tripIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.ledger).where(and(
      inArray(s.ledger.entityType, ['CUSTOMER', 'CARRIER']),
      inArray(s.ledger.entityId, customerIds),
    ));
  }
  if (supplierIds.length > 0) {
    await db.delete(s.ledger).where(and(
      eq(s.ledger.entityType, 'VENDOR'),
      inArray(s.ledger.entityId, supplierIds),
    ));
  }
  if (driverIds.length > 0) {
    await db.delete(s.ledger).where(and(
      eq(s.ledger.entityType, 'DRIVER'),
      inArray(s.ledger.entityId, driverIds),
    ));
  }
  if (penaltyIds.length > 0) {
    await db.delete(s.penalties).where(inArray(s.penalties.id, penaltyIds));
  }
  if (tripIds.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (cargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
  }
  if (routeIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  }
  if (driverIds.length > 0) {
    await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
  }
  if (supplierIds.length > 0) {
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, supplierIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  if (actorIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, actorIds));
  }

  await disconnectRedis();
  await client.end();
});

describe('Q15 direct-money governance slice', () => {
  it('applies all seven direct-money commands immediately at request time (phê duyệt removed 2026-09-10)', async () => {
    const fixture = await createFixture('all-seven');
    const paymentReceiptId = `Q15-RECEIPT-${suffix}`;
    const vendorReceiptId = `Q15-VENDOR-${suffix}`;
    const carrierReceiptId = `Q15-CARRIER-${suffix}`;
    const penaltyReason = `Q15 create penalty ${suffix}`;

    const paymentRequest = await api('POST', '/api/payments/receive', {
      customerId: fixture.customer.id,
      receiptId: paymentReceiptId,
      amount: 500000,
      payments: [{ tripId: fixture.trip.id, amount: 500000 }],
    }, 0);
    const paymentAction = paymentRequest.body.result as Record<string, unknown>;
    assert.equal(paymentRequest.status, 201);
    assert.equal(paymentAction.status, 'APPROVED');
    await trackGovernanceAction(paymentAction);

    const vendorRequest = await api('POST', '/api/payments/vendor', {
      supplierId: fixture.supplier.id,
      receiptId: vendorReceiptId,
      amount: 300000,
      date: '2026-07-27',
    }, 0);
    assert.equal(vendorRequest.status, 201);
    assert.equal(vendorRequest.body.status, 'APPROVED');
    await trackGovernanceAction(vendorRequest.body);

    const carrierRequest = await api('POST', '/api/payments/carrier', {
      supplierId: fixture.carrier.id,
      receiptId: carrierReceiptId,
      amount: 250000,
      date: '2026-07-27',
    }, 0);
    assert.equal(carrierRequest.status, 201);
    assert.equal(carrierRequest.body.status, 'APPROVED');
    await trackGovernanceAction(carrierRequest.body);

    const commissionRequest = await api('POST', '/api/commissions', {
      supplierId: fixture.commissionSupplier.id,
      amount: 180000,
      tripId: fixture.trip.id,
      note: `Q15 commission ${suffix}`,
    }, 0);
    assert.equal(commissionRequest.status, 201);
    assert.equal(commissionRequest.body.status, 'APPROVED');
    await trackGovernanceAction(commissionRequest.body);

    const payoutRequest = await api('POST', `/api/drivers/${fixture.payoutDriver.id}/payouts`, {
      amount: 220000,
      method: 'BANK',
      payoutDate: '2026-07-27',
      receiptId: `Q15-PAYOUT-${suffix}`,
    }, 0);
    assert.equal(payoutRequest.status, 201);
    assert.equal(payoutRequest.body.status, 'APPROVED');
    await trackGovernanceAction(payoutRequest.body);

    const penaltyCreateRequest = await api('POST', '/api/penalties', {
      driverId: fixture.penaltyCreateDriver.id,
      tripId: fixture.trip.id,
      customReason: penaltyReason,
      amount: 90000,
      date: '2026-07-27',
    }, 0);
    assert.equal(penaltyCreateRequest.status, 201);
    assert.equal(penaltyCreateRequest.body.status, 'APPROVED');
    await trackGovernanceAction(penaltyCreateRequest.body);

    const penaltyCancelRequest = await api('POST', `/api/penalties/${fixture.seededPenalty.id}/cancel`, {
      reason: `Q15 cancel penalty ${suffix}`,
    }, 2);
    assert.equal(penaltyCancelRequest.status, 200);
    assert.equal(penaltyCancelRequest.body.status, 'APPROVED');
    await trackGovernanceAction(penaltyCancelRequest.body);

    // 2026-09-10: phê duyệt removed — the requests above already applied;
    // no pending window, no separate check/approve calls.

    const paymentReceipt = await trackPaymentReceipt(paymentReceiptId);
    assert.ok(paymentReceipt);
    assert.equal(await fetchPaymentReceiptCount(paymentReceiptId), 1);
    assert.equal(await fetchLedgerCount({
      entityType: 'CUSTOMER',
      entityId: fixture.customer.id,
      txnType: TxnType.PAYMENT_RECEIVED,
      receiptId: paymentReceiptId,
    }), 1);
    assert.equal(await fetchLedgerCount({
      entityType: 'VENDOR',
      entityId: fixture.supplier.id,
      txnType: TxnType.VENDOR_PAYMENT,
      receiptId: vendorReceiptId,
    }), 1);
    assert.equal(await fetchLedgerCount({
      entityType: 'CARRIER',
      entityId: fixture.carrier.id,
      txnType: TxnType.VENDOR_PAYMENT,
      receiptId: carrierReceiptId,
    }), 1);
    assert.equal(await fetchLedgerCount({
      entityType: 'VENDOR',
      entityId: fixture.commissionSupplier.id,
      txnType: TxnType.COMMISSION,
      txnId: fixture.trip.id,
    }), 1);
    assert.equal(await fetchLedgerCount({
      entityType: 'DRIVER',
      entityId: fixture.payoutDriver.id,
      txnType: TxnType.DRIVER_PAYOUT,
    }), 1);

    const createdPenalty = await fetchPenaltyByReason(penaltyReason);
    assert.ok(createdPenalty);
    assert.equal(await fetchLedgerCount({
      entityType: 'DRIVER',
      entityId: fixture.penaltyCreateDriver.id,
      txnType: TxnType.PENALTY,
      txnId: createdPenalty!.id,
    }), 1);

    const [canceledPenalty] = await db.select({ status: s.penalties.status })
      .from(s.penalties)
      .where(eq(s.penalties.id, fixture.seededPenalty.id))
      .limit(1);
    assert.equal(canceledPenalty?.status, 'CANCELED');
    assert.equal(await fetchPenaltyReversalCount(fixture.seededPenalty.id, fixture.penaltyCancelDriver.id), 1);
  });

  it('applies governed payments at request time and preserves replay semantics (phê duyệt removed 2026-09-10)', async () => {
    const fixture = await createFixture('replay-and-applied');

    const appliedReceiptId = `Q15-APPLIED-${suffix}`;
    const appliedKey = `q15-applied-${suffix}`;
    const appliedBody = {
      supplierId: fixture.supplier.id,
      receiptId: appliedReceiptId,
      amount: 200000,
      date: '2026-07-27',
    };

    // Submit applies immediately; replay returns the same applied outcome.
    const firstSubmit = await api('POST', '/api/payments/vendor', appliedBody, 0, appliedKey);
    assert.equal(firstSubmit.status, 201);
    assert.equal(firstSubmit.body.replayed, false);
    assert.equal(firstSubmit.body.status, 'APPROVED');
    await trackGovernanceAction(firstSubmit.body);
    assert.equal(await fetchLedgerCount({
      entityType: 'VENDOR',
      entityId: fixture.supplier.id,
      txnType: TxnType.VENDOR_PAYMENT,
      receiptId: appliedReceiptId,
    }), 1);

    const replaySubmit = await api('POST', '/api/payments/vendor', appliedBody, 0, appliedKey);
    assert.equal(replaySubmit.status, 200);
    assert.equal(replaySubmit.body.replayed, true);
    assert.equal(replaySubmit.body.status, 'APPROVED');
    assert.equal(replaySubmit.body.id, firstSubmit.body.id);

    // The old pending-reject path is gone: with nothing pending, the
    // decision endpoints refuse rather than mutate an applied action.
    // Governance endpoints removed: pin the same 409 at the service layer.
    await assert.rejects(
      rejectGovernanceAction({
        actionId: Number(firstSubmit.body.id),
        actorId: actors[2]!.id,
        actorRole: actors[2]!.role,
        expectedVersion: Number(firstSubmit.body.version),
        reason: `Q15 no-longer-pending ${suffix}`,
      }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 409,
    );
    assert.equal(await fetchLedgerCount({
      entityType: 'VENDOR',
      entityId: fixture.supplier.id,
      txnType: TxnType.VENDOR_PAYMENT,
      receiptId: appliedReceiptId,
    }), 1);

    // The old stale-source guard protected the window between request and
    // approve; request+apply are now atomic in one transaction, so that
    // window no longer exists and concurrent-balance conflicts surface as
    // ordinary 409s at submit time.
    const staleReceiptId = `Q15-STALE-${suffix}`;
    const staleSubmit = await api('POST', '/api/payments/vendor', {
      supplierId: fixture.supplier.id,
      receiptId: staleReceiptId,
      amount: 210000,
      date: '2026-07-27',
    }, 0, `q15-stale-${suffix}`);
    assert.equal(staleSubmit.status, 201);
    await trackGovernanceAction(staleSubmit.body as { id: number });
    assert.equal(await fetchLedgerCount({
      entityType: 'VENDOR',
      entityId: fixture.supplier.id,
      txnType: TxnType.VENDOR_PAYMENT,
      receiptId: staleReceiptId,
    }), 1);

});
});
