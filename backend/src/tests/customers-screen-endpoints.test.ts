import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import configRoutes from '../routes/config';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';

const suffix = `cust-screen-${Date.now()}`;
const customerIds: number[] = [];
const userIds: number[] = [];
const shipmentIds: number[] = [];
const ledgerIds: number[] = [];
let server: http.Server;
let baseUrl: string;
let targetId: number;
let otherId: number;
let tombstonedId: number;
let adminToken: string;
let managerToken: string;
let dispatcherToken: string;
let customerRoleToken: string;
let cskhToken: string;

async function request(
  path: string,
  init: { method?: string; token?: string; idempotencyKey?: string; body?: unknown } = {},
) {
  const url = new URL(path.startsWith('/api') ? path : `/api${path}`, baseUrl);
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  const payload = init.body === undefined ? '' : JSON.stringify(init.body);
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload).toString();
  }
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: init.method ?? 'GET',
      agent: false,
      headers: { ...headers, Connection: 'close' },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({ status: response.statusCode ?? 0, body: raw.length ? JSON.parse(raw.toString("utf8")) : {} });
      });
    });
    req.on('error', reject);
    if (init.body !== undefined) req.write(payload);
    req.end();
  });
}

before(async () => {
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const [target, other, tombstoned] = await db.insert(s.customers).values([
    { name: `Screen target ${suffix}` },
    { name: `Screen other ${suffix}` },
    { name: `Screen tomb ${suffix}`, deletedAt: new Date() },
  ]).returning();
  targetId = target.id;
  otherId = other.id;
  tombstonedId = tombstoned.id;
  customerIds.push(targetId, otherId, tombstonedId);

  const hash = await bcrypt.hash('admin123', 10);
  const users = await db.insert(s.users).values([
    { username: `cust-admin-${suffix}`, passwordHash: hash, role: 'ADMIN' as const },
    { username: `cust-mgr-${suffix}`, passwordHash: hash, role: 'MANAGER' as const },
    { username: `cust-disp-${suffix}`, passwordHash: hash, role: 'DISPATCHER' as const },
    { username: `cust-cus-${suffix}`, passwordHash: hash, role: 'CUS' as const },
    { username: `cust-cust-${suffix}`, passwordHash: hash, role: 'CUSTOMER' as const, customerId: targetId },
    { username: `cust-cust-locked-${suffix}`, passwordHash: hash, role: 'CUSTOMER' as const, customerId: targetId, status: 'LOCKED' },
  ]).returning();
  userIds.push(...users.map((u) => u.id));
  const mint = (userId: number, username: string, role: string, customerId?: number) => jwt.sign(
    { userId, username, role, customerId: customerId ?? undefined },
    config.jwtSecret,
  );
  adminToken = mint(users[0].id, users[0].username!, users[0].role);
  managerToken = mint(users[1].id, users[1].username!, users[1].role);
  dispatcherToken = mint(users[2].id, users[2].username!, users[2].role);
  cskhToken = mint(users[3].id, users[3].username!, users[3].role);
  customerRoleToken = mint(users[4].id, users[4].username!, users[4].role, targetId);

  const shipments = await db.insert(s.shipments).values([
    { customerId: targetId, blNumber: `BL-A-${suffix}`, status: 'PENDING_DATE' as const },
    { customerId: targetId, blNumber: `BL-B-${suffix}`, status: 'PENDING_DATE' as const },
    { customerId: targetId, blNumber: `BL-C-${suffix}`, status: 'COMPLETED' as const },
    { customerId: otherId, blNumber: `BL-D-${suffix}`, status: 'PENDING_DATE' as const },
  ]).returning();
  shipmentIds.push(...shipments.map((r) => r.id));

  const ledgerRows = await db.insert(s.ledger).values([
    { txnType: 'TRIP_REVENUE' as const, entityType: 'CUSTOMER', entityId: targetId, debit: '2000000', credit: '0', balance: '2000000' },
    { txnType: 'PAYMENT_RECEIVED' as const, entityType: 'CUSTOMER', entityId: targetId, debit: '0', credit: '500000', balance: '1500000' },
  ]).returning();
  ledgerIds.push(...ledgerRows.map((r) => r.id));
});

after(async () => {
  if (ledgerIds.length) await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
  if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  await db.delete(s.notifications).where(inArray(s.notifications.userId, userIds));
  await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, userIds));
  if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  server.close();
  await disconnectRedis();
  await client.end();
});

