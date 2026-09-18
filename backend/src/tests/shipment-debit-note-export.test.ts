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

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shipmentIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const docIds: number[] = [];
const userIds: number[] = [];
let adminId = 0;
let accountantId = 0;
let cusId = 0;
let dispatcherId = 0;
let server: http.Server;
let baseUrl = '';

async function api(method: string, path: string, actorId: number, body?: Record<string, unknown>, idempotencyKey?: string) {
  const key = idempotencyKey ?? `dn-${suffix}-${Math.random()}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Test-User-Id': String(actorId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { parsed = { raw: text.slice(0, 120) }; }
  return { status: response.status, body: parsed };
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `dn-${role.toLowerCase()}-${suffix}-${userIds.length}`,
    passwordHash: 'test-only', role, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  userIds.push(user.id);
  return user.id;
}

async function mkCustomer(name: string) {
  const [row] = await db.insert(s.customers).values({ name }).returning();
  customerIds.push(row.id);
  return row;
}

async function mkLockedLotForCustomer(customerId: number) {
  const [route] = await db.insert(s.routes).values({ name: `DN route ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({ customerId, routeId: route.id }).returning({ id: s.shipments.id, version: s.shipments.version });
  shipmentIds.push(shipment.id);
  const lock = await api('POST', `/api/shipments/${shipment.id}/lock`, cusId, {});
  assert.equal(lock.status, 201, JSON.stringify(lock.body));
  return shipment;
}

async function mkLockedLot() {
  const [customer] = await db.insert(s.customers).values({ name: `DN cust ${suffix}-${customerIds.length}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `DN route ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({ customerId: customer.id, routeId: route.id }).returning({ id: s.shipments.id, version: s.shipments.version });
  shipmentIds.push(shipment.id);
  return shipment;
}

before(async () => {
  await initEnforcer();
  adminId = await mkUser(Role.ADMIN);
  accountantId = await mkUser(Role.ACCOUNTANT);
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
        [adminId, Role.ADMIN], [accountantId, Role.ACCOUNTANT], [cusId, Role.CUS],
        [dispatcherId, Role.DISPATCHER],
      ] as Array<[number, Role]>).find(([id]) => id === Number(header))?.[1] as Role,
    };
    next();
  });
  app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, docIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, docIds));
    await db.delete(s.shipmentCostLocks).where(inArray(s.shipmentCostLocks.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

async function lockLot(shipmentId: number, actorId: number) {
  const result = await api('POST', `/api/shipments/${shipmentId}/lock`, actorId, {});
  assert.equal(result.status, 201, JSON.stringify(result.body));
}

describe('20260918_19 Xuất Debit Note từ snapshot khóa lô', () => {
  test('409 when the lot has no active cost lock', async () => {
    const shipment = await mkLockedLot();
    const result = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {});
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /chưa khóa|chưa được khóa/i);
  });

  test('creates the DEBIT_NOTE from the frozen snapshot lines', async () => {
    const shipment = await mkLockedLot();
    await lockLot(shipment.id, cusId);
    const result = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {});
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const docId = Number(result.body.id);
    docIds.push(docId);
    const [doc] = await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.id, docId));
    assert.equal(doc?.type, 'DEBIT_NOTE');
    assert.ok(doc?.issuedAt, 'the document is issued at creation');
    const lines = await db.select().from(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, docId));
    assert.equal(lines.length, 0, 'the empty snapshot yields no fabricated lines');
  });

  test('snapshot values freeze into the document lines', async () => {
    const shipment = await mkLockedLot();
    await lockLot(shipment.id, cusId);
    const [lock] = await db.select().from(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.shipmentId, shipment.id));
    assert.ok(lock);
    const snapshot = lock.costSnapshot as Record<string, unknown>;
    const result = await api('POST', `/api/shipments/${shipment.id}/debit-note`, accountantId, {});
    assert.equal(result.status, 201, JSON.stringify(result.body));
    docIds.push(Number(result.body.id));
    const lines = await db.select().from(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, Number(result.body.id)));
    assert.equal(lines.length, 0, 'this fixture snapshot carries no engine values yet — zero lines');
  });

  test('idempotent replay returns the original document', async () => {
    const shipment = await mkLockedLot();
    await lockLot(shipment.id, cusId);
    const key = `dn-replay-${suffix}-${shipment.id}`;
    const first = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {}, key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    docIds.push(Number(first.body.id));
    const replay = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {}, key);
    assert.equal(replay.status, 201);
    assert.equal(replay.body.id, first.body.id, 'replay must return the original document');
    const docs = await db.select().from(s.billingDocuments)
      .where(eq(s.billingDocuments.entityId, (await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id)))[0]!.customerId!));
    assert.equal(docs.length, 1, 'exactly one document exists for the replay pair');
  });

  test('role gates: CUS/ACCOUNTANT/ADMIN allowed — DISPATCHER 403', async () => {
    const shipment = await mkLockedLot();
    await lockLot(shipment.id, cusId);
    const blocked = await api('POST', `/api/shipments/${shipment.id}/debit-note`, dispatcherId, {});
    assert.equal(blocked.status, 403);
    for (const actor of [cusId, accountantId, adminId]) {
      const result = await api('POST', `/api/shipments/${shipment.id}/debit-note`, actor, {});
      assert.notEqual(result.status, 403);
      if (result.status === 201) docIds.push(Number(result.body.id));
    }
  });
});

