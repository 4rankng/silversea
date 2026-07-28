import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
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
let customerId = 0;
let routeId = 0;
let cargoTypeId = 0;

async function requestJson(
  path: string,
  init: {
    method?: 'GET' | 'POST';
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
    body: await response.json() as Record<string, unknown>,
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
      role: Role.FORWARDER,
      status: 'ACTIVE',
    },
  ]).returning({ id: s.users.id });
  adminUserId = admin.id;
  forwarderUserId = forwarderUser.id;

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

  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q23-FWD-${suffix}`,
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
      role: Role.FORWARDER,
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
  });

  it('replays advance-settlement create with the original 201 status/body and one stored effect', async () => {
    const [approvedRequest] = await db.insert(s.advanceRequests).values({
      requesterId: forwarderUserId,
      amount: '900000',
      reason: `Q23 approved request ${suffix}`,
      status: 'APPROVED',
      approvedBy: adminUserId,
      approvedAt: new Date(),
    }).returning({ id: s.advanceRequests.id });

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
    await db.delete(s.advanceRequests)
      .where(eq(s.advanceRequests.requesterId, forwarderUserId));
    if (idempotencyKeys.length > 0) {
      await db.delete(s.idempotencyKeys)
        .where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
    }
    await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, tripId));
    await db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, tripExpenseId));
    await db.delete(s.trips).where(eq(s.trips.id, tripId));
    await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
    await db.delete(s.routes).where(eq(s.routes.id, routeId));
    await db.delete(s.customers).where(eq(s.customers.id, customerId));
    await db.delete(s.users).where(inArray(s.users.id, [adminUserId, forwarderUserId]));
  });
  await cleanup(disconnectRedis);
  await cleanup(() => client.end());

  if (cleanupError) throw cleanupError;
});
