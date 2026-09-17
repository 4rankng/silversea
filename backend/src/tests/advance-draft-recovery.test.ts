import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import routes from '../routes/financial/advance-drafts.routes';
import forwarderRoutes from '../routes/forwarder';
import { disconnectRedis } from '../lib/redis';
import { setAuditPersistHandlerForTest, setAuditEnrichmentHandlerForTest } from '../services/audit.service';

const tag = `advance-draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const users: Record<string, { id: number; role: Role; token: string }> = {};
const requestIds: number[] = [];
const settlementIds: number[] = [];
let server: http.Server;
let base: string;

before(async () => {
  await initEnforcer();
  for (const [key, role] of Object.entries({ ops: Role.OPS, other: Role.OPS, admin: Role.ADMIN, manager: Role.MANAGER, accountant: Role.ACCOUNTANT, driver: Role.DRIVER, customer: Role.CUSTOMER, cus: Role.CUS })) {
    const [actor] = await db.insert(s.users).values({ username: `${tag}-${key}`, passwordHash: 'test-only', role, status: 'ACTIVE' }).returning();
    users[key] = { id: actor.id, role, token: jwt.sign({ userId: actor.id, username: actor.username, role, email: null, fullName: key }, config.jwtSecret, { expiresIn: '1h' }) };
  }
  setAuditEnrichmentHandlerForTest(async () => undefined);
  const app = express(); app.use(express.json()); app.use(authMiddleware); app.use(auditLogMiddleware);
  // Same role/resource order as src/index.ts: OPS alias precedes office catch-all.
  app.use('/api/forwarder/me', casbinAuthz('operations_portal'), forwarderRoutes);
  app.use('/api', casbinAuthz('config'), casbinAuthz('financial'), routes);
  app.use(globalErrorHandler);
  server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
async function draft(status: 'DRAFT' | 'RECORDED' | 'VOIDED' = 'DRAFT') {
  const [row] = await db.insert(s.advanceRequests).values({ requesterId: users.ops.id, amount: '100', reason: tag, status }).returning();
  requestIds.push(row.id); return row;
}
async function call(id: number, action: string, actor = 'ops', body: Record<string, unknown> = {}, key = `${tag}-${crypto.randomUUID()}`, method = 'POST') {
  const alias = actor === 'ops' || actor === 'other' ? '/forwarder/me' : '';
  const response = await fetch(`${base}/api${alias}/advance-requests/${id}${action ? `/${action}` : ''}`, {
    method, headers: { Authorization: `Bearer ${users[actor].token}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const record = (version = 1) => ({ expectedVersion: version, amount: 150, reason: 'Đã đối chiếu số tiền', resolutionReason: 'Hoàn thiện dữ liệu cũ' });
async function state(id: number) {
  return {
    row: (await db.select().from(s.advanceRequests).where(eq(s.advanceRequests.id, id)))[0],
    entries: await db.select().from(s.ledger).where(and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, id))),
    audit: await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityType, 'advance-request-draft'), eq(s.auditLogs.entityId, id))),
  };
}

test('authorized legacy draft recording posts exactly once with actor-bound replay and immutable terminal state', async () => {
  for (const actor of ['ops', 'admin', 'manager', 'accountant']) {
    const row = await draft(); const key = `${tag}-record-${actor}`;
    const first = await call(row.id, 'record', actor, record(), key);
    assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.status, 'RECORDED'); assert.equal(first.body.version, 2);
    const saved = await state(row.id); assert.equal(saved.entries.length, 1); assert.equal(saved.entries[0].credit, '150');
    assert.equal(saved.audit.length, 1); assert.equal(saved.audit[0].payload?.before && (saved.audit[0].payload.before as {status:string}).status, 'DRAFT');
    assert.equal((saved.audit[0].payload?.after as {status:string}).status, 'RECORDED');
    const replay = await call(row.id, 'record', actor, record(), key); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
    assert.equal((await call(row.id, 'record', actor, { ...record(), amount: 151 }, key)).status, 409);
    assert.equal((await call(row.id, 'record', actor === 'ops' ? 'admin' : 'ops', record(), key)).status, 409);
    for (const action of ['record', 'void']) assert.equal((await call(row.id, action, actor, { ...record(2) })).status, 409);
    assert.deepEqual(await state(row.id), saved);
  }
});

test('legacy draft void preserves original facts without posting and cannot reopen', async () => {
  const row = await draft(); const body = { expectedVersion: 1, resolutionReason: 'Không phát sinh chi tiền' }; const key = `${tag}-void`;
  assert.equal((await call(row.id, 'void', 'ops', body, key)).status, 200);
  const saved = await state(row.id); assert.equal(saved.row?.status, 'VOIDED'); assert.equal(saved.row?.amount, '100'); assert.equal(saved.entries.length, 0); assert.equal(saved.audit.length, 1);
  assert.equal((await call(row.id, 'void', 'ops', body, key)).body.replayed, true);
  assert.equal((await call(row.id, 'record', 'admin', record(2))).status, 409);
  assert.deepEqual(await state(row.id), saved);
});

