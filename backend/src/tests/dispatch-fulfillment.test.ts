import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { NotificationType, Role } from '@tingting/shared';
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
import { notificationUrlForRole } from '../services/notification.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdTrailerIds: number[] = [];
const createdTruckIds: number[] = [];
const createdDriverIds: number[] = [];
const createdAssignmentIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdTripIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let adminUserId = 0;
let managerUserId = 0;
let accountantUserId = 0;
let managerToken = '';
let accountantToken = '';
let dispatcherToken = '';

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
    code: `${code}-${suffix.slice(-6)}-${createdContainerTypeIds.length}`.slice(0, 20),
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
    status: 'READY_FOR_DISPATCH',
    closingAt: new Date('2026-08-05T08:00:00.000Z'),
    createdBy: args.createdBy,
  }).returning();
  createdShipmentIds.push(shipment.id);

  const containerType = await createContainerType(`20G${createdContainerTypeIds.length}`);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    routeId: args.routeId,
    containerTypeId: containerType.id,
    containerNumber: `MSCU${String(100000 + shipment.id).slice(-6)}1`,
    cargoWeightKg: args.containerCargoWeightKg ?? null,
    createdBy: args.createdBy,
  }).returning();

  return { shipment, container };
}

async function createOwnedResources(options: { trailerType?: '20FT' | '40FT' | null } = {}) {
  const trailerType = options.trailerType === undefined ? '20FT' : options.trailerType;
  const plateSuffix = `${suffix.slice(-6)}${String(createdTrailerIds.length).padStart(2, '0')}`;
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${plateSuffix}`.slice(0, 20),
    type: trailerType,
    status: 'ACTIVE',
  }).returning();
  createdTrailerIds.push(trailer.id);

  const truckPlateSuffix = `${suffix.slice(-6)}${String(createdTruckIds.length).padStart(2, '0')}`;
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51C-${truckPlateSuffix}`.slice(0, 20),
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
  // Pairing is authoritative on truck_driver_assignments.
  const [assignment] = await db.insert(s.truckDriverAssignments).values({
    truckId: truck.id,
    driverId: driver.id,
    role: 'PRIMARY',
  }).returning();
  createdAssignmentIds.push(assignment.id);

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
  const { shipment, container } = await createShipmentFixture({
    customerId: customer.id,
    routeId: route.id,
    createdBy: adminUserId,
    cargoTypeId: null,
    cargoWeightKg: args.cargoWeightKg,
    containerCargoWeightKg: args.containerCargoWeightKg,
  });
  await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
    plannedCarrierType: 'OWN',
    createdBy: adminUserId,
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
  const dispatcher = await mkUser(Role.DISPATCHER, 'dispatcher');
  adminUserId = admin.id;
  managerUserId = manager.id;
  accountantUserId = accountant.id;
  managerToken = signToken(manager);
  accountantToken = signToken(accountant);
  dispatcherToken = signToken(dispatcher);
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
    if (createdAssignmentIds.length > 0) await db.delete(s.truckDriverAssignments).where(inArray(s.truckDriverAssignments.id, createdAssignmentIds));
    if (createdDriverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    if (createdTruckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    if (createdTrailerIds.length > 0) await db.delete(s.trailers).where(inArray(s.trailers.id, createdTrailerIds));
    if (createdContainerTypeIds.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdCustomerIds.length > 0) await db.delete(s.carrierFleetVehicles).where(inArray(s.carrierFleetVehicles.carrierId, createdCustomerIds));
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
  test('dedicated dispatcher can mark handoff seen and accept it into fulfillments', async () => {
    const customer = await createCustomer(`Seen customer ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const { shipment, container } = await createShipmentFixture({
      customerId: customer.id,
      routeId: route.id,
      createdBy: adminUserId,
      cargoTypeId: null,
    });
    await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      plannedCarrierType: 'OWN',
      createdBy: adminUserId,
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
        token: dispatcherToken,
        body: { resolution: 'SEEN', expectedVersion: handoff.version },
      },
    );
    assert.equal(seen.status, 200, JSON.stringify(seen.data));
    assert.equal(seen.data.status, 'SEEN');

    const accepted = await apiFetch<{
      handoff: { status: string };
      fulfillments: Array<{ id: number; shipmentContainerId: number | null }>;
    }>(`/${shipment.id}/dispatch-handoffs/${handoff.id}/resolve`, {
      method: 'POST',
      token: dispatcherToken,
      body: { resolution: 'ACCEPTED', expectedVersion: seen.data.version },
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal(accepted.data.handoff.status, 'ACCEPTED');
    assert.equal(accepted.data.fulfillments.length, 1);
    assert.ok(accepted.data.fulfillments[0]!.shipmentContainerId != null);
  });

  test('accept rejects a partial pre-existing FCL fulfillment set', async () => {
    const customer = await createCustomer(`Partial customer ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const { shipment, container } = await createShipmentFixture({
      customerId: customer.id,
      routeId: route.id,
      createdBy: adminUserId,
      cargoTypeId: null,
    });
    const extraType = await createContainerType(`40P${createdContainerTypeIds.length}`);
    await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: extraType.id,
      containerNumber: `MSCU${String(200000 + shipment.id).slice(-6)}2`,
      createdBy: adminUserId,
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

    await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      createdBy: adminUserId,
    });

    const accepted = await apiFetch<{ error?: string }>(`/${shipment.id}/dispatch-handoffs/${handoff.id}/resolve`, {
      method: 'POST',
      token: managerToken,
      body: { resolution: 'ACCEPTED', expectedVersion: handoff.version },
    });

    assert.equal(accepted.status, 409);
    assert.match(accepted.data.error ?? '', /container/i);
    const activeRows = await db.select({
      shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
    }).from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.shipmentId, shipment.id));
    assert.deepEqual(activeRows.map((row) => row.shipmentContainerId), [container.id]);
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

    const notifications = await db.select({
      userId: s.notifications.userId,
    }).from(s.notifications).where(and(
      eq(s.notifications.type, 'TRIP_DISPATCHED'),
      eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
      eq(s.notifications.relatedEntityId, accepted.fulfillmentId),
    ));
    assert.deepEqual(
      [...new Set(notifications.map((row) => row.userId))].sort((a, b) => a - b),
      [resources.driverUser.id],
    );
    assert.equal(
      notificationUrlForRole({
        type: NotificationType.TRIP_DISPATCHED,
        title: 'Điều phối chuyến',
        message: 'Tài xế đã được phân công',
        relatedEntityType: 'shipment_fulfillments',
        relatedEntityId: accepted.fulfillmentId,
        targetDriverId: resources.driver.id,
      }, Role.DRIVER),
      `/my-trips/${accepted.fulfillmentId}`,
    );
  });

  test('dispatch succeeds when trailer type is unrecorded (master-data import leaves it blank)', async () => {
    const accepted = await createAcceptedFulfillment();
    const resources = await createOwnedResources({ trailerType: null });

    const dispatch = await apiFetch<{
      trip: { id: number; trailerId: number | null };
    }>(`/${accepted.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-01T09:00:00+07:00',
        plannedEndAt: '2026-08-01T13:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(dispatch.status, 201);
    assert.equal(dispatch.data.trip.trailerId, resources.trailer.id);
    createdTripIds.push(dispatch.data.trip.id);
  });

  test('external carrier dispatch creates no internal notification or push claim', async () => {
    const accepted = await createAcceptedFulfillment();
    const externalCarrier = await createCustomer(`External carrier ${suffix}-${createdCustomerIds.length}`);
    await db.update(s.customers).set({ isCarrier: true }).where(eq(s.customers.id, externalCarrier.id));
    const [carrierVehicle] = await db.insert(s.carrierFleetVehicles).values({
      carrierId: externalCarrier.id,
      licensePlate: '51H-12345',
      normalizedPlate: '51H12345',
      createdBy: adminUserId,
    }).returning();
    await db.update(s.shipmentFulfillments).set({
      plannedCarrierType: 'EXTERNAL',
      plannedExternalCarrierId: externalCarrier.id,
    }).where(eq(s.shipmentFulfillments.id, accepted.fulfillmentId));

    const dispatch = await apiFetch<{
      notification: { deliveredInApp: boolean; pushAttempted: boolean };
      trip: { id: number; externalCarrierId: number | null; driverId: number | null };
    }>(`/${accepted.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-01T13:00:00+07:00',
        plannedEndAt: '2026-08-01T17:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'EXTERNAL',
        externalCarrierId: externalCarrier.id,
        externalCarrierVehicleId: carrierVehicle.id,
        externalDriverName: 'Tài xế ngoài',
      },
    });

    assert.equal(dispatch.status, 201);
    createdTripIds.push(dispatch.data.trip.id);
    assert.equal(dispatch.data.trip.externalCarrierId, externalCarrier.id);
    assert.equal(dispatch.data.trip.driverId, null);
    assert.equal(dispatch.data.notification.deliveredInApp, false);
    assert.equal(dispatch.data.notification.pushAttempted, false);

    const notifications = await db.select({
      userId: s.notifications.userId,
    }).from(s.notifications).where(and(
      eq(s.notifications.type, 'TRIP_DISPATCHED'),
      eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
      eq(s.notifications.relatedEntityId, accepted.fulfillmentId),
    ));
    assert.equal(notifications.length, 0);
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

    const fleetForbidden = await apiFetch<{ error?: string }>('/dispatch-fleet?resource=TRUCK', {
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

  test('dispatch handoffs use flat cursor pagination with scope-bound cursors and status-filter totals', async () => {
    const customer = await createCustomer(`Handoff cursor ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const shipments = [];
    for (let index = 0; index < 3; index += 1) {
      shipments.push(await createShipmentFixture({
        customerId: customer.id,
        routeId: route.id,
        createdBy: adminUserId,
        cargoTypeId: null,
      }));
    }
    const handoffs = [];
    for (const { shipment } of shipments) {
      handoffs.push(await createHandoff({
        shipmentId: shipment.id,
        createdBy: adminUserId,
        actor: {
          userId: adminUserId,
          username: `dispatch-admin-${suffix}`,
          email: null,
          fullName: null,
          role: Role.ADMIN,
        },
      }));
    }
    const seenResponse = await apiFetch<{ handoff: { status: string } }>(
      `/${shipments[0]!.shipment.id}/dispatch-handoffs/${handoffs[0]!.id}/resolve`,
      {
        method: 'POST',
        token: managerToken,
        body: { resolution: 'SEEN', expectedVersion: handoffs[0]!.version },
      },
    );
    assert.equal(seenResponse.status, 200);

    const firstPage = await apiFetch<{
      items: Array<{ handoffId: number; shipmentId: number }>;
      total: number;
      limit: number;
      nextCursor: string | null;
      unseenCount: number;
      seenCount: number;
      page?: unknown;
    }>(`/dispatch-handoffs?limit=1&q=${encodeURIComponent(customer.name)}`, {
      token: managerToken,
    });
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.data.limit, 1);
    assert.equal(firstPage.data.total, 3);
    assert.equal(firstPage.data.unseenCount, 2);
    assert.equal(firstPage.data.seenCount, 1);
    assert.equal(firstPage.data.page, undefined);
    assert.equal(firstPage.data.items.length, 1);
    assert.equal(typeof firstPage.data.nextCursor, 'string');

    const secondPage = await apiFetch<{
      items: Array<{ handoffId: number }>;
      total: number;
      nextCursor: string | null;
    }>(`/dispatch-handoffs?limit=1&q=${encodeURIComponent(customer.name)}&cursor=${encodeURIComponent(firstPage.data.nextCursor ?? '')}`, {
      token: managerToken,
    });
    assert.equal(secondPage.status, 200);
    assert.equal(secondPage.data.total, 3);
    assert.equal(secondPage.data.items.length, 1);
    assert.equal(typeof secondPage.data.nextCursor, 'string');

    const thirdPage = await apiFetch<{
      items: Array<{ handoffId: number }>;
      total: number;
      nextCursor: string | null;
    }>(`/dispatch-handoffs?limit=1&q=${encodeURIComponent(customer.name)}&cursor=${encodeURIComponent(secondPage.data.nextCursor ?? '')}`, {
      token: managerToken,
    });
    assert.equal(thirdPage.status, 200);
    assert.equal(thirdPage.data.total, 3);
    assert.equal(thirdPage.data.items.length, 1);
    assert.equal(thirdPage.data.nextCursor, null);

    const traversedHandoffIds = [
      ...firstPage.data.items,
      ...secondPage.data.items,
      ...thirdPage.data.items,
    ].map((item) => item.handoffId);
    assert.equal(new Set(traversedHandoffIds).size, traversedHandoffIds.length);
    assert.deepEqual([...traversedHandoffIds].sort((a, b) => a - b), handoffs.map((handoff) => handoff.id).sort((a, b) => a - b));

    const unseenOnly = await apiFetch<{
      total: number;
      unseenCount: number;
      seenCount: number;
      items: Array<{ handoffId: number }>;
    }>(`/dispatch-handoffs?limit=10&q=${encodeURIComponent(customer.name)}&status=UNSEEN`, {
      token: managerToken,
    });
    assert.equal(unseenOnly.status, 200);
    assert.equal(unseenOnly.data.total, 2);
    assert.equal(unseenOnly.data.unseenCount, 2);
    assert.equal(unseenOnly.data.seenCount, 1);
    assert.equal(unseenOnly.data.items.length, 2);

    const malformedCursor = await apiFetch<{ error?: string }>('/dispatch-handoffs?cursor=not-a-valid-cursor', {
      token: managerToken,
    });
    assert.equal(malformedCursor.status, 400);
    assert.match(malformedCursor.data.error ?? '', /cursor không hợp lệ/i);

    const wrongScopeCursor = await apiFetch<{ error?: string }>(`/dispatch-queue?cursor=${encodeURIComponent(firstPage.data.nextCursor ?? '')}`, {
      token: managerToken,
    });
    assert.equal(wrongScopeCursor.status, 400);
    assert.match(wrongScopeCursor.data.error ?? '', /cursor không hợp lệ/i);
  });

  test('dispatch queue uses flat cursor pagination with scope-bound cursors and status-filter totals', async () => {
    const customer = await createCustomer(`Queue cursor ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const readyA = await createAcceptedFulfillment({ customerId: customer.id, routeId: route.id });
    const readyB = await createAcceptedFulfillment({ customerId: customer.id, routeId: route.id });
    const dispatched = await createAcceptedFulfillment({ customerId: customer.id, routeId: route.id });
    const resources = await createOwnedResources();

    const dispatch = await apiFetch<{ trip: { id: number } }>(`/${dispatched.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: dispatched.fulfillmentId,
        expectedVersion: dispatched.fulfillmentVersion,
        plannedStartAt: '2026-08-02T09:00:00+07:00',
        plannedEndAt: '2026-08-02T11:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(dispatch.status, 201);
    createdTripIds.push(dispatch.data.trip.id);

    const firstPage = await apiFetch<{
      items: Array<{ fulfillmentId: number; taskStatus: string }>;
      total: number;
      limit: number;
      nextCursor: string | null;
      readyCount: number;
      dispatchedCount: number;
      page?: unknown;
    }>(`/dispatch-queue?limit=1&status=READY&q=${encodeURIComponent(customer.name)}`, {
      token: managerToken,
    });
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.data.page, undefined);
    assert.equal(firstPage.data.limit, 1);
    assert.equal(firstPage.data.total, 2);
    assert.equal(firstPage.data.readyCount, 2);
    assert.equal(firstPage.data.dispatchedCount, 1);
    assert.equal(firstPage.data.items.length, 1);
    assert.equal(firstPage.data.items[0]?.taskStatus, 'READY');
    assert.equal(typeof firstPage.data.nextCursor, 'string');

    const secondPage = await apiFetch<{
      items: Array<{ fulfillmentId: number; taskStatus: string }>;
      total: number;
      nextCursor: string | null;
      readyCount: number;
      dispatchedCount: number;
    }>(`/dispatch-queue?limit=1&status=READY&q=${encodeURIComponent(customer.name)}&cursor=${encodeURIComponent(firstPage.data.nextCursor ?? '')}`, {
      token: managerToken,
    });
    assert.equal(secondPage.status, 200);
    assert.equal(secondPage.data.total, 2);
    assert.equal(secondPage.data.readyCount, 2);
    assert.equal(secondPage.data.dispatchedCount, 1);
    assert.equal(secondPage.data.items.length, 1);
    assert.equal(secondPage.data.items[0]?.taskStatus, 'READY');
    assert.equal(secondPage.data.nextCursor, null);

    const traversedQueueIds = [...firstPage.data.items, ...secondPage.data.items].map((item) => item.fulfillmentId);
    assert.equal(new Set(traversedQueueIds).size, traversedQueueIds.length);
    assert.deepEqual([...traversedQueueIds].sort((a, b) => a - b), [readyA.fulfillmentId, readyB.fulfillmentId].sort((a, b) => a - b));

    const dispatchedOnly = await apiFetch<{
      items: Array<{ fulfillmentId: number; taskStatus: string }>;
      total: number;
      readyCount: number;
      dispatchedCount: number;
    }>(`/dispatch-queue?limit=10&status=DISPATCHED&q=${encodeURIComponent(customer.name)}`, {
      token: managerToken,
    });
    assert.equal(dispatchedOnly.status, 200);
    assert.equal(dispatchedOnly.data.total, 1);
    assert.equal(dispatchedOnly.data.readyCount, 2);
    assert.equal(dispatchedOnly.data.dispatchedCount, 1);
    assert.equal(dispatchedOnly.data.items.length, 1);
    assert.equal(dispatchedOnly.data.items[0]?.fulfillmentId, dispatched.fulfillmentId);
    assert.equal(dispatchedOnly.data.items[0]?.taskStatus, 'DISPATCHED');

    const malformedCursor = await apiFetch<{ error?: string }>('/dispatch-queue?cursor=not-a-valid-cursor', {
      token: managerToken,
    });
    assert.equal(malformedCursor.status, 400);
    assert.match(malformedCursor.data.error ?? '', /cursor không hợp lệ/i);

  });

  test('dispatch queue excludes a legacy accepted FCL fulfillment when its container has no route', async () => {
    const customer = await createCustomer(`Route-less queue ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const legacy = await createAcceptedFulfillment({ customerId: customer.id, routeId: route.id });
    await db.update(s.shipments)
      .set({ routeId: route.id })
      .where(eq(s.shipments.id, legacy.shipmentId));
    await db.update(s.shipmentContainers)
      .set({ routeId: null })
      .where(eq(s.shipmentContainers.shipmentId, legacy.shipmentId));

    const response = await apiFetch<{
      items: Array<{ fulfillmentId: number; route: { id: number; name: string } }>;
      total: number;
      readyCount: number;
      dispatchedCount: number;
    }>(`/dispatch-queue?limit=10&q=${encodeURIComponent(customer.name)}`, {
      token: managerToken,
    });

    assert.equal(response.status, 200);
    assert.equal(response.data.total, 0);
    assert.equal(response.data.readyCount, 0);
    assert.equal(response.data.dispatchedCount, 0);
    assert.equal(response.data.items.length, 0);
  });

  test('dispatch fleet resources use flat cursor pagination with resource-bound cursors and unaccented search', async () => {
    const countToken = `CNT${suffix.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}`;
    const trailers = await db.insert(s.trailers).values(Array.from({ length: 3 }, (_, index) => ({
      licensePlate: `51R-${countToken}${index}`.slice(0, 20),
      type: '20FT' as const,
      status: 'ACTIVE' as const,
    }))).returning({ id: s.trailers.id });
    createdTrailerIds.push(...trailers.map((trailer) => trailer.id));

    const trucks = await db.insert(s.trucks).values(Array.from({ length: 3 }, (_, index) => ({
      licensePlate: `${countToken}-TRUCK-${index}`,
      status: 'ACTIVE' as const,
      trailerType: '20FT' as const,
      currentTrailerId: trailers[index]!.id,
    }))).returning({ id: s.trucks.id });
    createdTruckIds.push(...trucks.map((truck) => truck.id));

    const drivers = await db.insert(s.drivers).values(Array.from({ length: 3 }, (_, index) => ({
      name: `${countToken} Tài xế Ánh ${index}`,
      status: 'ACTIVE' as const,
      assignedTruckId: trucks[index]!.id,
    }))).returning({ id: s.drivers.id });
    createdDriverIds.push(...drivers.map((driver) => driver.id));
    // Pairing is authoritative on truck_driver_assignments.
    const assignments = await db.insert(s.truckDriverAssignments).values(drivers.map((driver, index) => ({
      truckId: trucks[index]!.id,
      driverId: driver.id,
      role: 'PRIMARY',
    }))).returning({ id: s.truckDriverAssignments.id });
    createdAssignmentIds.push(...assignments.map((assignment) => assignment.id));

    const carriers = await db.insert(s.customers).values(Array.from({ length: 3 }, (_, index) => ({
      name: `${countToken} Nhà xe Ánh ${index}`,
      isCarrier: true,
    }))).returning({ id: s.customers.id });
    createdCustomerIds.push(...carriers.map((carrier) => carrier.id));

    const response = await apiFetch<{
      items: Array<{ id: number; assignedDriverId: number | null; assignedDriverName: string | null }>;
      total: number;
      limit: number;
      nextCursor: string | null;
      page?: unknown;
    }>(`/dispatch-fleet?resource=TRUCK&limit=1&q=${encodeURIComponent(countToken)}`, {
      token: managerToken,
    });

    assert.equal(response.status, 200);
    assert.equal(response.data.page, undefined);
    assert.equal(response.data.items.length, 1);
    assert.equal(response.data.total, 3);
    assert.equal(response.data.limit, 1);
    assert.equal(response.data.items[0]?.assignedDriverId, drivers[0]!.id);
    assert.equal(response.data.items[0]?.assignedDriverName, `${countToken} Tài xế Ánh 0`);
    assert.equal(typeof response.data.nextCursor, 'string');

    const secondTruckPage = await apiFetch<{
      items: Array<{ id: number }>;
      total: number;
      nextCursor: string | null;
    }>(`/dispatch-fleet?resource=TRUCK&limit=1&q=${encodeURIComponent(countToken)}&cursor=${encodeURIComponent(response.data.nextCursor ?? '')}`, {
      token: managerToken,
    });
    assert.equal(secondTruckPage.status, 200);
    assert.equal(secondTruckPage.data.total, 3);
    assert.equal(secondTruckPage.data.items.length, 1);
    assert.equal(typeof secondTruckPage.data.nextCursor, 'string');

    const thirdTruckPage = await apiFetch<{
      items: Array<{ id: number }>;
      total: number;
      nextCursor: string | null;
    }>(`/dispatch-fleet?resource=TRUCK&limit=1&q=${encodeURIComponent(countToken)}&cursor=${encodeURIComponent(secondTruckPage.data.nextCursor ?? '')}`, {
      token: managerToken,
    });
    assert.equal(thirdTruckPage.status, 200);
    assert.equal(thirdTruckPage.data.total, 3);
    assert.equal(thirdTruckPage.data.items.length, 1);
    assert.equal(thirdTruckPage.data.nextCursor, null);
    const traversedTruckIds = [...response.data.items, ...secondTruckPage.data.items, ...thirdTruckPage.data.items].map((item) => item.id);
    assert.equal(new Set(traversedTruckIds).size, traversedTruckIds.length);
    assert.deepEqual([...traversedTruckIds].sort((a, b) => a - b), trucks.map((truck) => truck.id).sort((a, b) => a - b));

    const driverSearch = await apiFetch<{
      items: Array<{ id: number; name: string }>;
      total: number;
      limit: number;
      nextCursor: string | null;
    }>(`/dispatch-fleet?resource=DRIVER&limit=1&q=${encodeURIComponent(`${countToken} tai xe anh`)}`, {
      token: managerToken,
    });
    assert.equal(driverSearch.status, 200);
    assert.equal(driverSearch.data.total, 3);
    assert.equal(driverSearch.data.limit, 1);
    assert.equal(driverSearch.data.items.length, 1);
    assert.equal(driverSearch.data.items[0]?.id, drivers[0]!.id);
    assert.equal(typeof driverSearch.data.nextCursor, 'string');

    const nextDriverPage = await apiFetch<{
      items: Array<{ id: number }>;
      total: number;
      nextCursor: string | null;
    }>(`/dispatch-fleet?resource=DRIVER&limit=1&q=${encodeURIComponent(`${countToken} tai xe anh`)}&cursor=${encodeURIComponent(driverSearch.data.nextCursor ?? '')}`, {
      token: managerToken,
    });
    assert.equal(nextDriverPage.status, 200);
    assert.equal(nextDriverPage.data.total, 3);
    assert.equal(nextDriverPage.data.items.length, 1);
    assert.notEqual(nextDriverPage.data.items[0]?.id, driverSearch.data.items[0]?.id);

    const carrierSearch = await apiFetch<{
      items: Array<{ id: number }>;
      total: number;
      nextCursor: string | null;
    }>(`/dispatch-fleet?resource=EXTERNAL_CARRIER&limit=2&q=${encodeURIComponent(`${countToken} nha xe anh`)}`, {
      token: managerToken,
    });
    assert.equal(carrierSearch.status, 200);
    assert.equal(carrierSearch.data.total, 3);
    assert.equal(carrierSearch.data.items.length, 2);
    assert.equal(typeof carrierSearch.data.nextCursor, 'string');

    const [inactiveCarrier] = await db.insert(s.customers).values({
      name: `${countToken} Nhà xe ngừng hoạt động`,
      isCarrier: true,
      status: 'LOCKED',
    }).returning({ id: s.customers.id });
    createdCustomerIds.push(inactiveCarrier!.id);
    await db.insert(s.carrierFleetVehicles).values({
      carrierId: inactiveCarrier!.id,
      licensePlate: `${countToken}-INACTIVE`,
      normalizedPlate: `${countToken}INACTIVE`,
    });

    const inactiveCarrierVehicles = await apiFetch<{
      items: Array<{ id: number }>;
      total: number;
      nextCursor: string | null;
    }>(`/dispatch-fleet?resource=EXTERNAL_VEHICLE&carrierId=${inactiveCarrier!.id}`, {
      token: managerToken,
    });
    assert.equal(inactiveCarrierVehicles.status, 200);
    assert.deepEqual(inactiveCarrierVehicles.data.items, []);
    assert.equal(inactiveCarrierVehicles.data.total, 0);
    assert.equal(inactiveCarrierVehicles.data.nextCursor, null);

    const removedCarrierVehicles = await apiFetch<{
      items: Array<{ id: number }>;
      total: number;
      nextCursor: string | null;
    }>('/dispatch-fleet?resource=EXTERNAL_VEHICLE&carrierId=999999999', {
      token: managerToken,
    });
    assert.equal(removedCarrierVehicles.status, 200);
    assert.deepEqual(removedCarrierVehicles.data.items, []);
    assert.equal(removedCarrierVehicles.data.total, 0);
    assert.equal(removedCarrierVehicles.data.nextCursor, null);

    const malformedCursor = await apiFetch<{ error?: string }>('/dispatch-fleet?resource=TRUCK&cursor=not-a-valid-cursor', {
      token: managerToken,
    });
    assert.equal(malformedCursor.status, 400);
    assert.match(malformedCursor.data.error ?? '', /cursor không hợp lệ/i);

    const crossResourceCursor = await apiFetch<{ error?: string }>(`/dispatch-fleet?resource=DRIVER&cursor=${encodeURIComponent(response.data.nextCursor ?? '')}`, {
      token: managerToken,
    });
    assert.equal(crossResourceCursor.status, 400);
    assert.match(crossResourceCursor.data.error ?? '', /cursor không hợp lệ/i);
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
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-05T08:00:00.000Z'),
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
      routeId: route.id,
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
      plannedCarrierType: 'OWN',
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
      t.diagnostic(`dispatch queue perf: total=${result.total} items=${result.items.length} sqlStatements=${sqlStatements.length} durationMs=${durationMs.toFixed(2)}`);
      assert.equal(result.items.length, 50);
      assert.equal(result.total, 500);
      assert.ok(durationMs < 1000, `expected dispatch queue load < 1000ms, got ${durationMs.toFixed(2)}ms`);
      assert.ok(sqlStatements.length <= 8, `expected <= 8 SQL statements, got ${sqlStatements.length}`);
    } finally {
      client.options.debug = originalDebug;
    }
  });

  // Regression 2026-09-05: listDispatchQueue and listDispatchDetailPlanRows
  // used to filter shipments to ['READY_FOR_DISPATCH', 'DISPATCHED'] only. A
  // container completing its trip advances the shipment status past
  // DISPATCHED (IN_TRANSIT / PENDING_EXPENSE_APPROVAL / COMPLETED), which
  // silently dropped the row (and, for a multi-container lot, every sibling
  // fulfillment) from both dispatcher screens. Fixed in 4572173b by widening
  // the status filter; these tests pin that filter so it cannot regress.
  test('dispatch queue keeps a fully completed single-container shipment visible (regression 2026-09-05)', async () => {
    const customer = await createCustomer(`Completed lot ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const accepted = await createAcceptedFulfillment({ customerId: customer.id, routeId: route.id });
    const resources = await createOwnedResources();

    const dispatch = await apiFetch<{ trip: { id: number } }>(`/${accepted.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-06T08:00:00+07:00',
        plannedEndAt: '2026-08-06T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(dispatch.status, 201);
    createdTripIds.push(dispatch.data.trip.id);

    // Simulate the driver finishing the lot's only container: trip completes
    // and the shipment status advances beyond DISPATCHED.
    await db.update(s.trips).set({ status: 'COMPLETED' }).where(eq(s.trips.id, dispatch.data.trip.id));
    await db.update(s.shipments).set({ status: 'COMPLETED' }).where(eq(s.shipments.id, accepted.shipmentId));

    const queue = await apiFetch<{ items: Array<{ shipmentId: number; fulfillmentId: number; taskStatus: string }> }>(
      `/dispatch-queue?limit=10&q=${encodeURIComponent(customer.name)}`,
      { token: managerToken },
    );
    assert.equal(queue.status, 200);
    assert.equal(queue.data.items.length, 1);
    assert.equal(queue.data.items[0]?.shipmentId, accepted.shipmentId);
    assert.equal(queue.data.items[0]?.fulfillmentId, accepted.fulfillmentId);
  });

  test('dispatch detail plan keeps every container visible when only one of a multi-container lot has completed (regression 2026-09-05)', async () => {
    const customer = await createCustomer(`Partial completion ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const accepted = await createAcceptedFulfillment({ customerId: customer.id, routeId: route.id });

    // Second container on the SAME shipment/lot — mirrors an FCL booking with
    // more than one container, added directly (bypassing the handoff-accept
    // flow, which is exercised elsewhere) since only the row-visibility query
    // is under test here.
    const containerTypeB = await createContainerType(`40Q${createdContainerTypeIds.length}`);
    const [shipmentRow] = await db.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, accepted.shipmentId));
    const [containerB] = await db.insert(s.shipmentContainers).values({
      shipmentId: accepted.shipmentId,
      containerTypeId: containerTypeB.id,
      containerNumber: `MSCU${String(300000 + accepted.shipmentId).slice(-6)}2`,
      createdBy: adminUserId,
    }).returning();
    const [fulfillmentB] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: accepted.shipmentId,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: containerB!.id,
      sourceShipmentVersion: shipmentRow!.version,
      siteSnapshot: {},
      plannedCarrierType: 'OWN',
      createdBy: adminUserId,
    }).returning();

    const resources = await createOwnedResources();
    const dispatch = await apiFetch<{ trip: { id: number } }>(`/${accepted.shipmentId}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-06T08:00:00+07:00',
        plannedEndAt: '2026-08-06T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(dispatch.status, 201);
    createdTripIds.push(dispatch.data.trip.id);

    // Container A completes; container B's fulfillment never got a trip. The
    // shipment status advances past DISPATCHED — before the fix this hid the
    // WHOLE lot (both fulfillments), stranding container B.
    await db.update(s.trips).set({ status: 'COMPLETED' }).where(eq(s.trips.id, dispatch.data.trip.id));
    await db.update(s.shipments).set({ status: 'IN_TRANSIT' }).where(eq(s.shipments.id, accepted.shipmentId));

    const detail = await apiFetch<{ items: Array<{ fulfillmentId: number; taskStatus: string }> }>(
      `/dispatch-detail-plan-rows?limit=10&q=${encodeURIComponent(customer.name)}`,
      { token: managerToken },
    );
    assert.equal(detail.status, 200);
    const byFulfillmentId = new Map(detail.data.items.map((item) => [item.fulfillmentId, item]));
    assert.ok(byFulfillmentId.has(accepted.fulfillmentId), 'completed container must stay visible');
    assert.ok(byFulfillmentId.has(fulfillmentB!.id), 'sibling pending container must stay visible');
    assert.equal(byFulfillmentId.get(accepted.fulfillmentId)?.taskStatus, 'DISPATCHED');
    assert.equal(byFulfillmentId.get(fulfillmentB!.id)?.taskStatus, 'READY');
  });
});
