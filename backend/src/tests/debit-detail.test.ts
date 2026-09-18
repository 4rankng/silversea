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
import { lockShipmentCost, SHIPMENT_COST_LOCKED_MESSAGE } from '../services/shipment-cost-lock.service';
import shipmentRoutes from '../routes/shipments';

// Debit-wave detail endpoints (FE _18 contract, BE1 lane): pins for
// GET /api/shipments/:id/debit-detail and PUT /api/shipments/:id/debit-edits.
// Money is nullable everywhere — null = "chưa xác định", never a silent 0.

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const actor: never = null as never;
void actor;
const createdShipmentIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdTripIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const userIds: number[] = [];
let adminId = 0;
let accountantId = 0;
let server: http.Server;
let baseUrl = '';

async function api(method: string, path: string, actorId: number, body?: Record<string, unknown>, idempotencyKey?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey ?? `dd-${suffix}-${method}-${Math.random()}`,
      'X-Test-User-Id': String(actorId),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsed = { raw: text.slice(0, 160) };
  }
  return { status: response.status, body: parsed };
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `dd-${role.toLowerCase()}-${suffix}-${userIds.length}`,
    passwordHash: 'test-only',
    role,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  userIds.push(user.id);
  return user.id;
}

async function mkShipmentWithTrip() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `DD customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `DD route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
  }).returning({ id: s.shipments.id });
  createdShipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  createdFulfillmentIds.push(fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    fulfillmentId: fulfillment.id,
    customerId: customer.id,
    routeId: route.id,
    departureDate: '2026-01-01',
    status: 'COMPLETED',
  }).returning({ id: s.trips.id });
  createdTripIds.push(trip.id);
  return { customer, route, shipment, fulfillment, trip };
}

async function mkExpense(tripId: number, fields: {
  expenseType?: string;
  feeName?: string;
  buyAmount?: string;
  sellAmount?: string;
  note?: string;
}) {
  const [row] = await db.insert(s.tripExpenses).values({
    tripId,
    expenseType: fields.expenseType ?? 'CUSTOMS',
    feeName: fields.feeName ?? 'Phí làm tờ khai',
    buyAmount: fields.buyAmount ?? '500000',
    sellAmount: fields.sellAmount ?? '0',
    recoveryNote: fields.note ?? null,
  }).returning({ id: s.tripExpenses.id });
  createdExpenseIds.push(row.id);
  return row.id;
}

async function seedAccountantActor() {
  accountantId = await mkUser(Role.ACCOUNTANT);
}

before(async () => {
  await initEnforcer();
  adminId = await mkUser(Role.ADMIN);
  await seedAccountantActor();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.header('X-Test-User-Id');
    if (header) (req as express.Request & { user?: unknown }).user = {
      userId: Number(header),
      username: 'test', email: 'test@x', fullName: 'test', role: adminId === Number(header) ? Role.ADMIN : Role.ACCOUNTANT,
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
    for (const expenseId of createdExpenseIds) {
      await db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId));
    }
    for (const tripId of createdTripIds) {
      await db.delete(s.trips).where(eq(s.trips.id, tripId));
    }
    for (const fulfillmentId of createdFulfillmentIds) {
      await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentId));
    }
    for (const shipmentId of createdShipmentIds) {
      await db.delete(s.shipments).where(eq(s.shipments.id, shipmentId));
    }
    for (const routeId of createdRouteIds) {
      await db.delete(s.routes).where(eq(s.routes.id, routeId));
    }
    for (const typeId of createdContainerTypeIds) {
      await db.delete(s.containerTypes).where(eq(s.containerTypes.id, typeId));
    }
    for (const customerId of createdCustomerIds) {
      await db.delete(s.customers).where(eq(s.customers.id, customerId));
    }
    if (userIds.length > 0) {
      await db.delete(s.notifications).where(inArray(s.notifications.userId, userIds));
      await db.delete(s.users).where(inArray(s.users.id, userIds));
    }
  } catch {
    // red-phase tolerance
  }
  await disconnectRedis();
});

