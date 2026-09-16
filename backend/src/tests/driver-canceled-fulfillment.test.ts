// Driver read scope for OWN canceled fulfillments (20260916_7) — the read
// path must include a driver's own canceled fulfillment/trip while the
// mutation guards stay closed, returning ONE coherent 409 on canceled rows.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { db } from '../db';
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
const cleanupIds: Array<{ table: string; id: number }> = [];

let server: http.Server;
let baseUrl = '';
let ownerToken = '';
let otherToken = '';

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

async function api(path: string, options: { method?: string; body?: unknown } = {}, token = ownerToken) {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (method !== 'GET') headers['Idempotency-Key'] = `dcf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await fetch(`${baseUrl}/api/driver/me${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

before(async () => {
  await initEnforcer();
  await initAuditService();

  const [ownerUser] = await db.insert(s.users).values({
    username: `cf-owner-${suffix}`,
    passwordHash: await bcrypt.hash('x', 10),
    role: Role.DRIVER,
    status: 'ACTIVE',
  }).returning();
  const [ownerDriver] = await db.insert(s.drivers).values({ name: `CF chủ ${suffix}`, userId: ownerUser.id, status: 'ACTIVE' }).returning();
  ownerToken = signToken(ownerUser);

  const [otherUser] = await db.insert(s.users).values({
    username: `cf-other-${suffix}`,
    passwordHash: await bcrypt.hash('x', 10),
    role: Role.DRIVER,
    status: 'ACTIVE',
  }).returning();
  const [otherDriver] = await db.insert(s.drivers).values({ name: `CF khác ${suffix}`, userId: otherUser.id, status: 'ACTIVE' }).returning();
  void otherDriver;

  const [customer] = await db.insert(s.customers).values({ name: `CF khách ${suffix}`, status: 'ACTIVE' }).returning();
  const [route] = await db.insert(s.routes).values({ name: `CF tuyến ${suffix}` }).returning();
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `CF cargo ${suffix}` }).returning();

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    cargoMode: 'FCL',
    status: 'DISPATCHED',
    createdBy: ownerUser.id,
  }).returning();

  const makeFulfillment = async (canceled: boolean) => {
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      dispatchClassification: 'SINGLE',
      sourceShipmentVersion: shipment.version,
      canceledAt: canceled ? new Date() : null,
      createdBy: ownerUser.id,
    }).returning();
    const [trip] = await db.insert(s.trips).values({
      tripCode: `CF-${suffix}-${canceled ? 'c' : 'a'}`.slice(0, 50),
      driverId: ownerDriver.id,
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      status: canceled ? 'CANCELED' : 'CREATED',
      departureDate: new Date().toISOString().slice(0, 10),
      shipmentId: shipment.id,
      fulfillmentId: fulfillment.id,
    }).returning();
    return { fulfillment, trip };
  };
  const canceledPair = await makeFulfillment(true);
  const activePair = await makeFulfillment(false);

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

  (global as unknown as { __cfFixture?: unknown }).__cfFixture = {
    canceled: canceledPair, active: activePair, otherToken,
  };
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('driver canceled fulfillment read scope (20260916_7)', () => {
  test('owner reads OWN canceled fulfillment detail — the DRV-004 banner view', async () => {
    const fixture = (global as unknown as { __cfFixture: { canceled: { fulfillment: { id: number } } } }).__cfFixture;
    const read = await api(`/fulfillments/${fixture.canceled.fulfillment.id}`);
    assert.equal(read.status, 200);
    assert.equal((read.data as { fulfillmentId: number }).fulfillmentId, fixture.canceled.fulfillment.id);
  });

  test('owner still reads the active control fulfillment', async () => {
    const fixture = (global as unknown as { __cfFixture: { active: { fulfillment: { id: number } } } }).__cfFixture;
    const read = await api(`/fulfillments/${fixture.active.fulfillment.id}`);
    assert.equal(read.status, 200);
  });

  test('another driver still cannot read the canceled fulfillment', async () => {
    const fixture = (global as unknown as { __cfFixture: { canceled: { fulfillment: { id: number } }; otherToken: string } }).__cfFixture;
    const read = await api(`/fulfillments/${fixture.canceled.fulfillment.id}`, {}, fixture.otherToken);
    assert.ok([401, 403, 404].includes(read.status),
      `non-owner read must not leak (got ${read.status}: ${JSON.stringify(read.data).slice(0, 120)})`);
  });

  test('mutations on the canceled fulfillment return ONE coherent 409', async () => {
    const fixture = (global as unknown as { __cfFixture: { canceled: { fulfillment: { id: number }; trip: { id: number } } } }).__cfFixture;
    const fid = fixture.canceled.fulfillment.id;
    const detail = await api(`/fulfillments/${fid}`);
    const version = (detail.data as { tripVersion?: number })?.tripVersion ?? 1;
    const progress = await api(`/fulfillments/${fid}/progress`, {
      method: 'POST',
      body: { eventType: 'PICKED_UP', occurredAt: new Date().toISOString(), expectedVersion: version },
    });
    assert.equal(progress.status, 409, `progress body: ${JSON.stringify(progress.data).slice(0, 140)}`);
    assert.match(String(progress.data?.error ?? ''), /hủy/);

    const pod = await api(`/fulfillments/${fid}/pod`, { method: 'POST', body: { expectedVersion: version } });
    assert.equal(pod.status, 409, `pod body: ${JSON.stringify(pod.data).slice(0, 140)}`);

    const complete = await api(`/fulfillments/${fid}/complete`, { method: 'POST', body: { expectedVersion: version } });
    assert.equal(complete.status, 409);
    assert.match(String(complete.data?.error ?? ''), /hủy/);
  });

  test('mutation guards did not overshoot: active fulfillment still mutates', async () => {
    const fixture = (global as unknown as { __cfFixture: { active: { fulfillment: { id: number } } } }).__cfFixture;
    const detail = await api(`/fulfillments/${fixture.active.fulfillment.id}`);
    const version = (detail.data as { tripVersion?: number })?.tripVersion ?? 1;
    const progress = await api(`/fulfillments/${fixture.active.fulfillment.id}/progress`, {
      method: 'POST',
      body: { eventType: 'ORDER_RECEIVED', occurredAt: new Date().toISOString(), expectedVersion: version },
    });
    assert.ok([200, 201].includes(progress.status), `progress on active: ${progress.status} ${JSON.stringify(progress.data).slice(0, 140)}`);
  });
});
