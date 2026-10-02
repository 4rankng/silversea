import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { recordFundedOpsAdvance } from '../services/expense-accounting-reconciliation.service';
import { disconnectRedis } from '../lib/redis';
import forwarderRoutes from '../routes/forwarder';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];

let server: http.Server;
let baseUrl = '';
let adminUserId = 0;
let forwarderUserId = 0;
let tripId = 0;
let tripExpenseId = 0;
let shipmentId = 0;
let customerId = 0;
let routeId = 0;
let cargoTypeId = 0;
let treasuryAccountId = 0;

async function requestJson(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    idempotencyKey?: string;
    body?: Record<string, unknown>;
  } = {},
) {
  if (init.idempotencyKey) idempotencyKeys.push(init.idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Record<string, unknown>,
  };
}

function assertReplayBody(
  first: Record<string, unknown>,
  replay: Record<string, unknown>,
): void {
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual({ ...replay, replayed: false }, first);
}

before(async () => {
  const [admin, forwarderUser] = await db.insert(s.users).values([
    {
      username: `q23-fwd-admin-${suffix}`,
      passwordHash: 'x',
      role: Role.ADMIN,
      status: 'ACTIVE',
    },
    {
      username: `q23-fwd-user-${suffix}`,
      passwordHash: 'x',
      role: Role.OPS,
      status: 'ACTIVE',
    },
  ]).returning({ id: s.users.id });
  adminUserId = admin.id;
  forwarderUserId = forwarderUser.id;
  const [account] = await db.insert(s.treasuryAccounts).values({ code: `Q23-FUND-${suffix}`, name: `Q23 funding ${suffix}`, type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: adminUserId, updatedBy: adminUserId }).returning();
  treasuryAccountId = account.id;

  const [customer] = await db.insert(s.customers).values({
    name: `Q23 Forwarder Customer ${suffix}`,
  }).returning({ id: s.customers.id });
  customerId = customer.id;

  const [route] = await db.insert(s.routes).values({
    name: `Q23 Forwarder Route ${suffix}`,
  }).returning({ id: s.routes.id });
  routeId = route.id;

  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q23 Forwarder Cargo ${suffix}`,
  }).returning({ id: s.cargoTypes.id });
  cargoTypeId = cargoType.id;

  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `Q23-SHIP-${suffix}`,
    customerId,
    cargoTypeId,
    status: 'DISPATCHED',
  }).returning({ id: s.shipments.id });
  shipmentId = shipment.id;
  await db.insert(s.userShipmentLinks).values({
    userId: forwarderUserId,
    shipmentId,
  });

  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q23-FWD-${suffix}`,
    shipmentId,
    customerId,
    routeId,
    cargoTypeId,
    departureDate: '2026-07-28',
    status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id });
  tripId = trip.id;

  const [expense] = await db.insert(s.tripExpenses).values({
    tripId,
    forwarderId: forwarderUserId,
    createdBy: forwarderUserId,
    expenseType: 'OTHER',
    buyAmount: '1000',
    sellAmount: '0',
    note: 'q23 forwarder settlement expense',
  }).returning({ id: s.tripExpenses.id });
  tripExpenseId = expense.id;

  await db.insert(s.tripExpenseCompletionScopes).values({
    tripId,
    tripContainerId: null,
    status: 'COMPLETED',
    completedBy: adminUserId,
    completedAt: new Date(),
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      userId: forwarderUserId,
      username: `q23-fwd-user-${suffix}`,
      email: null,
      fullName: null,
      role: Role.OPS,
    };
    next();
  });
  app.use('/api/forwarder/me', forwarderRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

describe('Q23 forwarder create-route replay', () => {
  it('replays advance-request create with the original 201 status/body and one stored effect', async () => {
    const key = `q23-advance-request-create-${suffix}`;
    const payload = { amount: 1250000, reason: 'Ứng tiền tuyến đường' };

    const first = await requestJson('/api/forwarder/me/advance-requests', {
      idempotencyKey: key,
      body: payload,
    });
    const replay = await requestJson('/api/forwarder/me/advance-requests', {
      idempotencyKey: key,
      body: payload,
    });
    const drift = await requestJson('/api/forwarder/me/advance-requests', {
      idempotencyKey: key,
      body: { ...payload, amount: 1300000 },
    });

    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(replay.status, 201, JSON.stringify(replay.body));
    assertReplayBody(first.body, replay.body);
    assert.equal(drift.status, 409);

    const requestId = Number(first.body.id);
    const stored = await db.select({ id: s.advanceRequests.id })
      .from(s.advanceRequests)
      .where(eq(s.advanceRequests.id, requestId));
    assert.equal(stored.length, 1);

    // Recording the request is direct and idempotent, but does not deliver cash.
    assert.equal(first.body.status, 'RECORDED');
    const advanceLedger = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'FORWARDER'),
        eq(s.ledger.entityId, forwarderUserId),
        eq(s.ledger.txnId, requestId),
        eq(s.ledger.txnType, TxnType.OPS_ADVANCE),
      ));
    assert.equal(advanceLedger.length, 0);
  });

  it('recorded advance is immutable through removed review and generic mutation endpoints', async () => {
    const result = await requestJson('/api/forwarder/me/advance-requests', {
      idempotencyKey: `immutable-${suffix}`, body: { amount: 230000, reason: 'Recorded advance' },
    });
    assert.equal(result.status, 201);
    const id = Number(result.body.id);
    const [before] = await db.select().from(s.advanceRequests).where(eq(s.advanceRequests.id, id));
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const rejected = await requestJson(`/api/forwarder/me/advance-requests/${id}`, { method, body: { amount: 1 } });
      assert.equal(rejected.status, 404);
    }
    for (const decision of ['approve', 'reject']) {
      const rejected = await requestJson(`/api/forwarder/me/advance-requests/${id}/${decision}`, { body: { reason: 'obsolete' } });
      assert.equal(rejected.status, 404);
    }
    const [after] = await db.select().from(s.advanceRequests).where(eq(s.advanceRequests.id, id));
    assert.equal(after.status, 'RECORDED');
    assert.deepEqual(after, before);
    const entries = await db.select().from(s.ledger).where(and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, id)));
    assert.equal(entries.length, 0, 'an immutable request does not invent a cash transfer');
  });

  it('replays advance-settlement create with the original 201 status/body and one stored effect', async () => {
    const [approvedRequest] = await db.insert(s.advanceRequests).values({
      requesterId: forwarderUserId,
      // Balanced against the linked expense (buyAmount 1000) + refund 0 so the
      // approve-time assertSettlementBalanced passes.
      amount: '1000',
      reason: `Q23 approved request ${suffix}`,
      status: 'RECORDED',
      approvedBy: adminUserId,
      approvedAt: new Date(),
    }).returning({ id: s.advanceRequests.id });

    await db.transaction(tx => recordFundedOpsAdvance(tx, { userId: adminUserId, role: Role.ADMIN }, {
      opsUserId: forwarderUserId, amount: 1000, advanceRequestId: approvedRequest.id, reason: 'Fund the source for replay test',
      treasuryAccountId, valueDate: '2026-09-10', physicalReference: `Q23-FUND-${suffix}`,
    }));

    const key = `q23-advance-settlement-create-${suffix}`;
    const payload = {
      advanceRequestIds: [approvedRequest.id],
      tripExpenseIds: [tripExpenseId],
      refundAmount: 0,
      note: 'Chốt hoàn ứng Q23',
    };

    const first = await requestJson('/api/forwarder/me/advance-settlements', {
      idempotencyKey: key,
      body: payload,
    });
    const replay = await requestJson('/api/forwarder/me/advance-settlements', {
      idempotencyKey: key,
      body: payload,
    });
    const drift = await requestJson('/api/forwarder/me/advance-settlements', {
      idempotencyKey: key,
      body: { ...payload, refundAmount: 1000 },
    });

    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(replay.status, 201, JSON.stringify(replay.body));
    assertReplayBody(first.body, replay.body);
    assert.equal(drift.status, 409);

    const settlementId = Number(first.body.id);
    const storedSettlements = await db.select({ id: s.advanceSettlements.id })
      .from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.id, settlementId));
    assert.equal(storedSettlements.length, 1);

    const requestLinks = await db.select({ id: s.advanceSettlementRequests.id })
      .from(s.advanceSettlementRequests)
      .where(eq(s.advanceSettlementRequests.settlementId, settlementId));
    const expenseLinks = await db.select({ id: s.settlementExpenses.id })
      .from(s.settlementExpenses)
      .where(eq(s.settlementExpenses.settlementId, settlementId));
    assert.equal(requestLinks.length, 1);
    assert.equal(expenseLinks.length, 1);

    // 2026-09-10 (phê duyệt removed, TC-CHUNK4-009): the settlement applies
    // at creation — ONE call lands APPROVED (linked expenses approved, ledger
    // posted); the check/approve/reject endpoints are gone.
    assert.equal(first.body.status, 'RECORDED');
  });
});

