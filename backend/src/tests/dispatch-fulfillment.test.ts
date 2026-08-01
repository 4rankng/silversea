import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import shipmentRoutes from '../routes/shipments';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import { createHandoff } from '../services/dispatch-handoff.service';
import { listDispatchQueue } from '../services/dispatch-planning.service';

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

function signToken(
  user: { id: number; username: string | null; role: Role | string },
  scope: { customerId?: number | null; customerIds?: number[] } = {},
) {
  return jwt.sign({
    userId: user.id,
    username: user.username ?? `user-${user.id}`,
    email: null,
    fullName: null,
    role: user.role as Role,
    customerId: scope.customerId ?? null,
    customerIds: scope.customerIds,
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

async function createRoute(distanceKm: number | null = null) {
  const [route] = await db.insert(s.routes).values({
    name: `Dispatch route ${suffix}-${createdRouteIds.length}`,
    distanceKm,
  }).returning();
  createdRouteIds.push(route.id);
  return route;
}

async function linkUserToCustomer(userId: number, customerId: number) {
  await db.insert(s.userCustomerLinks).values({ userId, customerId });
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
  cargoWeightKg?: string | null;
  containerCargoWeightKg?: string | null;
}) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customerId,
    routeId: args.routeId,
    cargoMode: 'FCL',
    cargoTypeId: args.cargoTypeId ?? null,
    cargoWeightKg: args.cargoWeightKg ?? null,
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
    cargoWeightKg: args.containerCargoWeightKg ?? null,
    createdBy: args.createdBy,
  }).returning();

  return { shipment, container };
}

async function createOwnedResources(options: { trailerType?: '20FT' | '40FT' } = {}) {
  const trailerType = options.trailerType ?? '20FT';
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${(10000 + createdTrailerIds.length).toString().padStart(5, '0')}`,
    type: trailerType,
    status: 'ACTIVE',
  }).returning();
  createdTrailerIds.push(trailer.id);

  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51C-${(10000 + createdTruckIds.length).toString().padStart(5, '0')}`,
    currentTrailerId: trailer.id,
    trailerType,
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

  return { trailer, truck, driver, driverUser };
}

