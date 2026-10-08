import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { globalErrorHandler } from '../middleware/errorHandler';
import opsRoutes from '../routes/ops';

// Card 071026210510 — the expense dialog's open-time write-scope probe must
// answer from the SAME grant the save enforces: a granted ops reads writable,
// an unassigned ops reads the exact save-time refusal, and a malformed query
// is a 4xx — never a fake verdict.

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
function track(table: any, id: number) {
  cleanup.unshift({ table, id });
}
let server: http.Server;

async function api(path: string, userId: number) {
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method: 'GET',
    headers: { 'X-Test-User-Id': String(userId) },
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}

async function mkOpsUser() {
  const [user] = await db.insert(s.users).values({
    username: `c210510-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.OPS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  return user.id;
}

async function mkLinkedLot(userId: number) {
  const [customer] = await db.insert(s.customers).values({ name: `C210510 customer ${suffix}-${cleanup.length}` }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `C210510 route ${suffix}-${cleanup.length}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [link] = await db.insert(s.userShipmentLinks).values({ userId, shipmentId: shipment.id }).returning({ id: s.userShipmentLinks.id });
  track(s.userShipmentLinks, link.id);
  return shipment.id;
}

before(async () => {
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.header('X-Test-User-Id');
    if (header) (req as express.Request & { user?: unknown }).user = {
      userId: Number(header),
      username: 'test', email: 'test@x', fullName: 'test', role: Role.OPS,
    };
    next();
  });
  app.use('/api/ops', opsRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    for (const { table, id } of cleanup) {
      await db.delete(table).where(eq(table.id, id));
    }
  } catch {
    // red-phase tolerance
  }
  await disconnectRedis();
});

describe('card 071026210510 — ops expense write-scope probe', () => {
  test('a granted ops reads writable:true from the same grant the save enforces', async () => {
    const granted = await mkOpsUser();
    const shipmentId = await mkLinkedLot(granted);
    const verdict = await api(`/api/ops/expenses/write-scope?shipmentId=${shipmentId}`, granted);
    assert.equal(verdict.status, 200, JSON.stringify(verdict.body).slice(0, 200));
    assert.deepEqual(verdict.body, { writable: true, reason: null });
  });

  test('an unassigned ops reads the exact save-time refusal, before any input is wasted', async () => {
    const unassigned = await mkOpsUser();
    const granted = await mkOpsUser();
    const shipmentId = await mkLinkedLot(granted);
    const verdict = await api(`/api/ops/expenses/write-scope?shipmentId=${shipmentId}`, unassigned);
    assert.equal(verdict.status, 200);
    assert.equal(verdict.body.writable, false);
    assert.equal(verdict.body.reason, 'Lô này không thuộc xe bạn phụ trách. Liên hệ Quản trị viên để được gán xe.');
  });

  test('a malformed shipmentId is a 4xx, never a verdict', async () => {
    const user = await mkOpsUser();
    const verdict = await api('/api/ops/expenses/write-scope?shipmentId=abc', user);
    assert.ok(verdict.status >= 400 && verdict.status < 500, `status ${verdict.status}`);
  });
});
