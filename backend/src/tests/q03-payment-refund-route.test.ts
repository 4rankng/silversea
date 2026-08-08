import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';

import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { disconnectRedis } from '../lib/redis';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import financialRoutes from '../routes/financial';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];
const receiptIds: number[] = [];
const governanceActionIds: number[] = [];
const userIds: number[] = [];
let customerId = 0;
let makerId = 0;
const tokens = new Map<Role, string>();
let server: http.Server;
let baseUrl = '';

async function request(
  paymentReceiptId: number,
  body: unknown,
  idempotencyKey?: string,
  token = tokens.get(Role.ACCOUNTANT),
) {
  if (idempotencyKey) idempotencyKeys.push(idempotencyKey);
  const response = await fetch(`${baseUrl}/api/payments/receipts/${paymentReceiptId}/refunds`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function createReceipt(tag: string) {
  const [receipt] = await db.insert(s.paymentReceipts).values({
    receiptId: `Q03-ROUTE-${tag}-${suffix}`.slice(0, 100),
    customerId,
    receivedAmount: '5000000',
    allocatedTotal: '0',
    unappliedAmount: '5000000',
    refundedAmount: '0',
    allocationMethod: 'OLDEST_DUE',
    requestHash: tag.padEnd(64, '0').slice(0, 64),
    createdBy: makerId,
    version: 1,
  }).returning();
  receiptIds.push(receipt.id);
  return receipt;
}

before(async () => {
  await initEnforcer();
  const roles = [
    Role.ADMIN,
    Role.MANAGER,
    Role.ACCOUNTANT,
    Role.DRIVER,
    Role.OPS,
    Role.CUSTOMER,
    Role.CUS,
  ];
  const users = await db.insert(s.users).values(roles.map((role) => ({
      username: `q03-route-${role.toLowerCase()}-${suffix}`,
      passwordHash: 'x',
      role,
      status: 'ACTIVE',
    }))).returning();
  userIds.push(...users.map((user) => user.id));
  for (const user of users) {
    const role = user.role as Role;
    tokens.set(role, jwt.sign({
      userId: user.id,
      username: user.username,
      role,
    }, config.jwtSecret));
  }
  makerId = users.find((user) => user.role === Role.ACCOUNTANT)!.id;
  const [customer] = await db.insert(s.customers).values({
    name: `Q03 route customer ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  customerId = customer.id;

  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('financial'), financialRoutes);
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
  if (receiptIds.length > 0) {
    const actions = await db.select({ id: s.governanceActions.id })
      .from(s.governanceActions)
      .where(inArray(s.governanceActions.subjectId, receiptIds));
    governanceActionIds.push(...actions.map((row) => row.id));
  }
  if (governanceActionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, governanceActionIds));
  }
  if (receiptIds.length > 0) {
    await db.delete(s.paymentReceipts).where(inArray(s.paymentReceipts.id, receiptIds));
  }
  const uniqueKeys = [...new Set(idempotencyKeys)];
  if (uniqueKeys.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, uniqueKeys));
  }
  if (customerId > 0) await db.delete(s.customers).where(eq(s.customers.id, customerId));
  if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  await disconnectRedis();
  await client.end();
});

test('Q03 refund HTTP boundary enforces RBAC, validation, replay, conflict, and one active request', async () => {
  const receipt = await createReceipt('main');
  const key = `q03-route-main-${suffix}`;
  const payload = { amount: 1_000_000, reason: 'Hoàn khoản khách chuyển thừa' };
  const created = await request(receipt.id, payload, key);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.replayed, false);
  const replayed = await request(receipt.id, payload, key);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.id, created.body.id);
  assert.equal(replayed.body.replayed, true);
  const changedPayload = await request(
    receipt.id,
    { ...payload, amount: 2_000_000 },
    key,
  );
  assert.equal(changedPayload.status, 409);

  for (const role of [Role.ADMIN, Role.MANAGER]) {
    const allowedReceipt = await createReceipt(`allowed-${role.toLowerCase()}`);
    const allowed = await request(
      allowedReceipt.id,
      payload,
      `q03-route-allowed-${role.toLowerCase()}-${suffix}`,
      tokens.get(role),
    );
    assert.equal(allowed.status, 201, `${role}: ${JSON.stringify(allowed.body)}`);
  }

  const malformedReceipt = await createReceipt('malformed');
  const malformed = await request(
    malformedReceipt.id,
    { amount: 0, reason: '' },
    `q03-route-malformed-${suffix}`,
  );
  assert.equal(malformed.status, 400);

  for (const role of [Role.DRIVER, Role.OPS, Role.CUSTOMER, Role.CUS]) {
    const deniedReceipt = await createReceipt(`denied-${role.toLowerCase()}`);
    const denied = await request(
      deniedReceipt.id,
      payload,
      `q03-route-denied-${role.toLowerCase()}-${suffix}`,
      tokens.get(role),
    );
    assert.equal(denied.status, 403, role);
  }

  const raceReceipt = await createReceipt('race');
  const race = await Promise.all([
    request(raceReceipt.id, payload, `q03-route-race-a-${suffix}`),
    request(raceReceipt.id, payload, `q03-route-race-b-${suffix}`),
  ]);
  assert.deepEqual(race.map((result) => result.status).sort(), [201, 409]);
});