async function createAcceptedFulfillment(args: {
  customerId?: number;
  routeId?: number;
  cargoWeightKg?: string | null;
  containerCargoWeightKg?: string | null;
} = {}) {
  const customer = args.customerId == null
    ? await createCustomer(`Dispatch customer ${suffix}-${createdCustomerIds.length}`)
    : { id: args.customerId };
  const route = args.routeId == null ? await createRoute() : { id: args.routeId };
  const { shipment } = await createShipmentFixture({
    customerId: customer.id,
    routeId: route.id,
    createdBy: adminUserId,
    cargoTypeId: null,
    cargoWeightKg: args.cargoWeightKg,
    containerCargoWeightKg: args.containerCargoWeightKg,
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
    customerId: shipment.customerId,
  };
}

before(async () => {
  await initAuditService();
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use('/api/shipments', authMiddleware, auditLogMiddleware, casbinAuthz('shipments'), shipmentRoutes);
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
      await db.delete(s.tripContainerSeals).where(inArray(
        s.tripContainerSeals.tripContainerId,
        db.select({ id: s.tripContainers.id }).from(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds)),
      ));
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdShipmentIds.length > 0) {
      await db.delete(s.notifications).where(and(
        eq(s.notifications.type, 'TRIP_DISPATCHED'),
        eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
        inArray(
          s.notifications.relatedEntityId,
          db.select({ id: s.shipmentFulfillments.id }).from(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, createdShipmentIds)),
        ),
      ));
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
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
      await db.delete(s.notifications).where(inArray(s.notifications.userId, createdUserIds));
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
      eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
      eq(s.notifications.relatedEntityId, accepted.fulfillmentId),
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

  test('unscoped accountant cannot read dispatch workspace and cannot mutate handoffs', async () => {
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
    assert.equal(queue.status, 403);

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

  test('accountant reads only scoped dispatch tasks, fleet is forbidden, and unscoped accountant is denied', async () => {
    const scopedCustomer = await createCustomer(`Scoped customer ${suffix}-${createdCustomerIds.length}`);
    const otherCustomer = await createCustomer(`Other customer ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const scopedAccepted = await createAcceptedFulfillment({ customerId: scopedCustomer.id, routeId: route.id });
    await createAcceptedFulfillment({ customerId: otherCustomer.id, routeId: route.id });
    const { shipment: scopedHandoffShipment } = await createShipmentFixture({
      customerId: scopedCustomer.id,
      routeId: route.id,
      createdBy: adminUserId,
    });
    await createHandoff({
      shipmentId: scopedHandoffShipment.id,
      createdBy: adminUserId,
      actor: {
        userId: adminUserId,
        username: `dispatch-admin-${suffix}`,
        email: null,
        fullName: null,
        role: Role.ADMIN,
      },
    });
    const { shipment: otherHandoffShipment } = await createShipmentFixture({
      customerId: otherCustomer.id,
      routeId: route.id,
      createdBy: adminUserId,
    });
    await createHandoff({
      shipmentId: otherHandoffShipment.id,
      createdBy: adminUserId,
      actor: {
        userId: adminUserId,
        username: `dispatch-admin-${suffix}`,
        email: null,
        fullName: null,
        role: Role.ADMIN,
      },
    });
    await linkUserToCustomer(accountantUserId, scopedCustomer.id);
    const scopedAccountantToken = signToken(
      { id: accountantUserId, username: `dispatch-accountant-${suffix}`, role: Role.ACCOUNTANT },
      { customerId: scopedCustomer.id, customerIds: [scopedCustomer.id] },
    );

    const queue = await apiFetch<{
      items: Array<{
        shipmentId: number;
        customer: { id: number };
        dispatch: { externalDriverPhone: string | null } | null;
      }>;
    }>('/dispatch-queue', {
      token: scopedAccountantToken,
    });
    assert.equal(queue.status, 200);
    assert.ok(Array.isArray(queue.data.items));
    if (queue.data.items[0]) {
      assert.equal(queue.data.items[0].shipmentId, scopedAccepted.shipmentId);
      assert.equal(queue.data.items[0].customer.id, scopedCustomer.id);
      assert.equal(queue.data.items[0].dispatch?.externalDriverPhone ?? null, null);
    }

    const handoffs = await apiFetch<{ items: Array<{ shipmentId: number }> }>('/dispatch-handoffs', {
      token: scopedAccountantToken,
    });
    assert.equal(handoffs.status, 200);
    assert.equal(handoffs.data.items.length, 1);
    assert.equal(handoffs.data.items[0]?.shipmentId, scopedHandoffShipment.id);

    const fleetForbidden = await apiFetch<{ error?: string }>('/dispatch-fleet', {
      token: scopedAccountantToken,
    });
    assert.equal(fleetForbidden.status, 403);

    const unscopedAccountant = await mkUser(Role.ACCOUNTANT, 'accountant-unscoped');
    const unscopedAccountantToken = signToken(unscopedAccountant);
    const unscopedDenied = await apiFetch<{ error?: string }>('/dispatch-handoffs', {
      token: unscopedAccountantToken,
    });
    assert.equal(unscopedDenied.status, 403);
    assert.match(unscopedDenied.data.error ?? '', /phạm vi khách hàng/i);
  });

  test('dispatch derives planned end from route duration without explicit confirmation', async () => {
    const route = await createRoute(70);
    const accepted = await createAcceptedFulfillment({ routeId: route.id });
    const resources = await createOwnedResources();

    const dispatch = await apiFetch<{
      trip: { id: number; plannedEndAt: string | null };
      version: number;
      replayed: boolean;
    }>(`/${accepted.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-03T08:00:00+07:00',
        plannedEndAt: '2026-08-03T23:59:00+07:00',
        endTimeConfirmed: false,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(dispatch.status, 201);
    assert.equal(dispatch.data.replayed, false);
    createdTripIds.push(dispatch.data.trip.id);

    const [trip] = await db.select({
      id: s.trips.id,
      plannedEndAt: s.trips.plannedEndAt,
    }).from(s.trips).where(eq(s.trips.id, dispatch.data.trip.id));
    assert.ok(trip?.plannedEndAt);
    assert.equal(trip.plannedEndAt?.toISOString(), '2026-08-03T03:30:00.000Z');
  });

  test('rejects inactive or re-bound non-driver users when issuing or reassigning', async () => {
    const accepted = await createAcceptedFulfillment();
    const resources = await createOwnedResources();
    await db.update(s.users)
      .set({ role: Role.MANAGER })
      .where(eq(s.users.id, resources.driverUser.id));

    const dispatch = await apiFetch<{ error?: string }>(`/${accepted.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-03T08:00:00+07:00',
        plannedEndAt: '2026-08-03T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(dispatch.status, 409);
    assert.match(dispatch.data.error ?? '', /tài xế không còn hiệu lực/i);
  });

  test('rejects cargo above trailer capacity and allows half-open plan boundaries', async () => {
    const overweightAccepted = await createAcceptedFulfillment({
      cargoWeightKg: '19000',
      containerCargoWeightKg: '19000',
    });
    const overweightResources = await createOwnedResources({ trailerType: '20FT' });
    const overweight = await apiFetch<{ error?: string }>(`/${overweightAccepted.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: overweightAccepted.fulfillmentId,
        expectedVersion: overweightAccepted.fulfillmentVersion,
        plannedStartAt: '2026-08-04T08:00:00+07:00',
        plannedEndAt: '2026-08-04T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: overweightResources.truck.id,
        driverId: overweightResources.driver.id,
        trailerId: overweightResources.trailer.id,
      },
    });
    assert.equal(overweight.status, 409);
    assert.match(overweight.data.error ?? '', /vượt quá tải trọng/i);

    const boundaryResources = await createOwnedResources();
    const first = await createAcceptedFulfillment();
    const second = await createAcceptedFulfillment();
    const firstDispatch = await apiFetch<{ trip: { id: number } }>(`/${first.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: first.fulfillmentId,
        expectedVersion: first.fulfillmentVersion,
        plannedStartAt: '2026-08-04T08:00:00+07:00',
        plannedEndAt: '2026-08-04T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: boundaryResources.truck.id,
        driverId: boundaryResources.driver.id,
        trailerId: boundaryResources.trailer.id,
      },
    });
    assert.equal(firstDispatch.status, 201);
    createdTripIds.push(firstDispatch.data.trip.id);

    const secondDispatch = await apiFetch<{ trip: { id: number } }>(`/${second.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: second.fulfillmentId,
        expectedVersion: second.fulfillmentVersion,
        plannedStartAt: '2026-08-04T12:00:00+07:00',
        plannedEndAt: '2026-08-04T16:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: boundaryResources.truck.id,
        driverId: boundaryResources.driver.id,
        trailerId: boundaryResources.trailer.id,
      },
    });
    assert.equal(secondDispatch.status, 201);
    createdTripIds.push(secondDispatch.data.trip.id);
  });

  test('replays idempotent dispatch and notifies the reassigned driver with audit history preserved', async () => {
    const accepted = await createAcceptedFulfillment();
    const resourcesA = await createOwnedResources();
    const resourcesB = await createOwnedResources();
    const replayKey = `dispatch-replay-${suffix}`;

    const firstDispatch = await apiFetch<{
      version: number;
      trip: { id: number };
      replayed: boolean;
    }>(`/${accepted.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      idempotencyKey: replayKey,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-05T08:00:00+07:00',
        plannedEndAt: '2026-08-05T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resourcesA.truck.id,
        driverId: resourcesA.driver.id,
        trailerId: resourcesA.trailer.id,
      },
    });
    assert.equal(firstDispatch.status, 201);
    assert.equal(firstDispatch.data.replayed, false);
    createdTripIds.push(firstDispatch.data.trip.id);

    const replayed = await apiFetch<{ replayed: boolean; trip: { id: number } }>(`/${accepted.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      idempotencyKey: replayKey,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-05T08:00:00+07:00',
        plannedEndAt: '2026-08-05T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resourcesA.truck.id,
        driverId: resourcesA.driver.id,
        trailerId: resourcesA.trailer.id,
      },
    });
    assert.equal(replayed.status, 200);
    assert.equal(replayed.data.replayed, true);
    assert.equal(replayed.data.trip.id, firstDispatch.data.trip.id);

    const reassigned = await apiFetch<{
      version: number;
      trip: { id: number };
      replayed: boolean;
    }>(`/${accepted.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: firstDispatch.data.version,
        plannedStartAt: '2026-08-05T09:00:00+07:00',
        plannedEndAt: '2026-08-05T13:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resourcesB.truck.id,
        driverId: resourcesB.driver.id,
        trailerId: resourcesB.trailer.id,
      },
    });
    assert.equal(reassigned.status, 201);
    assert.equal(reassigned.data.replayed, false);
    assert.equal(reassigned.data.trip.id, firstDispatch.data.trip.id);

    const notifications = await db.select({
      userId: s.notifications.userId,
      relatedEntityId: s.notifications.relatedEntityId,
    }).from(s.notifications).where(and(
      eq(s.notifications.type, 'TRIP_DISPATCHED'),
      eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
      eq(s.notifications.relatedEntityId, accepted.fulfillmentId),
      inArray(s.notifications.userId, [resourcesA.driverUser.id, resourcesB.driverUser.id]),
    ));
    assert.equal(notifications.length, 2);
    assert.deepEqual(
      [...new Set(notifications.map((row) => row.userId))].sort((a, b) => a - b),
      [resourcesA.driverUser.id, resourcesB.driverUser.id].sort((a, b) => a - b),
    );

    const audits = await db.select({
      id: s.auditLogs.id,
      entityId: s.auditLogs.entityId,
      payload: s.auditLogs.payload,
    }).from(s.auditLogs)
      .where(and(
        eq(s.auditLogs.userId, managerUserId),
        eq(s.auditLogs.entityId, accepted.shipmentId),
      ))
      .orderBy(desc(s.auditLogs.id));
    const dispatchAudits = audits.filter((row) => (row.payload as { event?: string } | null)?.event === 'SHIPMENT_DISPATCHED');
    assert.ok(dispatchAudits.length >= 2);
  });

  test('loads a 500-task queue within query budget and latency target while 55 vehicles exist', async (t) => {
    const customer = await createCustomer(`Perf customer ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const containerType = await createContainerType(`40P${createdContainerTypeIds.length}`);
    for (let index = 0; index < 55; index += 1) {
      await createOwnedResources({ trailerType: index % 2 === 0 ? '20FT' : '40FT' });
    }

    const shipmentValues: Array<typeof s.shipments.$inferInsert> = Array.from({ length: 500 }, (_, index) => ({
      customerId: customer.id,
      routeId: route.id,
      cargoMode: 'FCL',
      shipmentCode: `DSP-PERF-${suffix}-${index}`,
      bookingRef: `PERF-BOOK-${suffix}-${index}`,
      createdBy: adminUserId,
    }));
    const shipments = await db.insert(s.shipments).values(shipmentValues).returning({
      id: s.shipments.id,
      version: s.shipments.version,
      customerId: s.shipments.customerId,
    });
    createdShipmentIds.push(...shipments.map((shipment) => shipment.id));

    const containerValues: Array<typeof s.shipmentContainers.$inferInsert> = shipments.map((shipment, index) => ({
      shipmentId: shipment.id,
      containerTypeId: containerType.id,
      containerNumber: `PERF${String(index).padStart(7, '0')}`,
      createdBy: adminUserId,
    }));
    const containers = await db.insert(s.shipmentContainers).values(containerValues).returning({
      id: s.shipmentContainers.id,
      shipmentId: s.shipmentContainers.shipmentId,
    });
    const containerByShipmentId = new Map(containers.map((container) => [container.shipmentId, container.id]));

    const fulfillmentValues: Array<typeof s.shipmentFulfillments.$inferInsert> = shipments.map((shipment) => ({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: containerByShipmentId.get(shipment.id) ?? null,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      createdBy: adminUserId,
    }));
    await db.insert(s.shipmentFulfillments).values(fulfillmentValues);
    const handoffValues: Array<typeof s.dispatchHandoffs.$inferInsert> = shipments.map((shipment) => ({
      shipmentId: shipment.id,
      priority: 'NORMAL',
      status: 'ACCEPTED',
      handoffVersion: shipment.version,
      createdBy: adminUserId,
      acceptedBy: managerUserId,
      resolvedAt: new Date('2026-08-01T00:00:00.000Z'),
    }));
    await db.insert(s.dispatchHandoffs).values(handoffValues);

    const statements: string[] = [];
    const originalDebug = client.options.debug;
    client.options.debug = (_connection: number, query: string) => {
      statements.push(query);
      if (typeof originalDebug === 'function') {
        originalDebug(_connection, query, [], []);
      }
    };
    const startedAt = performance.now();
    try {
      const result = await listDispatchQueue({
        actor: {
          userId: managerUserId,
          username: 'dispatch-manager',
          email: null,
          fullName: null,
          role: Role.MANAGER,
        },
        limit: 50,
        q: `PERF-BOOK-${suffix}`,
      });
      const durationMs = performance.now() - startedAt;
      const sqlStatements = statements.filter((query) => !/^begin|^commit/i.test(query.trim()));
      t.diagnostic(`dispatch queue perf: total=${result.page.total} items=${result.items.length} sqlStatements=${sqlStatements.length} durationMs=${durationMs.toFixed(2)}`);
      assert.equal(result.items.length, 50);
      assert.equal(result.page.total, 500);
      assert.ok(durationMs < 1000, `expected dispatch queue load < 1000ms, got ${durationMs.toFixed(2)}ms`);
      assert.ok(sqlStatements.length <= 8, `expected <= 8 SQL statements, got ${sqlStatements.length}`);
    } finally {
      client.options.debug = originalDebug;
    }
  });
});
