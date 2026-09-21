// Card 20260919_5 — the customs channel (luồng đỏ/vàng/xanh) lives at the
// DECLARATION level: the customs authority assigns it per tờ khai, never per
// container. These tests pin the contract end to end: API validation,
// partial-update semantics, the no-per-container absence pin, and the
// producer/freeze contracts (red until the owner wires them, same pattern
// as card 20260919_3).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { shipmentDebitDetailSchema } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';
import shipmentRoutes from '../routes/shipments';
import { getShipmentDebitDetail } from '../services/shipment-debit-detail.service';
import { lockShipmentCost } from '../services/shipment-cost-lock.service';

const suffix = `${Date.now()}-chan-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const shipmentIds: number[] = [];
const routeIds: number[] = [];
const declarationIds: number[] = [];
const userIds: number[] = [];
const lockIds: number[] = [];
const documentIds: number[] = [];
let cusId = 0;
let cusToken = '';
let server: http.Server;
let baseUrl = '';

async function mkCustomerShipment(tag: string): Promise<number> {
  const [customer] = await db.insert(s.customers).values({ name: `Chan ${suffix} ${tag}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Chan route ${suffix} ${tag}` }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    shipmentCode: `CHAN-${suffix}-${shipmentIds.length}`,
    bookingRef: `BOOK-CHAN-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    createdBy: cusId,
  }).returning();
  shipmentIds.push(shipment.id);
  return shipment.id;
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `chan-${role.toLowerCase()}-${suffix.slice(-6)}-${userIds.length}`,
    passwordHash: await bcrypt.hash('test-only', 10),
    role, status: 'ACTIVE',
  }).returning();
  userIds.push(user.id);
  return user;
}

async function api(method: string, path: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/shipments${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cusToken}`, 'Idempotency-Key': `chan-${suffix}-${Math.random()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data: data as Record<string, unknown> };
}