describe('customers screen drawer history endpoints', () => {
  test('logistics-history returns only that customer shipments newest-first with total', async () => {
    const res = await request(`/api/customers/${targetId}/logistics-history`, { token: adminToken });
    assert.equal(res.status, 200);
    const body = res.body as {
      items: Array<{ id: number; blNumber: string | null; status: string; createdAt: string }>;
      total: number;
      limit: number;
    };
    assert.equal(body.items.length, 3);
    assert.equal(body.total, 3);
    assert.equal(body.limit, 20);
    const bls = body.items.map((item) => item.blNumber);
    assert.ok(bls.includes(`BL-A-${suffix}`));
    assert.ok(bls.includes(`BL-B-${suffix}`));
    assert.ok(bls.includes(`BL-C-${suffix}`));
    assert.ok(!bls.some((bl) => bl?.includes('BL-D')), 'must not leak other customers shipments');
    const times = body.items.map((item) => new Date(item.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  });

  test('logistics-history honors limit and keeps total', async () => {
    const res = await request(`/api/customers/${targetId}/logistics-history?limit=2`, { token: adminToken });
    assert.equal(res.status, 200);
    const body = res.body as { items: unknown[]; total: number; limit: number };
    assert.equal(body.items.length, 2);
    assert.equal(body.total, 3);
    assert.equal(body.limit, 2);
  });

  test('history endpoints 404 on unknown and tombstoned customers', async () => {
    const unknown = await request('/api/customers/99999999/logistics-history', { token: adminToken });
    const tomb = await request(`/api/customers/${tombstonedId}/logistics-history`, { token: adminToken });
    assert.equal(unknown.status, 404);
    assert.equal(tomb.status, 404);
    const payUnknown = await request('/api/customers/99999999/payment-history', { token: adminToken });
    const payTomb = await request(`/api/customers/${tombstonedId}/payment-history`, { token: adminToken });
    assert.equal(payUnknown.status, 404);
    assert.equal(payTomb.status, 404);
  });

  test('drawer endpoints deny non-screen roles', async () => {
    for (const token of [dispatcherToken, customerRoleToken, cskhToken]) {
      const logistics = await request(`/api/customers/${targetId}/logistics-history`, { token });
      assert.equal(logistics.status, 403);
      const payment = await request(`/api/customers/${targetId}/payment-history`, { token });
      assert.equal(payment.status, 403);
    }
  });

  test('payment-history returns entries with numeric totals and outstanding', async () => {
    const res = await request(`/api/customers/${targetId}/payment-history`, { token: adminToken });
    assert.equal(res.status, 200);
    const body = res.body as {
      items: Array<{ id: number; txnType: string; credit: string; debit: string; balance: string }>;
      total: number;
      totals: { credit: number; debit: number };
      outstanding: number;
    };
    assert.equal(body.items.length, 2);
    assert.equal(body.total, 2);
    assert.equal(body.totals.credit, 500000);
    assert.equal(body.totals.debit, 2000000);
    assert.equal(typeof body.outstanding, 'number');
    const types = body.items.map((item) => item.txnType);
    assert.ok(types.includes('TRIP_REVENUE'));
    assert.ok(types.includes('PAYMENT_RECEIVED'));
  });

  test('CRUD fall-through intact: GET /api/customers/:id still serves the catalog row', async () => {
    const res = await request(`/api/customers/${targetId}`, { token: adminToken });
    assert.equal(res.status, 200);
    const body = res.body as { id: number; name: string };
    assert.equal(body.id, targetId);
    assert.ok(body.name.includes('Screen target'));
  });
});

describe('customers screen bulk notify', () => {
  const payload = (ids: number[]) => ({ customerIds: ids, title: `Cảnh báo thử ${suffix}`, message: `Nội dung thử ${suffix}` });

  test('requires Idempotency-Key on a declared material write', async () => {
    const res = await request('/api/customers/bulk-notify', { method: 'POST', token: adminToken, body: payload([targetId]) });
    assert.equal(res.status, 400);
  });

  test('notifies ACTIVE linked customer users only, with counts', async () => {
    const key = `notify-${suffix}`;
    const res = await request('/api/customers/bulk-notify', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: key,
      body: payload([targetId, otherId, tombstonedId]),
    });
    assert.equal(res.status, 200);
    const body = res.body as { requested: number; matchedCustomers: number; notified: number };
    assert.equal(body.requested, 3);
    assert.equal(body.matchedCustomers, 2);
    assert.equal(body.notified, 1, 'only the ACTIVE linked CUSTOMER user gets a row');
    const [row] = await db.select({ id: s.notifications.id }).from(s.notifications)
      .where(eq(s.notifications.userId, userIds[4]));
    assert.ok(row, 'notification row exists for the linked user');
  });

  test('replay with same key does not duplicate notifications', async () => {
    const key = `notify-${suffix}`;
    const res = await request('/api/customers/bulk-notify', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: key,
      body: payload([targetId, otherId, tombstonedId]),
    });
    assert.equal(res.status, 200);
    const rows = await db.select({ id: s.notifications.id }).from(s.notifications)
      .where(eq(s.notifications.userId, userIds[4]));
    assert.equal(rows.length, 1, 'exactly one notification row after replay');
  });

  test('denies non-screen roles and rejects invalid payloads', async () => {
    for (const token of [dispatcherToken, customerRoleToken, cskhToken]) {
      const denied = await request('/api/customers/bulk-notify', {
        method: 'POST', token, idempotencyKey: `x-${suffix}`, body: payload([targetId]),
      });
      assert.equal(denied.status, 403);
    }
    const empty = await request('/api/customers/bulk-notify', {
      method: 'POST', token: adminToken, idempotencyKey: `e-${suffix}`, body: { customerIds: [], title: 't', message: 'm' },
    });
    assert.equal(empty.status, 400);
    const oversized = await request('/api/customers/bulk-notify', {
      method: 'POST', token: adminToken, idempotencyKey: `o-${suffix}`, body: { customerIds: Array.from({ length: 501 }, (_, i) => i + 1), title: 't', message: 'm' },
    });
    assert.equal(oversized.status, 400);
  });
});
