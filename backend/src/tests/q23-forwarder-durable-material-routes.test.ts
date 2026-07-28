import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, test } from 'node:test';
import express from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';
import forwarderRoutes from '../routes/forwarder';
import { setAuditEnrichmentHandlerForTest, setAuditPersistHandlerForTest } from '../services/audit.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];

let server: http.Server;
let baseUrl = '';
let forwarderUserId = 0;
let tripId = 0;
let customerId = 0;
let routeId = 0;
let cargoTypeId = 0;
let mutableExpenseId = 0;
let deletableExpenseId = 0;
let approvedAdvanceRequestId = 0;

async function api(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: {
    body?: Record<string, unknown>;
    idempotencyKey: string;
    expectedUpdatedAt?: string;
  },
) {
  idempotencyKeys.push(options.idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': options.idempotencyKey,
      ...(options.expectedUpdatedAt ? { 'If-Unmodified-Since': options.expectedUpdatedAt } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

beforeEach(() => {
  setAuditPersistHandlerForTest(null);
  setAuditEnrichmentHandlerForTest(async () => undefined);
});

before(async () => {
  const [forwarder] = await db.insert(s.users).values({
    username: `q23-forwarder-durable-${suffix}`,
    passwordHash: 'x',
    role: Role.FORWARDER,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  forwarderUserId = forwarder.id;

  const [customer] = await db.insert(s.customers).values({
    name: `Q23 forwarder durable customer ${suffix}`,
  }).returning({ id: s.customers.id });
  customerId = customer.id;
  const [route] = await db.insert(s.routes).values({
    name: `Q23 forwarder durable route ${suffix}`,
  }).returning({ id: s.routes.id });
  routeId = route.id;
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q23 forwarder durable cargo ${suffix}`,
  }).returning({ id: s.cargoTypes.id });
  cargoTypeId = cargoType.id;
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q23-FWD-DURABLE-${suffix}`.slice(0, 50),
    customerId,
    routeId,
    cargoTypeId,
    departureDate: '2026-07-28',
    status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id });
  tripId = trip.id;

  const [mutableExpense] = await db.insert(s.tripExpenses).values({
    tripId,
    forwarderId: forwarderUserId,
    createdBy: forwarderUserId,
    expenseType: 'OTHER',
    buyAmount: '1000',
    sellAmount: '0',
    note: 'q23 mutable expense',
  }).returning({ id: s.tripExpenses.id });
  mutableExpenseId = mutableExpense.id;

  const [deletableExpense] = await db.insert(s.tripExpenses).values({
    tripId,
    forwarderId: forwarderUserId,
    createdBy: forwarderUserId,
    expenseType: 'OTHER',
    buyAmount: '1200',
    sellAmount: '0',
    note: 'q23 deletable expense',
  }).returning({ id: s.tripExpenses.id });
  deletableExpenseId = deletableExpense.id;

  const [approvedAdvanceRequest] = await db.insert(s.advanceRequests).values({
    requesterId: forwarderUserId,
    amount: '1000',
    reason: `Q23 approved advance ${suffix}`,
    status: 'APPROVED',
  }).returning({ id: s.advanceRequests.id });
  approvedAdvanceRequestId = approvedAdvanceRequest.id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      userId: forwarderUserId,
      username: `q23-forwarder-durable-${suffix}`,
      email: null,
      fullName: null,
      role: Role.FORWARDER,
    };
    next();
  });
  app.use(auditLogMiddleware);
  app.use('/api/forwarder/me', forwarderRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

describe('Q23 forwarder durable material routes', () => {
  test('rolls back container create when atomic audit insert fails', async () => {
    const beforeCount = (await db.select({ id: s.tripContainers.id }).from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, tripId))).length;
    setAuditPersistHandlerForTest(async () => {
      throw new Error('simulated audit insert failure');
    });

    const response = await api('POST', `/api/forwarder/me/trips/${tripId}/containers`, {
      idempotencyKey: `q23-forwarder-container-audit-fail-${suffix}`,
      body: { containerNumber: 'Q23CONT001' },
    });

    assert.equal(response.status, 500, JSON.stringify(response.body));
    const afterCount = (await db.select({ id: s.tripContainers.id }).from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, tripId))).length;
    assert.equal(afterCount, beforeCount);
    const rows = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, `q23-forwarder-container-audit-fail-${suffix}`));
    assert.equal(rows.length, 0);
  });

  test('rolls back expense create when atomic audit insert fails', async () => {
    const beforeCount = (await db.select({ id: s.tripExpenses.id }).from(s.tripExpenses)
      .where(eq(s.tripExpenses.tripId, tripId))).length;
    setAuditPersistHandlerForTest(async () => {
      throw new Error('simulated audit insert failure');
    });

    const response = await api('POST', '/api/forwarder/me/expenses', {
      idempotencyKey: `q23-forwarder-expense-create-audit-fail-${suffix}`,
      body: {
        tripId,
        expenseType: 'OTHER',
        buyAmount: 1500,
        sellAmount: 0,
        note: 'rollback-create',
      },
    });

    assert.equal(response.status, 500, JSON.stringify(response.body));
    const afterCount = (await db.select({ id: s.tripExpenses.id }).from(s.tripExpenses)
      .where(eq(s.tripExpenses.tripId, tripId))).length;
    assert.equal(afterCount, beforeCount);
    const rows = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, `q23-forwarder-expense-create-audit-fail-${suffix}`));
    assert.equal(rows.length, 0);
  });

  test('rolls back expense update when atomic audit insert fails', async () => {
    const [before] = await db.select({
      note: s.tripExpenses.note,
      updatedAt: s.tripExpenses.updatedAt,
    }).from(s.tripExpenses).where(eq(s.tripExpenses.id, mutableExpenseId));
    setAuditPersistHandlerForTest(async () => {
      throw new Error('simulated audit insert failure');
    });

    const response = await api('PATCH', `/api/forwarder/me/expenses/${mutableExpenseId}`, {
      idempotencyKey: `q23-forwarder-expense-update-audit-fail-${suffix}`,
      expectedUpdatedAt: before.updatedAt.toISOString(),
      body: { note: 'should-not-stick' },
    });

    assert.equal(response.status, 500, JSON.stringify(response.body));
    const [after] = await db.select({
      note: s.tripExpenses.note,
    }).from(s.tripExpenses).where(eq(s.tripExpenses.id, mutableExpenseId));
    assert.equal(after.note, before.note);
    const rows = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, `q23-forwarder-expense-update-audit-fail-${suffix}`));
    assert.equal(rows.length, 0);
  });

  test('rolls back expense delete when atomic audit insert fails', async () => {
    const [before] = await db.select({
      updatedAt: s.tripExpenses.updatedAt,
    }).from(s.tripExpenses).where(eq(s.tripExpenses.id, deletableExpenseId));
    setAuditPersistHandlerForTest(async () => {
      throw new Error('simulated audit insert failure');
    });

    const response = await api('DELETE', `/api/forwarder/me/expenses/${deletableExpenseId}`, {
      idempotencyKey: `q23-forwarder-expense-delete-audit-fail-${suffix}`,
      expectedUpdatedAt: before.updatedAt.toISOString(),
    });

    assert.equal(response.status, 500, JSON.stringify(response.body));
    const rowsAfter = await db.select({ id: s.tripExpenses.id }).from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, deletableExpenseId));
    assert.equal(rowsAfter.length, 1);
    const idemRows = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, `q23-forwarder-expense-delete-audit-fail-${suffix}`));
    assert.equal(idemRows.length, 0);
  });

  test('rolls back advance request create when atomic audit insert fails', async () => {
    const beforeCount = (await db.select({ id: s.advanceRequests.id }).from(s.advanceRequests)
      .where(eq(s.advanceRequests.requesterId, forwarderUserId))).length;
    setAuditPersistHandlerForTest(async () => {
      throw new Error('simulated audit insert failure');
    });

    const response = await api('POST', '/api/forwarder/me/advance-requests', {
      idempotencyKey: `q23-forwarder-advance-request-audit-fail-${suffix}`,
      body: { amount: 1000, reason: 'rollback advance request' },
    });

    assert.equal(response.status, 500, JSON.stringify(response.body));
    const afterCount = (await db.select({ id: s.advanceRequests.id }).from(s.advanceRequests)
      .where(eq(s.advanceRequests.requesterId, forwarderUserId))).length;
    assert.equal(afterCount, beforeCount);
    const rows = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, `q23-forwarder-advance-request-audit-fail-${suffix}`));
    assert.equal(rows.length, 0);
  });

  test('rolls back advance settlement create when atomic audit insert fails', async () => {
    const beforeCount = (await db.select({ id: s.advanceSettlements.id }).from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.forwarderId, forwarderUserId))).length;
    setAuditPersistHandlerForTest(async () => {
      throw new Error('simulated audit insert failure');
    });

    const response = await api('POST', '/api/forwarder/me/advance-settlements', {
      idempotencyKey: `q23-forwarder-advance-settlement-audit-fail-${suffix}`,
      body: {
        advanceRequestIds: [approvedAdvanceRequestId],
        refundAmount: 1000,
        note: 'rollback settlement',
      },
    });

    assert.equal(response.status, 500, JSON.stringify(response.body));
    const afterCount = (await db.select({ id: s.advanceSettlements.id }).from(s.advanceSettlements)
      .where(eq(s.advanceSettlements.forwarderId, forwarderUserId))).length;
    assert.equal(afterCount, beforeCount);
    const linkRows = await db.select({ id: s.advanceSettlementRequests.advanceRequestId })
      .from(s.advanceSettlementRequests)
      .where(eq(s.advanceSettlementRequests.advanceRequestId, approvedAdvanceRequestId));
    assert.equal(linkRows.length, 0);
    const idemRows = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, `q23-forwarder-advance-settlement-audit-fail-${suffix}`));
    assert.equal(idemRows.length, 0);
  });
});

after(async () => {
  setAuditEnrichmentHandlerForTest(null);
  setAuditPersistHandlerForTest(null);
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
  }
  await db.delete(s.auditLogs).where(eq(s.auditLogs.userId, forwarderUserId));
  await db.delete(s.advanceSettlementRequests)
    .where(eq(s.advanceSettlementRequests.advanceRequestId, approvedAdvanceRequestId));
  await db.delete(s.advanceSettlements).where(eq(s.advanceSettlements.forwarderId, forwarderUserId));
  await db.delete(s.advanceRequests).where(eq(s.advanceRequests.requesterId, forwarderUserId));
  await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, tripId));
  await db.delete(s.tripExpenses).where(eq(s.tripExpenses.tripId, tripId));
  await db.delete(s.tripContainers).where(eq(s.tripContainers.tripId, tripId));
  await db.delete(s.trips).where(eq(s.trips.id, tripId));
  await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
  await db.delete(s.routes).where(eq(s.routes.id, routeId));
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await db.delete(s.users).where(eq(s.users.id, forwarderUserId));
  await disconnectRedis();
  await client.end();
});