before(async () => {
  await initEnforcer();
  const cus = await mkUser(Role.CUS);
  cusId = cus.id;
  cusToken = jwt.sign({
    userId: cus.id, username: cus.username ?? `user-${cus.id}`, email: null, fullName: null,
    role: Role.CUS, customerId: null, customerIds: [],
  }, config.jwtSecret);
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await db.delete(s.debitNoteLots).where(inArray(s.debitNoteLots.shipmentId, shipmentIds));
    await db.delete(s.shipmentCostLocks).where(inArray(s.shipmentCostLocks.shipmentId, shipmentIds));
    await db.delete(s.shipmentAccountingLocks).where(inArray(s.shipmentAccountingLocks.shipmentId, shipmentIds));
    if (documentIds.length > 0) await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
    await db.delete(s.shipmentDeclarations).where(inArray(s.shipmentDeclarations.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

describe('card 20260919_5 — declaration-level customs channel', () => {
  test('API rejects values outside RED/YELLOW/GREEN with a 400', async () => {
    const shipmentId = await mkCustomerShipment('reject');
    const res = await api('POST', `/${shipmentId}/declarations`, { declarationNumber: 'TMX-1', channel: 'BLUE' });
    assert.equal(res.status, 400, `invalid channel must 400 — got ${res.status}`);
  });

  test('POST sets channel; PUT undefined keeps it; PUT null clears it', async () => {
    const shipmentId = await mkCustomerShipment('partial');
    const created = await api('POST', `/${shipmentId}/declarations`, { declarationNumber: 'TMX-2', channel: 'GREEN' });
    assert.equal(created.status, 201);
    const createdBody = created.data as { id: number; channel: string | null };
    assert.equal(createdBody.channel, 'GREEN');
    const row = await db.select().from(s.shipmentDeclarations)
      .where(eq(s.shipmentDeclarations.shipmentId, shipmentId));
    assert.equal(row[0]?.channel, 'GREEN');
    const kept = await api('PUT', `/${shipmentId}/declarations/${createdBody.id}`, { declarationNumber: 'TMX-2' });
    assert.equal(kept.status, 200);
    const afterKeep = await db.select().from(s.shipmentDeclarations)
      .where(eq(s.shipmentDeclarations.shipmentId, shipmentId));
    assert.equal(afterKeep[0]?.channel, 'GREEN', 'undefined channel must KEEP the value');
    const cleared = await api('PUT', `/${shipmentId}/declarations/${createdBody.id}`, { declarationNumber: 'TMX-2', channel: null });
    assert.equal(cleared.status, 200);
    const afterClear = await db.select().from(s.shipmentDeclarations)
      .where(eq(s.shipmentDeclarations.shipmentId, shipmentId));
    assert.equal(afterClear[0]?.channel, null, 'explicit null must CLEAR the value');
  });

  test('absence pin: the debit wire has NO per-container channel — lot-level only', async () => {
    assert.ok(!('channel' in (shipmentDebitDetailSchema.shape.freightRows as unknown as { element: { shape: Record<string, unknown> } }).element.shape),
      'container rows must NOT carry a channel field — the channel is declaration-level');
    assert.ok('customsChannel' in shipmentDebitDetailSchema.shape,
      'the top-level wire carries the lot channel');
  });

  test('freeze contract: locking freezes the declared channel into the snapshot', async () => {
    const shipmentId = await mkCustomerShipment('freeze');
    await api('POST', `/${shipmentId}/declarations`, { declarationNumber: 'TMX-3', channel: 'RED' });
    const actor = { userId: cusId, username: 'chan-actor', email: null, fullName: null, role: Role.CUS, customerId: null, customerIds: [] };
    const lock = await lockShipmentCost({ shipmentId, actor: actor as never, idempotencyKey: `freeze-${suffix}` });
    lockIds.push(lock.id);
    const [lockRow] = await db.select().from(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.id, lock.id));
    const snapshot = lockRow.costSnapshot as Record<string, unknown> | null;
    assert.ok(snapshot, 'lock creates a snapshot');
    assert.equal(snapshot.customsChannel, 'RED', 'the snapshot must freeze the declared channel (wired by owner)');
  });

  test('producer contract: the debit wire carries the declared channel', async () => {
    const shipmentId = await mkCustomerShipment('producer');
    await api('POST', `/${shipmentId}/declarations`, { declarationNumber: 'TMX-4', channel: 'YELLOW' });
    const detail = await getShipmentDebitDetail(shipmentId);
    const parsed = shipmentDebitDetailSchema.parse(detail);
    assert.equal(parsed.customsChannel, 'YELLOW', 'the wire must carry the declared channel (wired by owner)');
  });

  test('DELETE removes one row of the lot; a foreign or repeated id reads 404', async () => {
    const shipmentId = await mkCustomerShipment('delete');
    const first = await api('POST', `/${shipmentId}/declarations`, { declarationNumber: 'TMX-DEL-1' });
    const second = await api('POST', `/${shipmentId}/declarations`, { declarationNumber: 'TMX-DEL-2' });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstId = (first.data as { id: number }).id;
    const secondId = (second.data as { id: number }).id;

    const removed = await api('DELETE', `/${shipmentId}/declarations/${firstId}`);
    assert.equal(removed.status, 200, `delete must succeed — got ${removed.status}`);
    const rows = await db.select().from(s.shipmentDeclarations)
      .where(eq(s.shipmentDeclarations.shipmentId, shipmentId));
    assert.deepEqual(rows.map((row) => row.id), [secondId], 'only the untouched sibling remains');

    const foreign = await api('DELETE', `/${shipmentId}/declarations/${firstId}`);
    assert.equal(foreign.status, 404, 're-deleting the same id must 404');
    const otherShipment = await mkCustomerShipment('delete-other');
    const wrong = await api('DELETE', `/${otherShipment}/declarations/${secondId}`);
    assert.equal(wrong.status, 404, 'a declaration of another lot must not delete');
  });

  test('DELETE is blocked while the accounting lock holds', async () => {
    const shipmentId = await mkCustomerShipment('delete-locked');
    const created = await api('POST', `/${shipmentId}/declarations`, { declarationNumber: 'TMX-LOCK-1' });
    const declarationId = (created.data as { id: number }).id;
    const [document] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customerIds[customerIds.length - 1],
      entityName: `Chan ${suffix}`,
      rangeFrom: '2026-09-01',
      rangeTo: '2026-09-30',
      totalInclVat: '1000000',
      debitNoteStatus: 'SENT',
      issuedAt: new Date(),
    }).returning();
    documentIds.push(document.id);
    const [lock] = await db.insert(s.shipmentAccountingLocks).values({
      shipmentId,
      billingDocumentId: document.id,
      billingDocumentVersion: 1,
      billingPeriodSnapshot: { rangeFrom: '2026-09-01', rangeTo: '2026-09-30', issuedAt: new Date().toISOString() },
      shipmentVersionAtLock: 1,
      reason: 'delete-gate test',
      activatedBy: cusId,
    }).returning();
    lockIds.push(lock.id);
    const blocked = await api('DELETE', `/${shipmentId}/declarations/${declarationId}`);
    assert.equal(blocked.status, 409, `accounting lock must block delete — got ${blocked.status}`);
    const rows = await db.select().from(s.shipmentDeclarations)
      .where(eq(s.shipmentDeclarations.shipmentId, shipmentId));
    assert.equal(rows.length, 1, 'the locked row must survive');
  });
});
