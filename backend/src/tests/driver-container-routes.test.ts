// Driver add/patch container routes — the ISO 6346 gate wiring lock. The
// schema matrix (forwarder-container-validation.test.ts) pins the shared
// chains; THIS file pins that the driver ROUTES actually consume them: a
// tsc-clean revert to the raw schemas would keep every schema test green but
// go red here (review finding on 20260914_9).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import driverRoutes from '../routes/driver';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const driverIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const shipmentIds: number[] = [];
const fulfillmentIds: number[] = [];
const tripIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let driverToken = '';
let tripId = 0;

function signToken(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign({
    userId: user.id,
    username: user.username ?? `user-${user.id}`,
    email: null,
    fullName: null,
    role: user.role as Role,
    customerId: null,
    customerIds: [],
  }, config.jwtSecret);
}

async function api(path: string, options: { method?: string; body?: unknown; idempotencyKey?: string; ifUnmodifiedSince?: string } = {}) {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${driverToken}` };
  if (options.ifUnmodifiedSince) headers['If-Unmodified-Since'] = options.ifUnmodifiedSince;
  if (method !== 'GET') headers['Idempotency-Key'] = options.idempotencyKey ?? `dc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await fetch(`${baseUrl}/api/driver/me${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function countContainers(): Promise<number> {
  const [row] = await db.select({ total: s.tripContainers.id }).from(s.tripContainers).where(eq(s.tripContainers.tripId, tripId));
  const rows = await db.select({ id: s.tripContainers.id }).from(s.tripContainers).where(eq(s.tripContainers.tripId, tripId));
  void row;
  return rows.length;
}

before(async () => {
  await initEnforcer();
  await initAuditService();

  const [user] = await db.insert(s.users).values({
    username: `dc-driver-${suffix}`,
    passwordHash: await bcrypt.hash('x', 10),
    role: Role.DRIVER,
    status: 'ACTIVE',
  }).returning();
  userIds.push(user.id);
  const [driver] = await db.insert(s.drivers).values({ name: `DC tài xế ${suffix}`, userId: user.id, status: 'ACTIVE' }).returning();
  driverIds.push(driver.id);
  driverToken = signToken(user);

  const [customer] = await db.insert(s.customers).values({ name: `DC khách ${suffix}`, status: 'ACTIVE' }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `DC tuyến ${suffix}` }).returning();
  routeIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `DC cargo ${suffix}` }).returning();
  cargoTypeIds.push(cargoType.id);

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    cargoMode: 'FCL',
    status: 'DISPATCHED',
    createdBy: user.id,
  }).returning();
  shipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    dispatchClassification: 'SINGLE',
    sourceShipmentVersion: shipment.version,
    createdBy: user.id,
  }).returning();
  fulfillmentIds.push(fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `DC-${suffix}`.slice(0, 50),
    driverId: driver.id,
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'CREATED',
    departureDate: new Date().toISOString().slice(0, 10),
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
  }).returning();
  tripIds.push(trip.id);
  tripId = trip.id;

  const app = express();
  app.use(express.json());
  app.use('/api/driver/me', authMiddleware, casbinAuthz('driver_portal'), driverRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

describe('driver container routes — ISO 6346 gate wiring', () => {
  test("'ABC' is rejected at the route with the format message and writes nothing", async () => {
    const before = await countContainers();
    const bad = await api(`/trips/${tripId}/containers`, { method: 'POST', body: { containerNumber: 'ABC' } });
    assert.equal(bad.status, 400);
    assert.ok(JSON.stringify(bad.data).includes('sai định dạng'));
    assert.equal(await countContainers(), before);
  });

  test('a wrong check digit is rejected; a spaced valid number persists NORMALIZED', async () => {
    const wrongDigit = await api(`/trips/${tripId}/containers`, { method: 'POST', body: { containerNumber: 'TCKU1234567' } });
    assert.equal(wrongDigit.status, 400);

    const good = await api(`/trips/${tripId}/containers`, { method: 'POST', body: { containerNumber: 'tcku 123456 0' } });
    assert.equal(good.status, 201);
    const rows = await db.select({ containerNumber: s.tripContainers.containerNumber })
      .from(s.tripContainers).where(eq(s.tripContainers.tripId, tripId));
    assert.ok(rows.some((row) => row.containerNumber === 'TCKU1234560'), JSON.stringify(rows));
  });

  test("PATCH '' clears the number (transform-before-refines), not a rejection", async () => {
    const created = await db.select({ id: s.tripContainers.id, updatedAt: s.tripContainers.updatedAt }).from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, tripId)).limit(1);
    const containerId = created[0].id;
    const cleared = await api(`/trips/${tripId}/containers/${containerId}`, {
      method: 'PATCH',
      body: { containerNumber: '' },
      ifUnmodifiedSince: created[0].updatedAt.toISOString(),
    });
    assert.equal(cleared.status, 200);
    const [row] = await db.select({ containerNumber: s.tripContainers.containerNumber })
      .from(s.tripContainers).where(eq(s.tripContainers.id, containerId));
    assert.equal(row.containerNumber, null);
  });

  test("PATCH malformed container number 'INVALID' is rejected", async () => {
    const created = await db.select({ id: s.tripContainers.id, updatedAt: s.tripContainers.updatedAt }).from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, tripId)).limit(1);
    const containerId = created[0].id;
    const bad = await api(`/trips/${tripId}/containers/${containerId}`, {
      method: 'PATCH',
      body: { containerNumber: 'INVALID' },
      ifUnmodifiedSince: created[0].updatedAt.toISOString(),
    });
    assert.ok(bad.status === 400 || bad.status === 422, `expected 400 or 422, got ${bad.status}`);
  });

  test('PATCH with wrong check digit is rejected', async () => {
    const created = await db.select({ id: s.tripContainers.id, updatedAt: s.tripContainers.updatedAt }).from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, tripId)).limit(1);
    const containerId = created[0].id;
    const bad = await api(`/trips/${tripId}/containers/${containerId}`, {
      method: 'PATCH',
      body: { containerNumber: 'TCKU1234567' },
      ifUnmodifiedSince: created[0].updatedAt.toISOString(),
    });
    assert.ok(bad.status === 400 || bad.status === 422, `expected 400 or 422, got ${bad.status}`);
  });
});

after(async () => {
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  try {
    if (tripIds.length) await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, tripIds));
    if (tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    if (fulfillmentIds.length) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
    if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    if (cargoTypeIds.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
    if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (driverIds.length) await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
    if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch (err) {
    console.warn('[driver-container-routes.test] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