test('draft recovery denies foreign owners, forbidden roles, stale tokens, stale versions and invalid inputs', async () => {
  const row = await draft(); const before = await state(row.id);
  assert.equal((await call(row.id, 'record', 'other', record())).status, 404);
  for (const actor of ['driver', 'customer', 'cus']) assert.equal((await call(row.id, 'record', actor, record())).status, 403);
  assert.equal((await call(row.id, 'record', 'ops', record(2))).status, 409);
  for (const body of [{ ...record(), amount: 0 }, { ...record(), amount: -1 }, { ...record(), reason: ' ' }, { ...record(), resolutionReason: ' ' }, { ...record(), expectedVersion: undefined }]) assert.equal((await call(row.id, 'record', 'ops', body)).status, 400);
  assert.equal((await call(row.id, 'record', 'ops', record(), '')).status, 400);
  await db.update(s.users).set({ role: Role.DRIVER }).where(eq(s.users.id, users.ops.id));
  try { assert.equal((await call(row.id, 'record', 'ops', record())).status, 401); }
  finally { await db.update(s.users).set({ role: Role.OPS }).where(eq(s.users.id, users.ops.id)); }
  assert.deepEqual(await state(row.id), before);
});

test('draft recovery refuses pre-existing financial postings and active settlement claims', async () => {
  const row = await draft();
  await db.insert(s.ledger).values({ entityType: 'FORWARDER', entityId: users.ops.id, txnType: TxnType.OPS_ADVANCE, txnId: row.id, debit: '0', credit: '100', balance: '100', note: tag });
  const before = await state(row.id);
  for (const action of ['record', 'void']) assert.equal((await call(row.id, action, 'admin', record())).status, 409);
  assert.deepEqual(await state(row.id), before);
  const claimed = await draft();
  const [batch] = await db.insert(s.advanceSettlements).values({ code: `DR${Date.now()}`, forwarderId: users.ops.id, totalExpenseAmount: '0', status: 'DRAFT' }).returning();
  settlementIds.push(batch.id);
  await db.insert(s.advanceSettlementRequests).values({ settlementId: batch.id, advanceRequestId: claimed.id, allocatedAmount: '100' });
  for (const action of ['record', 'void']) assert.equal((await call(claimed.id, action, 'admin', record())).status, 409);
  assert.equal((await state(claimed.id)).row?.status, 'DRAFT');
});

test('audit failure rolls back draft status ledger and domain audit then the same key can retry', async () => {
  const row = await draft(); const before = await state(row.id); const key = `${tag}-audit-failure`;
  setAuditPersistHandlerForTest(async () => { throw new Error('Injected durable audit failure'); });
  try { assert.equal((await call(row.id, 'record', 'ops', record(), key)).status, 500); }
  finally { setAuditPersistHandlerForTest(null); }
  assert.deepEqual(await state(row.id), before);
  assert.equal((await call(row.id, 'record', 'ops', record(), key)).status, 200);
  assert.equal((await state(row.id)).entries.length, 1);
});

test('recorded advance generic update delete and retired review routes remain unavailable', async () => {
  const row = await draft('RECORDED'); const before = await state(row.id);
  for (const actor of ['ops', 'admin']) {
    const unavailable = actor === 'ops' ? 403 : 404; // OPS fallthrough stops at office Casbin before 404.
    for (const action of ['approve', 'reject']) assert.equal((await call(row.id, action, actor, record())).status, unavailable);
    for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal((await call(row.id, '', actor, record(), `${tag}-${crypto.randomUUID()}`, method)).status, unavailable);
  }
  assert.deepEqual(await state(row.id), before);
});

test('competing direct record and void serialize one terminal outcome without duplicate effects', async () => {
  const row = await draft();
  const outcomes = await Promise.all([call(row.id, 'record', 'ops', record()), call(row.id, 'void', 'admin', record())]);
  assert.deepEqual(outcomes.map(result => result.status).sort(), [200, 409]);
  const saved = await state(row.id);
  assert.equal(saved.audit.length, 1);
  assert.equal(saved.entries.length, saved.row?.status === 'RECORDED' ? 1 : 0);
  assert.equal(saved.row?.version, 2);
});

after(async () => {
  setAuditPersistHandlerForTest(null); setAuditEnrichmentHandlerForTest(null);
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  const actorIds = Object.values(users).map(row => row.id);
  if (settlementIds.length) { await db.delete(s.advanceSettlementRequests).where(inArray(s.advanceSettlementRequests.settlementId, settlementIds)); await db.delete(s.advanceSettlements).where(inArray(s.advanceSettlements.id, settlementIds)); }
  if (requestIds.length) { await db.delete(s.ledger).where(and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), inArray(s.ledger.txnId, requestIds))); await db.delete(s.advanceRequests).where(inArray(s.advanceRequests.id, requestIds)); }
  if (actorIds.length) { await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, actorIds)); await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, actorIds)); await db.delete(s.users).where(inArray(s.users.id, actorIds)); }
  await disconnectRedis(); await client.end();
});

test('garbage settlement ids reject with 400 instead of a NaN-query 500 (20260916_9 family)', async () => {
  for (const path of ['/advance-settlements/abc', '/advance-settlements/abc/export']) {
    const garbage = await fetch(`${base}/api/forwarder/me${path}`, { headers: { Authorization: `Bearer ${users.ops.token}` } });
    assert.equal(garbage.status, 400, `${path} must 400 on a garbage id`);
    const body = await garbage.json();
    assert.match(body.error, /không hợp lệ/);
  }
  // Control: a clean numeric miss stays a 404 (not a 400 from the new guard).
  const miss = await fetch(`${base}/api/forwarder/me/advance-settlements/999999999`, { headers: { Authorization: `Bearer ${users.ops.token}` } });
  assert.equal(miss.status, 404);
  // Control: the owner can still read a real settlement.
  const [row] = await db.select().from(s.advanceSettlements)
    .where(eq(s.advanceSettlements.forwarderId, users.ops.id)).limit(1);
  if (row) {
    const ok = await fetch(`${base}/api/forwarder/me/advance-settlements/${row.id}`, { headers: { Authorization: `Bearer ${users.ops.token}` } });
    assert.equal(ok.status, 200);
  }
});
