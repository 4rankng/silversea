import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import shipmentRoutes from '../routes/shipments';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { createHandoff } from '../services/dispatch-handoff.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdTrailerIds: number[] = [];
const createdTruckIds: number[] = [];
const createdDriverIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdTripIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let adminUserId = 0;
let managerUserId = 0;
let accountantUserId = 0;
let adminToken = '';
let managerToken = '';
let accountantToken = '';

type ApiResponse<T> = {
  status: number;
  data: T;
};

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `dispatch-${tag}-${suffix}-${createdUserIds.length}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

function signToken(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign({
    userId: user.id,
    username: user.username ?? `user-${user.id}`,
    email: null,
    fullName: null,
    role: user.role as Role,
    customerId: null,
  }, config.jwtSecret);
}

async function apiFetch<T>(path: string, options: {
  method?: string;
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
} = {}): Promise<ApiResponse<T>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Idempotency-Key'] = options.idempotencyKey
      ?? `dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const response = await fetch(`${baseUrl}/api/shipments${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({})) as T;
  return { status: response.status, data };
}

async function createCustomer(name: string) {
  const [customer] = await db.insert(s.customers).values({ name }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function createRoute() {
  const [route] = await db.insert(s.routes).values({
    name: `Dispatch route ${suffix}-${createdRouteIds.length}`,
  }).returning();
  createdRouteIds.push(route.id);
  return route;
}

async function createContainerType(code: string) {
  const [containerType] = await db.insert(s.containerTypes).values({
    code,
    name: `Dispatch container ${code} ${suffix}-${createdContainerTypeIds.length}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  return containerType;
}

async function createShipmentFixture(args: {
  customerId: number;
  routeId: number;
  createdBy: number;
  cargoTypeId?: number | null;
}) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customerId,
    routeId: args.routeId,
    cargoMode: 'FCL',
    cargoTypeId: args.cargoTypeId ?? null,
    shipmentCode: `DSP-${suffix}-${createdShipmentIds.length}`,
    bookingRef: `BOOK-${suffix}-${createdShipmentIds.length}`,
    createdBy: args.createdBy,
  }).returning();
  createdShipmentIds.push(shipment.id);

  const containerType = await createContainerType(`20G${createdContainerTypeIds.length}`);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: containerType.id,
    containerNumber: `MSCU${String(100000 + shipment.id).slice(-6)}1`,
    createdBy: args.createdBy,
  }).returning();

  return { shipment, container };
}

async function createOwnedResources() {
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${(10000 + createdTrailerIds.length).toString().padStart(5, '0')}`,
    type: '20FT',
    status: 'ACTIVE',
  }).returning();
  createdTrailerIds.push(trailer.id);

  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51C-${(10000 + createdTruckIds.length).toString().padStart(5, '0')}`,
    currentTrailerId: trailer.id,
    trailerType: '20FT',
    status: 'ACTIVE',
  }).returning();
  createdTruckIds.push(truck.id);

  const driverUser = await mkUser(Role.DRIVER, 'driver');
  const [driver] = await db.insert(s.drivers).values({
    userId: driverUser.id,
    name: `Driver ${suffix}-${createdDriverIds.length}`,
    assignedTruckId: truck.id,
    status: 'ACTIVE',
  }).returning();
  createdDriverIds.push(driver.id);

  return { trailer, truck, driver };
}