after(async () => {
  let cleanupError: unknown;
  const cleanup = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      cleanupError ??= error;
    }
  };

  await cleanup(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  await cleanup(async () => {
    const settlements = await db.select({ id: s.advanceSettlements.id })
      .from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.forwarderId, forwarderUserId));
    const settlementIds = settlements.map((settlement) => settlement.id);
    if (settlementIds.length > 0) {
      await db.delete(s.settlementExpenses)
        .where(inArray(s.settlementExpenses.settlementId, settlementIds));
      await db.delete(s.advanceSettlementRequests)
        .where(inArray(s.advanceSettlementRequests.settlementId, settlementIds));
      await db.delete(s.advanceSettlements)
        .where(inArray(s.advanceSettlements.id, settlementIds));
    }
    await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, treasuryAccountId));
    await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, treasuryAccountId));
    const createdRequests = await db.select({ id: s.advanceRequests.id })
      .from(s.advanceRequests)
      .where(eq(s.advanceRequests.requesterId, forwarderUserId));
    if (createdRequests.length > 0) {
      await db.delete(s.ledger).where(and(
        eq(s.ledger.entityType, 'FORWARDER'),
        eq(s.ledger.entityId, forwarderUserId),
        inArray(s.ledger.txnId, createdRequests.map((r) => r.id)),
      ));
    }
    await db.delete(s.advanceRequests)
      .where(eq(s.advanceRequests.requesterId, forwarderUserId));
    if (idempotencyKeys.length > 0) {
      await db.delete(s.idempotencyKeys)
        .where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
    }
    await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, tripId));
    await db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, tripExpenseId));
    await db.delete(s.trips).where(eq(s.trips.id, tripId));
    await db.delete(s.userShipmentLinks).where(eq(s.userShipmentLinks.shipmentId, shipmentId));
    await db.delete(s.shipments).where(eq(s.shipments.id, shipmentId));
    await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
    await db.delete(s.routes).where(eq(s.routes.id, routeId));
    await db.delete(s.customers).where(eq(s.customers.id, customerId));
    await db.delete(s.users).where(inArray(s.users.id, [adminUserId, forwarderUserId]));
  });
  await cleanup(disconnectRedis);
  await cleanup(() => client.end());

  if (cleanupError) throw cleanupError;
});