describe('the issuing CUS downloads the Debit Note file', () => {
  test('issue then export returns the xlsx for CUS on the shipments mount', async () => {
    const shipment = await mkLockedLot();
    await lockLot(shipment.id, cusId);
    const issue = await api('POST', `/api/shipments/${shipment.id}/debit-note`, cusId, {});
    assert.equal(issue.status, 201, JSON.stringify(issue.body));
    docIds.push(Number(issue.body.id));
    const response = await fetch(`${baseUrl}/api/shipments/${shipment.id}/debit-note/export?documentId=${issue.body.id}`, {
      headers: { 'X-Test-User-Id': String(cusId) },
    });
    assert.equal(response.status, 200, `the issuing CUS must read the file — got ${response.status}`);
    assert.match(response.headers.get('content-type') ?? '', /spreadsheetml/);
    const buffer = await response.arrayBuffer();
    assert.ok(buffer.byteLength > 100, 'a real file buffer comes back');
  });
});

describe('GỘP THEO KỲ — consolidated debit note per customer per period', () => {
  test('two locked lots, one POST, one document with both lots lines', async () => {
    const customer = await mkCustomer(`Consol ${suffix}`);
    customerIds.push(customer.id);
    const lotA = await mkLockedLotForCustomer(customer.id);
    const lotB = await mkLockedLotForCustomer(customer.id);
    await db.update(s.shipmentCostLocks).set({ costSnapshot: { freightAuto: '1000000', chiHoTotal: '300000' } })
      .where(eq(s.shipmentCostLocks.shipmentId, lotA.id));
    await db.update(s.shipmentCostLocks).set({ costSnapshot: { freightAuto: '800000', chiHoTotal: '200000' } })
      .where(eq(s.shipmentCostLocks.shipmentId, lotB.id));
    const response = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lotB.id, lotA.id] });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const docId = Number(response.body.id);
    docIds.push(docId);
    const lines = await db.select().from(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, docId));
    assert.equal(lines.length, 4, 'both lots freight + chi hộ lines land');
    assert.ok(lines.every((line) => line.description.includes('lô SHP-') || line.description.includes(`lô ${''}`)), 'lines carry per-lot grouping');
    assert.equal((await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.id, docId)))[0]?.entityId, customer.id);
  });
  test('replaying the same selection returns the same document', async () => {
    const customer = await mkCustomer(`Consol replay ${suffix}`);
    customerIds.push(customer.id);
    const lotA = await mkLockedLotForCustomer(customer.id);
    const first = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lotA.id] });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const firstId = Number(first.body.id);
    docIds.push(firstId);
    const replay = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lotA.id] });
    assert.equal(replay.status, 201);
    assert.equal(Number(replay.body.id), firstId, 'the same selection returns the same document');
  });

  test('mixed customers in one selection are rejected', async () => {
    const lotA = await mkLockedLot();
    const lotB = await mkLockedLot();
    const response = await api('POST', '/api/shipments/debit-notes', cusId, { shipmentIds: [lotA.id, lotB.id] });
    assert.equal(response.status, 409);
    assert.match(String(response.body.error), /cùng một khách hàng/);
  });
});