async function createAcceptedFulfillment() {
  const customer = await createCustomer(`Dispatch customer ${suffix}-${createdCustomerIds.length}`);
  const route = await createRoute();
  const { shipment } = await createShipmentFixture({
    customerId: customer.id,
    routeId: route.id,
    createdBy: adminUserId,
    cargoTypeId: null,
  });
  const handoff = await createHandoff({
    shipmentId: shipment.id,
    createdBy: adminUserId,
    actor: {
      userId: adminUserId,
      username: `dispatch-admin-${suffix}`,
      email: null,
      fullName: null,
      role: Role.ADMIN,
    },
  });

  const accepted = await apiFetch<{
    handoff: { id: number; status: string; version: number };
    fulfillments: Array<{ id: number; version: number }>;
  }>(`/${shipment.id}/dispatch-handoffs/${handoff.id}/resolve`, {
    method: 'POST',
    token: managerToken,
    body: { resolution: 'ACCEPTED', expectedVersion: handoff.version },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.handoff.status, 'ACCEPTED');
  assert.equal(accepted.data.fulfillments.length, 1);

  return {
    shipmentId: shipment.id,
    fulfillmentId: accepted.data.fulfillments[0]!.id,
    fulfillmentVersion: accepted.data.fulfillments[0]!.version,
    handoffId: handoff.id,
  };
}

before(async () => {
  await initAuditService();
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use('/api/shipments', authMiddleware, casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const admin = await mkUser(Role.ADMIN, 'admin');
  const manager = await mkUser(Role.MANAGER, 'manager');
  const accountant = await mkUser(Role.ACCOUNTANT, 'accountant');
  adminUserId = admin.id;
  managerUserId = manager.id;
  accountantUserId = accountant.id;
  adminToken = signToken(admin);
  managerToken = signToken(manager);
  accountantToken = signToken(accountant);
});

after(async () => {
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.notifications).where(and(
        eq(s.notifications.type, 'TRIP_DISPATCHED'),
        inArray(s.notifications.relatedEntityId, createdTripIds),
      ));
      await db.delete(s.tripContainerSeals).where(inArray(
        s.tripContainerSeals.tripContainerId,
        db.select({ id: s.tripContainers.id }).from(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds)),
      ));
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdShipmentIds.length > 0) {
      await db.delete(s.notifications).where(and(
        eq(s.notifications.type, 'SHIPMENT_HANDOFF'),
        inArray(s.notifications.relatedEntityId, createdShipmentIds),
      ));
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, createdShipmentIds));
      await db.delete(s.dispatchHandoffs).where(inArray(s.dispatchHandoffs.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdDriverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    if (createdTruckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    if (createdTrailerIds.length > 0) await db.delete(s.trailers).where(inArray(s.trailers.id, createdTrailerIds));
    if (createdContainerTypeIds.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    if (createdUserIds.length > 0) {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } finally {
    await client.end();
  }
});

describe('dispatch fulfillment workflow routes', () => {
  test('manager can mark handoff seen and accept it into fulfillments', async () => {
    const customer = await createCustomer(`Seen customer ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const { shipment } = await createShipmentFixture({
      customerId: customer.id,
      routeId: route.id,
      createdBy: adminUserId,
      cargoTypeId: null,
    });
    const handoff = await createHandoff({
      shipmentId: shipment.id,
      createdBy: adminUserId,
      actor: {
        userId: adminUserId,
        username: `dispatch-admin-${suffix}`,
        email: null,
        fullName: null,
        role: Role.ADMIN,
      },
    });

    const seen = await apiFetch<{ status: string; version: number }>(
      `/${shipment.id}/dispatch-handoffs/${handoff.id}/resolve`,
      {
        method: 'POST',
        token: managerToken,
        body: { resolution: 'SEEN', expectedVersion: handoff.version },
      },
    );
    assert.equal(seen.status, 200);
    assert.equal(seen.data.status, 'SEEN');

    const accepted = await apiFetch<{
      handoff: { status: string };
      fulfillments: Array<{ id: number; shipmentContainerId: number | null }>;
    }>(`/${shipment.id}/dispatch-handoffs/${handoff.id}/resolve`, {
      method: 'POST',
      token: managerToken,
      body: { resolution: 'ACCEPTED', expectedVersion: seen.data.version },
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.handoff.status, 'ACCEPTED');
    assert.equal(accepted.data.fulfillments.length, 1);
    assert.ok(accepted.data.fulfillments[0]!.shipmentContainerId != null);
  });

  test('dispatch route creates a trip for one fulfillment even when shipment cargo type is null', async () => {
    const accepted = await createAcceptedFulfillment();
    const resources = await createOwnedResources();

    const dispatch = await apiFetch<{
      trip: { id: number; truckId: number | null; driverId: number | null; trailerId: number | null };
      replayed: boolean;
    }>(`/${accepted.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-01T08:00:00+07:00',
        plannedEndAt: '2026-08-01T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(dispatch.status, 201);
    assert.equal(dispatch.data.replayed, false);
    assert.equal(dispatch.data.trip.truckId, resources.truck.id);
    assert.equal(dispatch.data.trip.driverId, resources.driver.id);
    assert.equal(dispatch.data.trip.trailerId, resources.trailer.id);

    const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, dispatch.data.trip.id));
    assert.ok(trip);
    createdTripIds.push(trip.id);
    assert.equal(trip.shipmentId, accepted.shipmentId);
    assert.equal(trip.fulfillmentId, accepted.fulfillmentId);
    assert.equal(trip.cargoTypeId, null);

    const notifications = await db.select().from(s.notifications).where(and(
      eq(s.notifications.type, 'TRIP_DISPATCHED'),
      eq(s.notifications.relatedEntityType, 'trips'),
      eq(s.notifications.relatedEntityId, trip.id),
    ));
    assert.ok(notifications.length >= 1);
  });

  test('rejects overlapping truck, trailer, and driver assignments', async () => {
    const resources = await createOwnedResources();
    const first = await createAcceptedFulfillment();
    const firstDispatch = await apiFetch<{ trip: { id: number } }>(`/${first.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: first.fulfillmentId,
        expectedVersion: first.fulfillmentVersion,
        plannedStartAt: '2026-08-02T08:00:00+07:00',
        plannedEndAt: '2026-08-02T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(firstDispatch.status, 201);
    createdTripIds.push(firstDispatch.data.trip.id);

    const second = await createAcceptedFulfillment();
    const overlap = await apiFetch<{ error?: string }>(`/${second.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: second.fulfillmentId,
        expectedVersion: second.fulfillmentVersion,
        plannedStartAt: '2026-08-02T09:00:00+07:00',
        plannedEndAt: '2026-08-02T11:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(overlap.status, 409);
    assert.match(overlap.data.error ?? '', /trùng lịch/i);
  });

  test('accountant is read-only on dispatch workspace', async () => {
    const customer = await createCustomer(`Readonly customer ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const { shipment } = await createShipmentFixture({
      customerId: customer.id,
      routeId: route.id,
      createdBy: adminUserId,
      cargoTypeId: null,
    });
    const handoff = await createHandoff({
      shipmentId: shipment.id,
      createdBy: adminUserId,
      actor: {
        userId: adminUserId,
        username: `dispatch-admin-${suffix}`,
        email: null,
        fullName: null,
        role: Role.ADMIN,
      },
    });

    const queue = await apiFetch<{ items: unknown[] }>('/dispatch-handoffs', {
      token: accountantToken,
    });
    assert.equal(queue.status, 200);
    assert.ok(Array.isArray(queue.data.items));

    const forbidden = await apiFetch<{ error?: string }>(
      `/${shipment.id}/dispatch-handoffs/${handoff.id}/resolve`,
      {
        method: 'POST',
        token: accountantToken,
        body: { resolution: 'SEEN', expectedVersion: handoff.version },
      },
    );
    assert.equal(forbidden.status, 403);
  });
});
