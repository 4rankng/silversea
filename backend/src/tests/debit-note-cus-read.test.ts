// Card 20260918_19 AC #4: the issuing CUS must read + export the debit note
// it issued. The finance mount (casbinAuthz('financial')) has no CUS row in
// policy.csv, so GET detail and GET export?format=html 403 the CUS at the
// mount before the routes' requireRoles ever runs — QA cut L (2026-09-19)
// proved it against staging. Red-first repro for the route-scoped casbin
// allowance in middleware/casbin.ts.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import shipmentRoutes from '../routes/shipments';
import financialRoutes from '../routes/financial';

const suffix = `${Date.now()}-cusread-${Math.random().toString(36).slice(2, 8)}`;
const shipmentIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const docIds: number[] = [];
const userIds: number[] = [];
let cusId = 0;
let dispatcherId = 0;
let server: http.Server;
let baseUrl = '';

async function api(method: string, path: string, actorId: number, body?: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `dnread-${suffix}-${Math.random()}`, 'X-Test-User-Id': String(actorId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { parsed = { raw: text.slice(0, 120) }; }
  return { status: response.status, body: parsed };
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `dnread-${role.toLowerCase()}-${suffix}-${userIds.length}`,
    passwordHash: 'test-only', role, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  userIds.push(user.id);
  return user.id;
}

async function mkLockedLot() {
  const [customer] = await db.insert(s.customers).values({ name: `dnread cust ${suffix}-${customerIds.length}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `dnread route ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({ customerId: customer.id, routeId: route.id }).returning({ id: s.shipments.id });
  shipmentIds.push(shipment.id);
  return shipment;
}

async function lockLot(shipmentId: number) {
  const lock = await api('POST', `/api/shipments/${shipmentId}/lock`, cusId, {});
  assert.equal(lock.status, 201, JSON.stringify(lock.body));
  return lock;
}

async function issueNote(shipmentId: number): Promise<number> {
  await lockLot(shipmentId);
  const issue = await api('POST', `/api/shipments/${shipmentId}/debit-note`, cusId, {});
  assert.equal(issue.status, 201, JSON.stringify(issue.body));
  const docId = Number(issue.body.id);
  docIds.push(docId);
  return docId;
}

before(async () => {
  await initEnforcer();
  cusId = await mkUser(Role.CUS);
  dispatcherId = await mkUser(Role.DISPATCHER);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.header('X-Test-User-Id');
    if (header) (req as express.Request & { user?: unknown }).user = {
      userId: Number(header),
      username: 'test', email: 'test@x', fullName: 'test',
      role: ([
        [cusId, Role.CUS], [dispatcherId, Role.DISPATCHER],
      ] as Array<[number, Role]>).find(([id]) => id === Number(header))?.[1] as Role,
    };
    next();
  });
  app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
  app.use('/api', casbinAuthz('financial'), financialRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, docIds));
    await db.delete(s.debitNoteLots).where(inArray(s.debitNoteLots.shipmentId, shipmentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, docIds));
    await db.delete(s.shipmentCostLocks).where(inArray(s.shipmentCostLocks.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

describe('20260918_19 AC #4 — CUS reads + exports the issued Debit Note (finance mount)', () => {
  test('CUS GET /finance/billing-documents/:id returns the issued note (was 403 at the casbin mount)', async () => {
    const shipment = await mkLockedLot();
    const docId = await issueNote(shipment.id);
    const res = await api('GET', `/api/finance/billing-documents/${docId}`, cusId);
    assert.equal(res.status, 200, `the issuing CUS must read the note — got ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.id, docId);
    assert.equal(res.body.type, 'DEBIT_NOTE');
  });

  test('CUS GET /finance/billing-documents/:id/export?format=html returns the printable HTML (was 403 at the casbin mount)', async () => {
    const shipment = await mkLockedLot();
    const docId = await issueNote(shipment.id);
    const response = await fetch(`${baseUrl}/api/finance/billing-documents/${docId}/export?format=html`, {
      headers: { 'X-Test-User-Id': String(cusId) },
    });
    assert.equal(response.status, 200, `the issuing CUS must export the note — got ${response.status}`);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    assert.ok(html.length > 100, 'a real HTML document comes back');
  });

  test('CUS GET /finance/billing-documents (list) stays 403 — no CUS in the list ROLES', async () => {
    const shipment = await mkLockedLot();
    await issueNote(shipment.id);
    const res = await api('GET', '/api/finance/billing-documents', cusId);
    assert.equal(res.status, 403, `the list stays staff-only — got ${res.status}`);
  });

  test('DISPATCHER GET detail + export stays 403', async () => {
    const shipment = await mkLockedLot();
    const docId = await issueNote(shipment.id);
    const detail = await api('GET', `/api/finance/billing-documents/${docId}`, dispatcherId);
    assert.equal(detail.status, 403);
    const exportRes = await api('GET', `/api/finance/billing-documents/${docId}/export?format=html`, dispatcherId);
    assert.equal(exportRes.status, 403);
  });
});
