import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import financialRoutes from '../routes/financial/payments.routes';
import expenseRoutes from '../routes/expense-accounting';
import { disconnectRedis } from '../lib/redis';

const tag = `fund-${Date.now()}`;
const userIds: number[] = [], accountIds: number[] = [];
let server: http.Server, base: string, admin: string, accountant: string;
before(async () => {
  for (const role of [Role.ADMIN, Role.ACCOUNTANT, Role.OPS]) {
    const [user] = await db.insert(s.users).values({ username: `${tag}-${role}`, role, passwordHash: 'test-only', status: 'ACTIVE' }).returning();
    userIds.push(user.id);
    const token = jwt.sign({ userId: user.id, username: user.username, role }, config.jwtSecret, { expiresIn: '1h' });
    if (role === Role.ADMIN) admin = token; else if (role === Role.ACCOUNTANT) accountant = token;
  }
  const app = express(); app.use(express.json(), auditLogMiddleware, authMiddleware);
  app.use('/api', financialRoutes); app.use('/api/expense-accounting', expenseRoutes); app.use(globalErrorHandler);
  server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
async function request(path: string, token = admin, body?: unknown, method = 'POST', key = crypto.randomUUID()) {
  const response = await fetch(`${base}${path}`, { method: body == null ? 'GET' : method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body == null ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}

test('actual account setup, position and expense catalog preserve explicit fund independent of BANK/CASH', async () => {
  const code = `${tag}-bank-tm`;
  const input = { code, name: 'ACB company-looking name', type: 'BANK', fundCode: 'TM', openingBalance: 123000,
    openingBalanceDate: '2026-09-16', reason: 'QA account setup', openingBalanceEvidence: 'QA statement' };
  const created = await request('/finance/treasury/accounts/setup', admin, input);
  assert.equal(created.status, 202, JSON.stringify(created));
  const [account] = await db.select().from(s.treasuryAccounts).where(eq(s.treasuryAccounts.code, code.toUpperCase()));
  accountIds.push(account.id);
  assert.equal((account as { fundCode?: string }).fundCode, 'TM');
  const position = await request('/finance/treasury/position', accountant);
  assert.equal(position.body.accounts.find((row: { accountId: number }) => row.accountId === account.id).fundCode, 'TM');
  const catalog = await request('/expense-accounting/catalog', accountant);
  assert.equal(catalog.body.accounts.find((row: { id: number }) => row.id === account.id).fundCode, 'TM');
  assert.equal(catalog.body.staff.find((row: { id: number }) => row.id === userIds[1]).name, `${tag}-${Role.ACCOUNTANT}`);
  assert.equal(catalog.body.opsUsers.find((row: { id: number }) => row.id === userIds[2]).name, `${tag}-${Role.OPS}`);
  assert.equal((await request('/finance/treasury/accounts/setup', admin, { ...input, code: `${tag}-invalid`, fundCode: 'BANK' })).status, 400);
});

test('classifying an existing unknown fund is permission/version checked, replayable and creates no cash', async () => {
  const [account] = await db.insert(s.treasuryAccounts).values({ code: `${tag}-legacy`, name: 'Legacy TM', type: 'CASH', openingBalance: '987000', status: 'ACTIVE', createdBy: userIds[0], updatedBy: userIds[0] }).returning(); accountIds.push(account.id);
  const before = await request('/finance/treasury/position', accountant);
  assert.equal(before.body.accounts.find((row: { accountId: number }) => row.accountId === account.id).fundCode, null);
  const body = { expectedVersion: account.version, fundCode: 'COMPANY', reason: 'Classify confirmed account owner' };
  const path = `/finance/treasury/accounts/${account.id}/fund`;
  assert.equal((await request(path, accountant, body, 'PATCH')).status, 403);
  const key = crypto.randomUUID();
  const saved = await request(path, admin, body, 'PATCH', key); assert.equal(saved.status, 200, JSON.stringify(saved));
  const replay = await request(path, admin, body, 'PATCH', key); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal((await request(path, admin, { ...body, fundCode: 'TM' }, 'PATCH')).status, 409);
  const [updated] = await db.select().from(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, account.id));
  assert.equal((updated as { fundCode?: string }).fundCode, 'COMPANY'); assert.equal(updated.openingBalance, '987000'); assert.equal(updated.version, account.version + 1);
  assert.equal((await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, account.id))).length, 0);
  const catalog = await request('/expense-accounting/catalog', accountant);
  assert.equal(catalog.body.accounts.find((row: { id: number }) => row.id === account.id).fundCode, 'COMPANY');
});

after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (userIds.length) accountIds.push(...(await db.select({ id: s.treasuryAccounts.id }).from(s.treasuryAccounts).where(inArray(s.treasuryAccounts.createdBy, userIds))).map(row => row.id));
  if (accountIds.length) await db.delete(s.treasuryAccounts).where(inArray(s.treasuryAccounts.id, accountIds));
  if (userIds.length) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, userIds));
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, userIds));
    await db.delete(s.users).where(inArray(s.users.id, userIds));
  }
  await disconnectRedis(); await client.end();
});