describe('20260918 debit-detail GET (red-first)', () => {
  test('404 unknown shipment with the dedicated message', async () => {
    const result = await api('GET', '/api/shipments/999999999/debit-detail', accountantId);
    assert.equal(result.status, 404);
    assert.match(String(result.body.error), /không tồn tại|Không tìm thấy/i);
  });

  test('contract shape: freightRows, chiHoRows with otherFees+opsDocsStatus, payables, thuKhachTotal', async () => {
    const lot = await mkShipmentWithTrip();
    await mkExpense(lot.trip.id, { expenseType: 'CUSTOMS', buyAmount: '700000', sellAmount: '800000' });
    await mkExpense(lot.trip.id, { expenseType: 'OTHER', feeName: 'Phí rửa cont', buyAmount: '300000' });
    const result = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    for (const key of ['freightRows', 'chiHoRows', 'payables', 'thuKhachTotal']) {
      assert.ok(key in result.body, `missing ${key}`);
    }
    const rows = result.body.chiHoRows as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(rows) && rows.length >= 1);
    for (const row of rows) {
      assert.ok(Array.isArray(row.otherFees), 'chi hộ row must carry an otherFees array');
      assert.ok(['READY', 'PENDING'].includes(String(row.opsDocsStatus)), 'opsDocsStatus must be READY or PENDING');
    }
  });

  test('fresh lot with no data → nulls, never silent zeros', async () => {
    const lot = await mkShipmentWithTrip();
    const result = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(result.status, 200);
    assert.equal(result.body.thuKhachTotal, null);
    assert.deepEqual(result.body.chiHoRows, []);
    assert.deepEqual(result.body.freightRows, []);
  });

  test('REWORK B: containers with no trips/expenses render N null-money rows (lot 157 case)', async () => {
    const lot = await mkShipmentWithTrip();
    const [containerType] = await db.insert(s.containerTypes)
      .values({ code: `CTR${suffix}`.slice(0, 20).replace(/-/g, ''), name: `40'HC rework` }).returning();
    createdContainerTypeIds.push(containerType.id);
    const containerRows = await db.insert(s.shipmentContainers).values([
      { shipmentId: lot.shipment.id, containerNumber: 'TSTU0000001', containerTypeId: containerType.id },
      { shipmentId: lot.shipment.id, containerNumber: 'TSTU0000002', containerTypeId: containerType.id },
      { shipmentId: lot.shipment.id, containerNumber: 'TSTU0000003', containerTypeId: containerType.id },
    ]).returning({ id: s.shipmentContainers.id, number: s.shipmentContainers.containerNumber });
    const result = await api('GET', `/api/shipments/${lot.shipment.id}/debit-detail`, accountantId);
    assert.equal(result.status, 200);
    assert.equal((result.body.freightRows as unknown[]).length, 3, 'one freight row per container');
    assert.equal((result.body.chiHoRows as unknown[]).length, 3, 'one chi-ho row per container');
    for (const row of result.body.chiHoRows as Array<Record<string, unknown>>) {
      assert.ok(containerRows.some((c) => c.number === row.containerNumber), 'row keyed on the container');
      assert.equal(row.tripId, null, 'no trip yet');
      assert.equal(row.opsDocsStatus, 'PENDING');
      assert.deepEqual(row.items, []);
      assert.deepEqual(row.otherFees, []);
    }
    for (const row of result.body.freightRows as Array<Record<string, unknown>>) {
      assert.equal(row.freight, null);
      assert.equal(row.total, null);
      assert.equal(row.containerTypeLabel, `40'HC rework`);
    }
    assert.equal(result.body.thuKhachTotal, null, 'no data — null, not 0');
  });
});

describe('20260918 debit-edits PUT (red-first)', () => {
  test('missing Idempotency-Key → 400 with the global message', async () => {
    const lot = await mkShipmentWithTrip();
    const expenseId = await mkExpense(lot.trip.id, {});
    void expenseId;
    const response = await fetch(`${baseUrl}/api/shipments/${lot.shipment.id}/debit-edits`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Test-User-Id': String(accountantId) },
      body: JSON.stringify({ edits: [] }),
    });
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.match(text, /Idempotency-Key/i);
  });

  test('edits the editable fields: PS thực tế (buy), thu khách (sell), note', async () => {
    const lot = await mkShipmentWithTrip();
    const expenseId = await mkExpense(lot.trip.id, { buyAmount: '500000', sellAmount: '0' });
    const result = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      edits: [{ expenseId, buyAmount: '650000', sellAmount: '750000', note: 'Điều chỉnh thực tế' }],
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const [row] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId));
    assert.equal(row.buyAmount, '650000');
    assert.equal(Number(row.sellAmount), 750000);
    assert.equal(row.recoveryNote, 'Điều chỉnh thực tế');
  });

  test('add and remove a Phí khác (OTHER) row', async () => {
    const lot = await mkShipmentWithTrip();
    const add = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      addOtherFees: [{ tripId: lot.trip.id, name: 'Phí nâng hạ phát sinh', amount: 250000 }],
    });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    const [added] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.tripId, lot.trip.id));
    assert.ok(added, 'the OTHER fee row must exist');
    assert.equal(added.expenseType, 'OTHER');
    const remove = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      removeExpenseIds: [added.id],
    });
    assert.equal(remove.status, 200, JSON.stringify(remove.body));
    const [gone] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, added.id));
    assert.ok(!gone, 'the removed fee row must be gone');
  });

  test('idempotency replay applies once — no duplicate rows', async () => {
    const lot = await mkShipmentWithTrip();
    const key = `dd-replay-${suffix}-${lot.shipment.id}`;
    const first = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      addOtherFees: [{ tripId: lot.trip.id, name: 'Phí test replay', amount: 1000 }],
    }, key);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const countBefore = (await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, lot.trip.id))).length;
    const replay = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      addOtherFees: [{ tripId: lot.trip.id, name: 'Phí test replay', amount: 1000 }],
    }, key);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    const rows = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, lot.trip.id));
    assert.equal(rows.length, countBefore, 'replay must not add rows');
  });

  test('unknown payload keys are rejected (read-only stays read-only)', async () => {
    const lot = await mkShipmentWithTrip();
    await mkExpense(lot.trip.id, {});
    const result = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      freightRows: [{ freight: 123 }],
    });
    assert.equal(result.status, 400);
    assert.match(String(result.body.error), /không được sửa|chỉ chấp nhận|read-only|không hợp lệ/i);
  });

  test('409 with the dedicated message when the lot is debit-locked', async () => {
    const lot = await mkShipmentWithTrip();
    const expenseId = await mkExpense(lot.trip.id, {});
    void expenseId;
    await lockShipmentCost({
      shipmentId: lot.shipment.id,
      actor: { userId: adminId, role: Role.ADMIN } as never,
      idempotencyKey: `dd-lock-${suffix}-${lot.shipment.id}`,
    });
    const result = await api('PUT', `/api/shipments/${lot.shipment.id}/debit-edits`, accountantId, {
      edits: [{ expenseId, buyAmount: '1' }],
    });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /đã khóa chi phí/i);
  });
});
