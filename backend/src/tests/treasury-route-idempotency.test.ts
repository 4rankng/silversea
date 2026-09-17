import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';

import { Role, TxnType } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { config } from '../config';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import financialRoutes from '../routes/financial';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];
const actionIds: number[] = [];
let userId = 0;
let accountId = 0;
let movementId = 0;
let ledgerId = 0;
let token = '';
let server: http.Server;
let baseUrl = '';

async function post(path: string, body: unknown, idempotencyKey?: string) {
  if (idempotencyKey) idempotencyKeys.push(idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(15_000),
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json() as Record<string, unknown>;
  if (typeof responseBody.id === 'number') actionIds.push(responseBody.id);
  return { status: response.status, body: responseBody };
}

before(async () => {
  await initEnforcer();
  const [user] = await db.insert(s.users).values({
    username: `treasury-route-admin-${suffix}`,
    passwordHash: 'x',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  userId = user.id;
  token = jwt.sign({ userId, username: user.username, role: user.role }, config.jwtSecret);

  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `ROUTE-${suffix}`.slice(0, 50),
    name: `Treasury route ${suffix}`,
    type: 'BANK',
    currency: 'VND',
    openingBalance: '0',
    openingBalanceDate: '2026-07-31',
    status: 'ACTIVE',
    createdBy: user.id,
    updatedBy: user.id,
  }).returning();
  accountId = account.id;
  const [ledger] = await db.insert(s.ledger).values({
    entityType: 'COMPANY',
    entityId: 0,
    txnType: TxnType.ADJUSTMENT,
    txnId: account.id,
    debit: '0',
    credit: '100',
    balance: '100',
    note: 'Treasury route reversal source',
  }).returning();
  ledgerId = ledger.id;
  const [movement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: account.id,
    direction: 'IN',
    amount: '100',
    valueDate: '2026-07-31',
    ledgerEntryId: ledger.id,
    sourceVersion: 1,
    paymentContractVersion: 2,
    physicalReference: `ROUTE-MOVEMENT-${suffix}`.slice(0, 160),
    createdBy: user.id,
  }).returning();
  movementId = movement.id;

  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('financial'), financialRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (movementId > 0) await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.id, movementId));
  if (accountId > 0) await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, accountId));
  if (ledgerId > 0) await db.delete(s.ledger).where(eq(s.ledger.id, ledgerId));
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
  }
  if (userId > 0) await db.delete(s.users).where(eq(s.users.id, userId));
  await disconnectRedis();
  await client.end();
});

test('treasury setup/cutover/reversal routes require keyed, versioned idempotent commands', async () => {
  const setupBody = {
    code: `NEW-${suffix}`.slice(0, 50),
    name: `New treasury ${suffix}`,
    type: 'BANK',
    openingBalance: 0,
    openingBalanceDate: '2026-07-31',
    reason: 'Thiết lập tài khoản kho quỹ',
    openingBalanceEvidence: `opening-${suffix}`,
  };
  assert.equal((await post('/api/finance/treasury/accounts/setup', setupBody)).status, 400);

  const setupKey = `treasury-setup-${suffix}`;
  const concurrent = await Promise.all([
    post('/api/finance/treasury/accounts/setup', setupBody, setupKey),
    post('/api/finance/treasury/accounts/setup', setupBody, setupKey),
  ]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 202]);
  assert.equal(concurrent[0].body.id, concurrent[1].body.id);
  assert.deepEqual(
    concurrent.map(result => result.body.replayed).sort(),
    [false, true],
  );
  const setupDrift = await post(
    '/api/finance/treasury/accounts/setup',
    { ...setupBody, openingBalance: 1 },
    setupKey,
  );
  assert.equal(setupDrift.status, 409);

  const distinctKeyBody = {
    ...setupBody,
    code: `RACE-${suffix}`.slice(0, 50),
  };
  const distinctKeyRace = await Promise.all([
    post('/api/finance/treasury/accounts/setup', distinctKeyBody, `treasury-setup-race-a-${suffix}`),
    post('/api/finance/treasury/accounts/setup', distinctKeyBody, `treasury-setup-race-b-${suffix}`),
  ]);
  assert.deepEqual(distinctKeyRace.map(result => result.status).sort(), [202, 409]);

  const cutoverPath = `/api/finance/treasury/accounts/${accountId}/cutover`;
  const cutoverBase = {
    cutoverAt: '2026-08-01T00:00:00.000Z',
    reason: 'Chuyển đổi tài khoản kho quỹ',
    cutoverEvidence: `cutover-${suffix}`,
  };
  assert.equal((await post(cutoverPath, { ...cutoverBase }, `cutover-invalid-${suffix}`)).status, 400);
  assert.equal((await post(cutoverPath, { ...cutoverBase, expectedVersion: 1 })).status, 400);
  const cutoverKey = `treasury-cutover-${suffix}`;
  const cutover = await post(cutoverPath, { ...cutoverBase, expectedVersion: 1 }, cutoverKey);
  assert.equal(cutover.status, 202);
  const cutoverReplay = await post(cutoverPath, { ...cutoverBase, expectedVersion: 1 }, cutoverKey);
  assert.equal(cutoverReplay.status, 200);
  assert.equal(cutoverReplay.body.id, cutover.body.id);
  assert.equal((await post(
    cutoverPath,
    { ...cutoverBase, expectedVersion: 1, reason: 'Nội dung thay đổi' },
    cutoverKey,
  )).status, 409);

  const reversalPath = `/api/finance/treasury/movements/${movementId}/reversal`;
  const reversalBase = {
    reason: 'Đảo giao dịch kho quỹ',
    reversalEvidence: `reversal-${suffix}`,
  };
  assert.equal((await post(reversalPath, { ...reversalBase }, `reversal-invalid-${suffix}`)).status, 400);
  assert.equal((await post(reversalPath, { ...reversalBase, expectedVersion: 1 })).status, 400);
  const reversalKey = `treasury-reversal-${suffix}`;
  const reversal = await post(reversalPath, { ...reversalBase, expectedVersion: 1 }, reversalKey);
  assert.equal(reversal.status, 409);
  const reversalReplay = await post(reversalPath, { ...reversalBase, expectedVersion: 1 }, reversalKey);
  assert.equal(reversalReplay.status, 409);
  assert.equal((await post(
    reversalPath,
    { ...reversalBase, expectedVersion: 1, reason: 'Nội dung thay đổi' },
    reversalKey,
  )).status, 409);
  const [unchangedMovement] = await db.select().from(s.treasuryMovements)
    .where(eq(s.treasuryMovements.id, movementId)).limit(1);
  assert.equal(unchangedMovement.status, 'POSTED');
  assert.equal(unchangedMovement.reversalOfId, null);
});
