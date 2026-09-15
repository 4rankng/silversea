import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray , isNull } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { Role , calculateCheckDigit, DriverProgressEventType } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import shipmentRoutes from '../routes/shipments';
import driverRoutes from '../routes/driver';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdPortIds: number[] = [];
const createdTrailerIds: number[] = [];
const createdTruckIds: number[] = [];
const createdDriverIds: number[] = [];
const createdAssignmentIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdTripIds: number[] = [];
const createdSiteIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let adminUserId = 0;
let dispatcherToken = '';
let clerkToken = '';
let driverToken = '';

type ApiResponse<T> = {
  status: number;
  data: T;
};

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `detail-${tag}-${suffix}-${createdUserIds.length}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

function signToken(
  user: { id: number; username: string | null; role: Role | string },
) {
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
      ?? `detail-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const response = await fetch(`${baseUrl}/api/shipments${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({})) as T;
  return { status: response.status, data };
}

async function createCustomer(name: string, isCarrier = false) {
  const [customer] = await db.insert(s.customers).values({
    name,
    isCarrier,
    status: 'ACTIVE',
  }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function createRoute() {
  const [route] = await db.insert(s.routes).values({
    name: `Detail route ${suffix}-${createdRouteIds.length}`,
  }).returning();
  createdRouteIds.push(route.id);
  return route;
}

async function createContainerType(code: string) {
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `${code}-${suffix.slice(-6)}-${createdContainerTypeIds.length}`.slice(0, 20),
    name: `Detail container ${code} ${suffix}-${createdContainerTypeIds.length}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  return containerType;
}

async function createOperationalSite(customerId: number) {
  const [site] = await db.insert(s.operationalSites).values({
    customerId,
    code: `SITE-${suffix.slice(-6)}-${createdSiteIds.length}`.slice(0, 80),
    name: `Nhà máy ${suffix}-${createdSiteIds.length}`,
    siteType: 'FACTORY',
    address: `Địa chỉ ${suffix}-${createdSiteIds.length}`,
  }).returning();
  createdSiteIds.push(site.id);
  return site;
}

// Multi-container FCL lot with all fulfillments carrier-allocated. No handoff
// needed — the detail-plan grid rows exist from carrier allocation alone.
async function createAllocatedLot(args: {
  carrierType: 'OWN' | 'EXTERNAL' | null;
  externalCarrierId?: number | null;
  containerCount?: number;
  isCombined?: boolean;
}) {
  const customer = await createCustomer(`Detail customer ${suffix}-${createdCustomerIds.length}`);
  const route = await createRoute();
  const site = await createOperationalSite(customer.id);
  const containerCount = args.containerCount ?? 1;
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    isCombined: args.isCombined ?? false,
    shipmentCode: `DTL-${suffix}-${createdShipmentIds.length}`,
    bookingRef: `BOOK-${suffix}-${createdShipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    closingAt: new Date('2026-08-20T08:00:00.000Z'),
    tradeDirection: 'EXPORT',
    operationalSiteId: site.id,
    operationalNotes: 'Ghi chú điều xe',
    customerNotes: 'Ghi chú khách',
    createdBy: adminUserId,
  }).returning();
  createdShipmentIds.push(shipment.id);

  const containerType = await createContainerType(`20G${createdContainerTypeIds.length}`);
  const [pickupPort] = await db.insert(s.ports).values({ name: `Detail pickup port ${suffix}-${createdShipmentIds.length}` }).returning();
  const [dropoffPort] = await db.insert(s.ports).values({ name: `Detail dropoff port ${suffix}-${createdShipmentIds.length}` }).returning();
  createdPortIds.push(pickupPort.id, dropoffPort.id);
  const fulfillmentIds: number[] = [];
  for (let index = 0; index < containerCount; index += 1) {
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: containerType.id,
      containerNumber: `MSCU${String(300000 + shipment.id).slice(-6)}${index}`,
      routeId: route.id,
      pickupPortId: pickupPort.id,
      dropoffPortId: dropoffPort.id,
      customerAppointmentAt: new Date('2026-08-20T08:00:00.000Z'),
      createdBy: adminUserId,
    }).returning();
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {
        deliverySite: { id: site.id, name: site.name, address: site.address },
      },
      plannedCarrierType: args.carrierType,
      plannedExternalCarrierId: args.carrierType === 'EXTERNAL' ? args.externalCarrierId ?? null : null,
      createdBy: adminUserId,
    }).returning();
    fulfillmentIds.push(fulfillment.id);
  }

  return { shipment, fulfillmentIds, customer, site, route };
}

async function createOwnedTruckWithDriver() {
  const plateSuffix = `${suffix.slice(-6)}${String(createdTruckIds.length).padStart(2, '0')}`;
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${plateSuffix}`.slice(0, 20),
    type: '20FT',
    status: 'ACTIVE',
  }).returning();
  createdTrailerIds.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51C-${plateSuffix}`.slice(0, 20),
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
  // Driver<->truck pairing is authoritative on truck_driver_assignments;
  // the legacy column above stays only to keep seeding realistic.
  const [assignment] = await db.insert(s.truckDriverAssignments).values({
    truckId: truck.id,
    driverId: driver.id,
    role: 'PRIMARY',
  }).returning();
  createdAssignmentIds.push(assignment.id);
  return { truck, driver };
}

type DetailPlanRow = {
  fulfillmentId: number;
  version: number;
  shipmentContainerId: number | null;
  shipmentId: number;
  shipmentCode: string | null;
  isCombined: boolean;
  cargoMode: 'FCL' | 'LCL';
  taskStatus: 'READY' | 'DISPATCHED' | 'COMPLETED';
  time: { deliveryDate: string | null; runAt: string | null; runHour: number | null };
  customerRoute: { customerName: string; factoryName: string | null; deliveryPoint: string | null; routeName: string | null };
  docs: { billNumber: string | null; tradeDirection: string | null; declarationNumbers: string[] };
  container: { containerNumber: string | null; containerTypeLabel: string | null; cargoWeightKg: string | null };
  notes: { vehicleNote: string | null; customerNote: string | null };
  dispatch: {
    // Carrier-less planned rows surface as null — the editor auto-loads the
    // own-fleet truck list for them and promotes via the atomic plan save.
    carrierType: 'OWN' | 'EXTERNAL' | null;
    carrierName: string | null;
    externalCarrierId: number | null;
    externalCarrierVehicleId: number | null;
    assignedPlate: string | null;
    tripId?: number;
    tripStatus?: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELED';
    driverAccepted?: boolean;
  };
  estimates: { plannedRevenue: string | null; plannedCarrierCost: string | null };
  classification: 'SINGLE' | 'DOUBLE' | 'COMBINED' | 'LCL' | null;
  ports: { pickupPortId: number | null; pickupPortName: string | null; dropoffPortId: number | null; dropoffPortName: string | null };
  lotFullyPlated: boolean;
};

type PlateResponse = {
  fulfillmentId: number;
  version: number;
  lotFullyPlated: boolean;
  driverNotified: boolean;
  assignedPlate: string | null;
  assignedDriverId: number | null;
  assignedDriverName: string | null;
  driverHint: string | null;
};

type CarrierResponse = {
  fulfillmentId: number;
  version: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  carrierName: string;
  externalCarrierVehicleId: null;
  assignedPlate: null;
  lotFullyPlated: boolean;
  replayed: boolean;
};

type EstimateResponse = {
  fulfillmentId: number;
  version: number;
  plannedRevenue: string | null;
  plannedCarrierCost: string | null;
};

async function fetchRows(token: string, query = '') {
  const response = await apiFetch<{ items: DetailPlanRow[]; total: number; page: number; pageSize: number }>(
    `/dispatch-detail-plan-rows${query}`,
    { token },
  );
  return response;
}

// Driver-portal fetch for the tap-through repro (notification → open job).
async function driverFetch(path: string, token: string): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${baseUrl}/api/driver/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function countDispatchNotifications(fulfillmentId: number) {
  const notes = await db.select({ id: s.notifications.id, title: s.notifications.title }).from(s.notifications)
    .where(and(
      eq(s.notifications.type, 'TRIP_DISPATCHED'),
      eq(s.notifications.relatedEntityType, 'trips'),
      inArray(
        s.notifications.relatedEntityId,
        db.select({ id: s.trips.id }).from(s.trips).where(eq(s.trips.fulfillmentId, fulfillmentId)),
      ),
    ));
  return notes;
}

before(async () => {
  await initAuditService();
  await initEnforcer();

  // Seed the dispatch-zone taxonomy that requireDispatchZone() validates against.
  // Production `make seed` inserts these; tests need them too because the zone
  // validation rejects unknown codes with 400 instead of falling back to empty
  // results. Idempotent: reactivates any zone left inactive by a prior run.
  const zoneSeeds = [
    { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10, isActive: true },
    { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20, isActive: true },
  ];
  for (const z of zoneSeeds) {
    const [existing] = await db.select().from(s.dispatchZones)
      .where(eq(s.dispatchZones.code, z.code)).limit(1);
    if (existing) {
      await db.update(s.dispatchZones)
        .set({ isActive: true, label: z.label, sortOrder: z.sortOrder })
        .where(eq(s.dispatchZones.id, existing.id));
    } else {
      await db.insert(s.dispatchZones).values(z);
    }
  }

  const app = express();
  app.use(express.json());
  app.use('/api/shipments', authMiddleware, auditLogMiddleware, casbinAuthz('shipments'), shipmentRoutes);
  app.use('/api/driver/me', authMiddleware, casbinAuthz('driver_portal'), driverRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const admin = await mkUser(Role.ADMIN, 'admin');
  const dispatcher = await mkUser(Role.DISPATCHER, 'dispatcher');
  const clerk = await mkUser(Role.CUS, 'clerk');
  const driverUser = await mkUser(Role.DRIVER, 'driver');
  adminUserId = admin.id;
  dispatcherToken = signToken(dispatcher);
  clerkToken = signToken(clerk);
  driverToken = signToken(driverUser);
});

after(async () => {
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdShipmentIds.length > 0) {
      await db.delete(s.notifications).where(and(
        eq(s.notifications.type, 'TRIP_DISPATCHED'),
        eq(s.notifications.relatedEntityType, 'trips'),
        inArray(
          s.notifications.relatedEntityId,
          db.select({ id: s.trips.id }).from(s.trips).where(inArray(s.trips.shipmentId, createdShipmentIds)),
        ),
      ));
      // Trips reference fulfillments (RESTRICT FK, migration 0073): take the
      // fixture trips out before the fulfillments they fulfill.
      await db.delete(s.trips).where(inArray(s.trips.fulfillmentId,
        db.select({ id: s.shipmentFulfillments.id }).from(s.shipmentFulfillments)
          .where(inArray(s.shipmentFulfillments.shipmentId, createdShipmentIds))));
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdSiteIds.length > 0) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdSiteIds));
    if (createdAssignmentIds.length > 0) await db.delete(s.truckDriverAssignments).where(inArray(s.truckDriverAssignments.id, createdAssignmentIds));
    if (createdDriverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    if (createdTruckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    if (createdTrailerIds.length > 0) await db.delete(s.trailers).where(inArray(s.trailers.id, createdTrailerIds));
    if (createdContainerTypeIds.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    if (createdPortIds.length > 0) await db.delete(s.ports).where(inArray(s.ports.id, createdPortIds));
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

describe('dispatch detail plan rows', () => {
  // A container not yet routed individually still shows the LOT's route —
  // the same container → shipment fallback the CUS workspace applies, so the
  // plan's Tuyến cell never silently dashes a route CUS displays.
  test('FCL row falls back to the shipment route when the container has none', async () => {
    const customer = await createCustomer(`Detail fallback ${suffix}-${createdCustomerIds.length}`);
    const shipmentRoute = await createRoute();
    const site = await createOperationalSite(customer.id);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      routeId: shipmentRoute.id,
      cargoMode: 'FCL',
      shipmentCode: `DTL-FALLBACK-${suffix}`,
      bookingRef: `BOOK-FALLBACK-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-20T08:00:00.000Z'),
      tradeDirection: 'EXPORT',
      operationalSiteId: site.id,
      createdBy: adminUserId,
    }).returning();
    createdShipmentIds.push(shipment.id);
    const containerType = await createContainerType(`20G${createdContainerTypeIds.length}`);
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: containerType.id,
      containerNumber: `MSCU${String(310000 + shipment.id).slice(-6)}`,
      // Deliberately NO container routeId — the lot-level route must surface.
      customerAppointmentAt: new Date('2026-08-20T08:00:00.000Z'),
      createdBy: adminUserId,
    }).returning();
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: { deliverySite: { id: site.id, name: site.name, address: site.address } },
      plannedCarrierType: 'OWN',
      createdBy: adminUserId,
    }).returning();

    const response = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const row = response.data.items.find((item) => item.fulfillmentId === fulfillment.id)!;
    assert.ok(row, 'fallback lot row renders');
    assert.equal(row.customerRoute.routeName, shipmentRoute.name);
  });

  test('returns one row per container with spec payload before any handoff', async () => {
    const { shipment, fulfillmentIds, route } = await createAllocatedLot({ carrierType: 'OWN', containerCount: 2, isCombined: true });
    const response = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.items.length, 2);
    const row = response.data.items.find((item) => item.fulfillmentId === fulfillmentIds[0])!;
    // Container-routed + shipment-null lot: the CONTAINER's own route must
    // win (picks up a flipped coalesce that would shadow it with the lot's).
    assert.equal(row.customerRoute.routeName, route.name);
    assert.equal(row.shipmentId, shipment.id);
    assert.equal(row.isCombined, true);
    assert.equal(row.taskStatus, 'READY');
    assert.equal(row.time.runHour, 15);
    // QA-001: the full timestamp rides the wire beside the hour int so the
    // grid can render minutes (08:00Z = 15:00 +07 on the default fixture).
    assert.equal(row.time.runAt, '2026-08-20T08:00:00.000Z');
    assert.equal(row.customerRoute.customerName, shipment.customerId != null ? row.customerRoute.customerName : null);
    assert.ok(row.customerRoute.factoryName);
    assert.ok(row.customerRoute.deliveryPoint);
    assert.equal(row.docs.tradeDirection, 'EXPORT');
    assert.equal(row.dispatch.carrierType, 'OWN');
    assert.equal(row.dispatch.carrierName, 'SilverSea');
    assert.equal(row.dispatch.assignedPlate, null);
    assert.equal(row.lotFullyPlated, false);
  });

  test('QA-001: runAt keeps appointment minutes and nulls out with no time source', async () => {
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN', containerCount: 1, isCombined: false });
    const [container] = await db.select({ id: s.shipmentContainers.id }).from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, shipment.id))
      .orderBy(s.shipmentContainers.id);

    // 13:45Z = 20:45 +07 — minutes must survive the wire (MNBU0000283 class).
    await db.update(s.shipmentContainers)
      .set({ customerAppointmentAt: new Date('2026-08-20T13:45:00.000Z') })
      .where(eq(s.shipmentContainers.id, container!.id));
    let response = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const row = response.data.items.find((item) => item.fulfillmentId === fulfillmentIds[0])!;
    assert.equal(row.time.runAt, '2026-08-20T13:45:00.000Z');
    assert.equal(row.time.runHour, 20);

    // No appointment, closing, or planned return → explicit nulls, never a
    // fabricated time.
    await db.update(s.shipmentContainers)
      .set({ customerAppointmentAt: null })
      .where(eq(s.shipmentContainers.id, container!.id));
    await db.update(s.shipments)
      .set({ closingAt: null, plannedReturnAt: null })
      .where(eq(s.shipments.id, shipment.id));
    response = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const nullRow = response.data.items.find((item) => item.fulfillmentId === fulfillmentIds[0])!;
    assert.equal(nullRow.time.runAt, null);
    assert.equal(nullRow.time.runHour, null);
  });

  test('shows carrier-less containers of the day and lets dispatch allocate them here', async () => {
    // 2026-09-09 dispatcher report: the detail plan only listed containers
    // already carrier-allocated on the master plan. A fulfillment with no
    // carrier plan yet must appear (as unassigned) and accept a carrier
    // assignment made directly from this screen.
    const carrier = await createCustomer(`Late carrier ${suffix}-${createdCustomerIds.length}`, true);
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: null, containerCount: 2 });

    const before = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    assert.equal(before.status, 200, JSON.stringify(before.data));
    assert.equal(before.data.items.length, 2, 'both carrier-less containers must be listed');
    const unassignedRow = before.data.items.find((item) => item.fulfillmentId === fulfillmentIds[0])!;
    assert.ok(unassignedRow, 'carrier-less row must exist');
    assert.equal(unassignedRow.dispatch.carrierType, null);
    assert.equal(unassignedRow.dispatch.carrierName, null);

    const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const assigned = await apiFetch<CarrierResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/carrier`, {
      method: 'PATCH', token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, carrierType: 'EXTERNAL', externalCarrierId: carrier.id },
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
    assert.equal(assigned.data.carrierType, 'EXTERNAL');
    assert.equal(assigned.data.carrierName, carrier.name);

    const after = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    assert.equal(after.status, 200);
    assert.equal(after.data.items.length, 2);
    const plannedRow = after.data.items.find((item) => item.fulfillmentId === fulfillmentIds[0])!;
    assert.equal(plannedRow.dispatch.carrierType, 'EXTERNAL');
    const stillUnassigned = after.data.items.find((item) => item.fulfillmentId === fulfillmentIds[1])!;
    assert.equal(stillUnassigned.dispatch.carrierType, null);
  });

  test('keeps a published CREATED trip visible so dispatch can reassign it', async () => {
    const { shipment, fulfillmentIds, route } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck, driver } = await createOwnedTruckWithDriver();
    await db.update(s.shipments).set({ status: 'DISPATCHED' }).where(eq(s.shipments.id, shipment.id));
    const trip = await insertTripComposite(db, {
      shipmentId: shipment.id,
      fulfillmentId: fulfillmentIds[0],
      customerId: shipment.customerId,
      routeId: route.id,
      status: 'CREATED',
      carrierType: 'OWN',
      truckId: truck.id,
      driverId: driver.id,
      trailerId: truck.currentTrailerId,
      plannedStartAt: new Date('2026-08-20T08:00:00.000Z'),
      plannedEndAt: new Date('2026-08-20T12:00:00.000Z'),
      departureDate: '2026-08-20',
      createdBy: adminUserId,
    });

    const response = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const row = response.data.items.find((item) => item.fulfillmentId === fulfillmentIds[0]);
    assert.equal(row?.taskStatus, 'DISPATCHED');
    assert.equal(row?.dispatch.tripId, trip.id);
    assert.equal(row?.dispatch.tripStatus, 'CREATED');
  });

  test('CLERK and DRIVER get 403', async () => {
    await createAllocatedLot({ carrierType: 'OWN' });
    const clerkResponse = await fetchRows(clerkToken);
    assert.equal(clerkResponse.status, 403);
    const driverResponse = await fetchRows(driverToken);
    assert.equal(driverResponse.status, 403);
  });

  test('assignmentStatus filter narrows rows server-side', async () => {
    const { shipment } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const unassigned = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&assignmentStatus=UNASSIGNED`);
    assert.equal(unassigned.status, 200);
    assert.equal(unassigned.data.items.length, 1);

    const [fulfillment] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, shipment.id));
    const assign = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, truckId: truck.id },
    });
    assert.equal(assign.status, 200, JSON.stringify(assign.data));

    const stillUnassigned = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&assignmentStatus=UNASSIGNED`);
    assert.equal(stillUnassigned.data.items.length, 0);
    const assigned = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&assignmentStatus=ASSIGNED`);
    assert.equal(assigned.data.items.length, 1);
    assert.equal(assigned.data.items[0]!.dispatch.assignedPlate, truck.licensePlate);
  });

  test('hour range and direction filters apply', async () => {
    const { shipment } = await createAllocatedLot({ carrierType: 'OWN' });
    // Fixture closes at 08:00Z = 15:00 Asia/Ho_Chi_Minh — filters and display
    // both operate in the business timezone.
    const inRange = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&hourFrom=14:30&hourTo=15:30&direction=EXPORT`);
    assert.equal(inRange.status, 200, JSON.stringify(inRange.data));
    assert.equal(inRange.data.items.length, 1);
    assert.equal(inRange.data.items[0]!.time.runHour, 15);
    const outOfRange = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&hourFrom=15:01`);
    assert.equal(outOfRange.data.items.length, 0);
    const wrongDirection = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&direction=IMPORT`);
    assert.equal(wrongDirection.data.items.length, 0);
  });

  test('date filter resolves each FCL row from its own container appointment in the business timezone', async () => {
    const { shipment } = await createAllocatedLot({ carrierType: 'OWN', containerCount: 2 });
    await db.update(s.shipments)
      .set({ expectedDeliveryDate: '2026-08-20' })
      .where(eq(s.shipments.id, shipment.id));
    const containers = await db.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, shipment.id))
      .orderBy(s.shipmentContainers.id);
    // 20/08 UTC at 18:00 is 21/08 in Vietnam. The other container remains
    // on 20/08 local time, proving date filters do not collapse to the lot.
    await db.update(s.shipmentContainers)
      .set({ customerAppointmentAt: new Date('2026-08-20T18:00:00.000Z') })
      .where(eq(s.shipmentContainers.id, containers[0]!.id));
    await db.update(s.shipmentContainers)
      .set({ customerAppointmentAt: new Date('2026-08-20T06:00:00.000Z') })
      .where(eq(s.shipmentContainers.id, containers[1]!.id));

    const shipmentDate = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&date=2026-08-20`);
    assert.equal(shipmentDate.status, 200, JSON.stringify(shipmentDate.data));
    assert.equal(shipmentDate.data.items.length, 1);
    assert.equal(shipmentDate.data.items[0]!.time.deliveryDate, '2026-08-20');

    const appointmentDate = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&date=2026-08-21`);
    assert.equal(appointmentDate.status, 200, JSON.stringify(appointmentDate.data));
    assert.equal(appointmentDate.data.items.length, 1);
    assert.equal(appointmentDate.data.items[0]!.time.deliveryDate, '2026-08-21');
  });

  test('invalid hour filter is rejected with 400', async () => {
    const response = await fetchRows(dispatcherToken, '?hourFrom=24:00');
    assert.equal(response.status, 400);
  });

  test('malformed PATCH body types are rejected with 400', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const numericPlate = await apiFetch(`/dispatch-detail-plan-rows/${fulfillmentIds[0]}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: 1, plateNumber: 123 },
    });
    assert.equal(numericPlate.status, 400);
    const stringTruckId = await apiFetch(`/dispatch-detail-plan-rows/${fulfillmentIds[0]}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: 1, truckId: 'abc' },
    });
    assert.equal(stringTruckId.status, 400);
  });

  test('ACCOUNTANT read is customer-scoped and address-redacted', async () => {
    const { shipment, site } = await createAllocatedLot({ carrierType: 'OWN' });
    // Scope the accountant to this lot's customer only. The allocated lot is
    // always a catalog-customer lot (ad-hoc lots cannot dispatch yet), so the
    // guard is a fixture assertion rather than a live path.
    assert.ok(shipment.customerId != null, 'allocated fixture must carry a catalog customer');
    const accountant = await mkUser(Role.ACCOUNTANT, 'accountant-scoped');
    await db.insert(s.userCustomerLinks).values({ userId: accountant.id, customerId: shipment.customerId });
    const scopedToken = jwt.sign({
      userId: accountant.id,
      username: accountant.username,
      email: null,
      fullName: null,
      role: Role.ACCOUNTANT,
      customerId: shipment.customerId,
      customerIds: [shipment.customerId],
    }, config.jwtSecret);

    const scoped = await apiFetch<{ items: DetailPlanRow[] }>(`/dispatch-detail-plan-rows?q=${shipment.shipmentCode}`, {
      token: scopedToken,
    });
    assert.equal(scoped.status, 200, JSON.stringify(scoped.data));
    assert.equal(scoped.data.items.length, 1);
    // Site address is redacted for accountants; the site name stays.
    assert.equal(scoped.data.items[0]!.customerRoute.deliveryPoint, null);
    assert.equal(scoped.data.items[0]!.customerRoute.factoryName, site.name);

    // Unscoped accountant (no customer links) is refused.
    const unscoped = await mkUser(Role.ACCOUNTANT, 'accountant-unscoped');
    const unscopedResponse = await apiFetch('/dispatch-detail-plan-rows', {
      token: signToken(unscoped),
    });
    assert.equal(unscopedResponse.status, 403);
  });

  test('delivery point facet endpoint lists distinct sites', async () => {
    const { site } = await createAllocatedLot({ carrierType: 'OWN' });
    const response = await apiFetch<{ items: Array<{ id: number; name: string }> }>(
      `/dispatch-delivery-point-facets?q=${suffix}`,
      { token: dispatcherToken },
    );
    assert.equal(response.status, 200);
    assert.ok(response.data.items.some((item) => item.id === site.id));
  });

  test('pickup and dropoff port facet endpoints list distinct ports', async () => {
    const { shipment } = await createAllocatedLot({ carrierType: 'OWN' });
    // Resolve the lot's container ports from the row payload.
    const rows = await apiFetch<{ items: DetailPlanRow[] }>(
      `/dispatch-detail-plan-rows?q=${shipment.shipmentCode}`,
      { token: dispatcherToken },
    );
    assert.equal(rows.status, 200);
    const row = rows.data.items[0]!;
    const pickupId = row.ports.pickupPortId;
    const dropoffId = row.ports.dropoffPortId;
    assert.ok(pickupId != null || dropoffId != null, 'fixture lot should reference ports');

    // Facets cap at 100 rows ordered by name on the accumulated local DB, so
    // the membership asserts below ride on a q-narrowed fetch (this run's
    // ports are the only ones matching the run suffix).
    const pickup = await apiFetch<{ items: Array<{ id: number; name: string }> }>(
      `/dispatch-pickup-port-facets?q=${suffix}`,
      { token: dispatcherToken },
    );
    assert.equal(pickup.status, 200);
    if (pickupId != null) assert.ok(pickup.data.items.some((item) => item.id === pickupId));

    const dropoff = await apiFetch<{ items: Array<{ id: number; name: string }> }>(
      `/dispatch-dropoff-port-facets?q=${suffix}`,
      { token: dispatcherToken },
    );
    assert.equal(dropoff.status, 200);
    if (dropoffId != null) assert.ok(dropoff.data.items.some((item) => item.id === dropoffId));
  });

  test('pickupIds and dropoffIds filters narrow the rows', async () => {
    const { shipment } = await createAllocatedLot({ carrierType: 'OWN' });
    const rows = await apiFetch<{ items: DetailPlanRow[] }>(
      `/dispatch-detail-plan-rows?q=${shipment.shipmentCode}`,
      { token: dispatcherToken },
    );
    assert.equal(rows.status, 200);
    const pickupId = rows.data.items[0]!.ports.pickupPortId!;
    const dropoffId = rows.data.items[0]!.ports.dropoffPortId!;

    const pickupFiltered = await apiFetch<{ items: DetailPlanRow[] }>(
      `/dispatch-detail-plan-rows?pickupIds=${pickupId}`,
      { token: dispatcherToken },
    );
    assert.equal(pickupFiltered.status, 200);
    assert.ok(pickupFiltered.data.items.some((item) => item.shipmentId === shipment.id));
    const pickupExcluded = await apiFetch<{ items: DetailPlanRow[] }>(
      `/dispatch-detail-plan-rows?pickupIds=${pickupId + 1000000}`,
      { token: dispatcherToken },
    );
    assert.equal(pickupExcluded.status, 200);
    assert.ok(!pickupExcluded.data.items.some((item) => item.shipmentId === shipment.id));

    const dropoffFiltered = await apiFetch<{ items: DetailPlanRow[] }>(
      `/dispatch-detail-plan-rows?dropoffIds=${dropoffId}`,
      { token: dispatcherToken },
    );
    assert.equal(dropoffFiltered.status, 200);
    assert.ok(dropoffFiltered.data.items.some((item) => item.shipmentId === shipment.id));
    const dropoffExcluded = await apiFetch<{ items: DetailPlanRow[] }>(
      `/dispatch-detail-plan-rows?dropoffIds=${dropoffId + 1000000}`,
      { token: dispatcherToken },
    );
    assert.equal(dropoffExcluded.status, 200);
    assert.ok(!dropoffExcluded.data.items.some((item) => item.shipmentId === shipment.id));
  });

  test('zone filter narrows rows to a zone\'s ports (either side)', async () => {
    // LH lot: dropoff port zoned LACH_HUYEN.
    const lhCustomer = await createCustomer(`LH detail ${suffix}-${createdCustomerIds.length}`);
    const lhRoute = await createRoute();
    const lhSite = await createOperationalSite(lhCustomer.id);
    const [lhShipment] = await db.insert(s.shipments).values({
      customerId: lhCustomer.id,
      routeId: lhRoute.id,
      cargoMode: 'FCL',
      shipmentCode: `LHD-${suffix}-${createdShipmentIds.length}`,
      bookingRef: `LHD-BOOK-${suffix}-${createdShipmentIds.length}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-20T08:00:00.000Z'),
      tradeDirection: 'EXPORT',
      operationalSiteId: lhSite.id,
      createdBy: adminUserId,
    }).returning();
    createdShipmentIds.push(lhShipment.id);
    const lhContainerType = await createContainerType('20G');
    const [lhPort] = await db.insert(s.ports).values({
      name: `LH filter port ${suffix}-${createdPortIds.length}`,
      dispatchZone: 'LACH_HUYEN',
    }).returning();
    createdPortIds.push(lhPort.id);
    const [plainPort] = await db.insert(s.ports).values({ name: `LH filter plain port ${suffix}-${createdPortIds.length}` }).returning();
    createdPortIds.push(plainPort.id);
    const [lhContainer] = await db.insert(s.shipmentContainers).values({
      shipmentId: lhShipment.id,
      containerTypeId: lhContainerType.id,
      containerNumber: `LHD${String(700000 + lhShipment.id).slice(-6)}`,
      pickupPortId: plainPort.id,
      dropoffPortId: lhPort.id,
      createdBy: adminUserId,
    }).returning();
    await db.insert(s.shipmentFulfillments).values({
      shipmentId: lhShipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: lhContainer.id,
      sourceShipmentVersion: lhShipment.version,
      siteSnapshot: { deliverySite: { id: lhSite.id, name: lhSite.name, address: lhSite.address } },
      plannedCarrierType: 'OWN',
      createdBy: adminUserId,
    });
    // Plain lot: no zoned ports at all.
    const { shipment: plainShipment } = await createAllocatedLot({ carrierType: 'OWN' });

    // q narrows to this run's two lots — an unscoped page-1 fetch depends on
    // how many READY rows an accumulated local DB happens to hold.
    const unfiltered = await apiFetch<{ items: DetailPlanRow[] }>(`/dispatch-detail-plan-rows?q=${suffix}`, { token: dispatcherToken });
    assert.equal(unfiltered.status, 200);
    assert.ok(unfiltered.data.items.some((item) => item.shipmentId === lhShipment.id));
    assert.ok(unfiltered.data.items.some((item) => item.shipmentId === plainShipment.id));

    // q keeps the zone queries scoped to this run's lots: an unscoped zone
    // page-1 depends on how many zone rows the accumulated local DB holds
    // (same accumulation trap the unfiltered fetch above avoids).
    const lhOnly = await apiFetch<{ items: DetailPlanRow[] }>(`/dispatch-detail-plan-rows?zone=LACH_HUYEN&q=${suffix}`, { token: dispatcherToken });
    assert.equal(lhOnly.status, 200, JSON.stringify(lhOnly.data));
    assert.ok(lhOnly.data.items.some((item) => item.shipmentId === lhShipment.id), 'LH lot must be present');
    assert.ok(!lhOnly.data.items.some((item) => item.shipmentId === plainShipment.id), 'plain lot must be excluded');

    // Pickup side counts too: a lot whose pickup port is LH also matches.
    const [plainContainer] = await db.select({ id: s.shipmentContainers.id })
      .from(s.shipmentFulfillments)
      .innerJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
      .where(eq(s.shipmentFulfillments.shipmentId, plainShipment.id));
    await db.update(s.shipmentContainers)
      .set({ pickupPortId: lhPort.id })
      .where(eq(s.shipmentContainers.id, plainContainer.id));
    const lhPickupSide = await apiFetch<{ items: DetailPlanRow[] }>(`/dispatch-detail-plan-rows?zone=LACH_HUYEN&q=${suffix}`, { token: dispatcherToken });
    assert.equal(lhPickupSide.status, 200);
    assert.ok(lhPickupSide.data.items.some((item) => item.shipmentId === plainShipment.id), 'pickup-side LH port must match');

    // Unknown zone code → 400 (taxonomy is DB-owned; stale clients fail loud).
    const unknown = await apiFetch('/dispatch-detail-plan-rows?zone=CAT_HAI', { token: dispatcherToken });
    assert.equal(unknown.status, 400);
  });

  test('detail plan reads COMPLETED for a trip that completed outside the staff-close flow', async () => {
    // Regression guard for 2026-09-08 (MNBU0000283): the row chip must key off
    // the trip's status itself — a trip that reached COMPLETED before the
    // staff-close feature existed (driver-app close, legacy data) still reads
    // "Đã hoàn thành" on the plan, while a sibling fulfillment without any
    // trip stays READY (the status is per-row, not per-lot).
    const { shipment, fulfillmentIds, route, customer } = await createAllocatedLot({ carrierType: 'OWN', containerCount: 2 });
    const [completedTrip] = await db.insert(s.trips).values({
      customerId: customer.id,
      routeId: route.id,
      shipmentId: shipment.id,
      fulfillmentId: fulfillmentIds[0]!,
      status: 'COMPLETED',
      departureDate: '2026-09-08',
      completedAt: new Date('2026-09-08T10:00:00.000Z'),
    }).returning();
    createdTripIds.push(completedTrip.id);

    const detail = await apiFetch<{ items: DetailPlanRow[] }>(
      `/dispatch-detail-plan-rows?q=${shipment.shipmentCode}`,
      { token: dispatcherToken },
    );
    assert.equal(detail.status, 200);
    const completedRow = detail.data.items.find((item) => item.fulfillmentId === fulfillmentIds[0]);
    const readyRow = detail.data.items.find((item) => item.fulfillmentId === fulfillmentIds[1]);
    assert.ok(completedRow, 'row with a completed trip must appear on the plan');
    assert.ok(readyRow, 'sibling row without a trip must appear on the plan');
    assert.equal(completedRow?.taskStatus, 'COMPLETED');
    assert.equal(readyRow?.taskStatus, 'READY');
  });
});

describe('dispatch detail plan plate assignment', () => {
  test('dispatcher changes one ready fulfillment carrier, clearing its stale vehicle, with idempotent replay', async () => {
    const carrier = await createCustomer(`Replacement carrier ${suffix}-${createdCustomerIds.length}`, true);
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const plated = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH', token: dispatcherToken, body: { expectedVersion: fulfillment.version, truckId: truck.id },
    });
    assert.equal(plated.status, 200, JSON.stringify(plated.data));

    const key = `carrier-reassign-${suffix}-${fulfillment.id}`;
    const body = { expectedVersion: plated.data.version, carrierType: 'EXTERNAL', externalCarrierId: carrier.id };
    const first = await apiFetch<CarrierResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/carrier`, {
      method: 'PATCH', token: dispatcherToken, body, idempotencyKey: key,
    });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.replayed, false);
    assert.equal(first.data.carrierType, 'EXTERNAL');
    assert.equal(first.data.externalCarrierId, carrier.id);
    assert.equal(first.data.carrierName, carrier.name);
    assert.equal(first.data.assignedPlate, null);

    const replay = await apiFetch<CarrierResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/carrier`, {
      method: 'PATCH', token: dispatcherToken, body, idempotencyKey: key,
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.data));
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.version, first.data.version);

    const [stored] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id));
    assert.equal(stored.plannedExternalCarrierId, carrier.id);
    assert.equal(stored.plannedExternalCarrierVehicleId, null);
    assert.equal(stored.plannedVehiclePlateNumber, null);
  });

  test('carrier change rejects a non-carrier and stale fulfillment version', async () => {
    const invalidCarrier = await createCustomer(`Non-carrier ${suffix}-${createdCustomerIds.length}`);
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const nonCarrier = await apiFetch(`/dispatch-detail-plan-rows/${fulfillment.id}/carrier`, {
      method: 'PATCH', token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, carrierType: 'EXTERNAL', externalCarrierId: invalidCarrier.id },
    });
    assert.equal(nonCarrier.status, 409);
    const stale = await apiFetch(`/dispatch-detail-plan-rows/${fulfillment.id}/carrier`, {
      method: 'PATCH', token: dispatcherToken,
      body: { expectedVersion: fulfillment.version + 1, carrierType: 'OWN' },
    });
    assert.equal(stale.status, 409);
  });

  test('OWN happy path assigns plate without notifying driver, flips lot flag on last container', async () => {
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN', containerCount: 3 });
    const { truck, driver } = await createOwnedTruckWithDriver();

    const [f1] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const first = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${f1.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: f1.version, truckId: truck.id },
    });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.assignedPlate, truck.licensePlate);
    assert.equal(first.data.assignedDriverId, driver.id);
    assert.equal(first.data.driverNotified, false);
    assert.equal(first.data.lotFullyPlated, false);

    // Plate assignment never notifies — the driver notification belongs to
    // dispatch-order issuance, which is the only place a trips row exists.
    const notes = await db.select({ id: s.notifications.id }).from(s.notifications).where(and(
      eq(s.notifications.relatedEntityType, 'trips'),
      inArray(
        s.notifications.relatedEntityId,
        db.select({ id: s.trips.id }).from(s.trips).where(eq(s.trips.fulfillmentId, f1.id)),
      ),
    ));
    assert.equal(notes.length, 0, 'plate assignment must not persist any notification');

    const [f2] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[1]!));
    await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${f2.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: f2.version, truckId: truck.id },
    });

    const [f3] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[2]!));
    const last = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${f3.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: f3.version, truckId: truck.id },
    });
    assert.equal(last.status, 200);
    assert.equal(last.data.lotFullyPlated, true, `lot ${shipment.id} should flip to fully plated`);
  });

  test('version conflict yields 409', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const response = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillmentIds[0]}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: 99999, truckId: truck.id },
    });
    assert.equal(response.status, 409);
  });

  test('OWN free-text plate is rejected', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const response = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, plateNumber: '30A-123.45' },
    });
    assert.equal(response.status, 400);
  });

  test('EXTERNAL catalog pick, free text, and empty bypass all succeed', async () => {
    const carrier = await createCustomer(`Detail carrier ${suffix}-${createdCustomerIds.length}`, true);
    const [vehicle] = await db.insert(s.carrierFleetVehicles).values({
      carrierId: carrier.id,
      licensePlate: '51H-888.88',
      normalizedPlate: '51H88888',
      isActive: true,
      createdBy: adminUserId,
    }).returning();

    // Catalog pick
    const lotCatalog = await createAllocatedLot({ carrierType: 'EXTERNAL', externalCarrierId: carrier.id });
    const [fCatalog] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, lotCatalog.fulfillmentIds[0]!));
    const catalog = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fCatalog.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fCatalog.version, externalCarrierVehicleId: vehicle.id },
    });
    assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
    assert.equal(catalog.data.assignedPlate, '51H-888.88');
    assert.equal(catalog.data.lotFullyPlated, true);
    assert.equal(catalog.data.driverNotified, false);

    // Free text
    const lotFree = await createAllocatedLot({ carrierType: 'EXTERNAL', externalCarrierId: carrier.id });
    const [fFree] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, lotFree.fulfillmentIds[0]!));
    const freeText = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fFree.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fFree.version, plateNumber: '30a  999.99' },
    });
    assert.equal(freeText.status, 200, JSON.stringify(freeText.data));
    assert.equal(freeText.data.assignedPlate, '30A 999.99');

    // Empty bypass
    const lotEmpty = await createAllocatedLot({ carrierType: 'EXTERNAL', externalCarrierId: carrier.id });
    const [fEmpty] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, lotEmpty.fulfillmentIds[0]!));
    const bypass = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fEmpty.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fEmpty.version },
    });
    assert.equal(bypass.status, 200, JSON.stringify(bypass.data));
    assert.equal(bypass.data.assignedPlate, null);
    assert.equal(bypass.data.lotFullyPlated, false);
  });

  test('clearing a plate reverts the lot flag', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const assign = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, truckId: truck.id },
    });
    assert.equal(assign.status, 200);
    assert.equal(assign.data.lotFullyPlated, true);

    const clear = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: assign.data.version, clear: true },
    });
    assert.equal(clear.status, 200, JSON.stringify(clear.data));
    assert.equal(clear.data.assignedPlate, null);
    assert.equal(clear.data.lotFullyPlated, false);
  });

  test('re-assigning the same truck never notifies', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const first = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, truckId: truck.id },
    });
    assert.equal(first.data.driverNotified, false);

    // Clear then re-assign the same truck: plate assignment is silent at
    // every step — issuance owns the driver notification.
    const cleared = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: first.data.version, clear: true },
    });
    assert.equal(cleared.status, 200);

    const reassign = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: cleared.data.version, truckId: truck.id },
    });
    assert.equal(reassign.status, 200);
    assert.equal(reassign.data.assignedPlate, truck.licensePlate);
    assert.equal(reassign.data.driverNotified, false, 'same truck re-assign must not re-notify');
  });

  test('truck without assigned driver still allows assignment with hint', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const plateSuffix = `${suffix.slice(-6)}${String(createdTruckIds.length).padStart(2, '0')}`;
    const [truck] = await db.insert(s.trucks).values({
      licensePlate: `51D-${plateSuffix}`.slice(0, 20),
      trailerType: '40FT',
      status: 'ACTIVE',
    }).returning();
    createdTruckIds.push(truck.id);

    const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const response = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, truckId: truck.id },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.assignedPlate, truck.licensePlate);
    assert.equal(response.data.driverNotified, false);
    assert.equal(response.data.driverHint, 'Chưa có lái xe gắn với xe.');
  });

  test('CUS cannot assign plates', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const response = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillmentIds[0]}/plate`, {
      method: 'PATCH',
      token: clerkToken,
      body: { expectedVersion: 1 },
    });
    assert.equal(response.status, 403);
  });

  test('accounting-locked shipment rejects plate changes', async () => {
    const { shipment, fulfillmentIds, customer } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const [billingDoc] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityName: customer.name,
      rangeFrom: '2026-08-01',
      rangeTo: '2026-08-31',
      totalInclVat: '0',
      debitNoteStatus: 'SENT',
      issuedAt: new Date(),
      createdBy: adminUserId,
    }).returning();
    try {
      await db.insert(s.shipmentAccountingLocks).values({
        shipmentId: shipment.id,
        billingDocumentId: billingDoc.id,
        billingDocumentVersion: billingDoc.version,
        billingPeriodSnapshot: {
          rangeFrom: billingDoc.rangeFrom,
          rangeTo: billingDoc.rangeTo,
          issuedAt: billingDoc.issuedAt!.toISOString(),
        },
        shipmentVersionAtLock: shipment.version,
        reason: 'Kết thúc chu kỳ công nợ',
        activatedBy: adminUserId,
      });
      const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
      const response = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
        method: 'PATCH',
        token: dispatcherToken,
        body: { expectedVersion: fulfillment.version, truckId: truck.id },
      });
      assert.equal(response.status, 409);
      assert.ok(String((response.data as { error?: string }).error ?? '').includes('khóa'), JSON.stringify(response.data));
    } finally {
      await db.delete(s.shipmentAccountingLocks).where(eq(s.shipmentAccountingLocks.shipmentId, shipment.id));
      await db.delete(s.billingDocuments).where(eq(s.billingDocuments.id, billingDoc.id));
    }
  });

  test('completed lot rejects plate assignment with the terminal-lot guard', async () => {
    // Guard-consistency regression: the atomic plan save and the carrier
    // change already 409 on terminal lots; the single-field plate endpoint
    // used to accept the same write on a COMPLETED shipment.
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const [fulfillment] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    try {
      await db.update(s.shipments).set({ status: 'COMPLETED' }).where(eq(s.shipments.id, shipment.id));
      const response = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
        method: 'PATCH',
        token: dispatcherToken,
        body: { expectedVersion: fulfillment.version, truckId: truck.id },
      });
      assert.equal(response.status, 409);
      assert.ok(String((response.data as { error?: string }).error ?? '').includes('đã kết thúc'), JSON.stringify(response.data));
    } finally {
      await db.update(s.shipments).set({ status: 'READY_FOR_DISPATCH' }).where(eq(s.shipments.id, shipment.id));
    }
  });

  test('dispatcher saves versioned operational estimates without creating a financial record', async () => {
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const [fulfillment] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const response = await apiFetch<EstimateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/estimates`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedVersion: fulfillment.version,
        plannedRevenue: 2_500_000,
        plannedCarrierCost: 1_900_000,
      },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.plannedRevenue, '2500000');
    assert.equal(response.data.plannedCarrierCost, '1900000');

    const rows = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    assert.equal(rows.status, 200, JSON.stringify(rows.data));
    assert.deepEqual(rows.data.items[0]!.estimates, {
      plannedRevenue: '2500000',
      plannedCarrierCost: '1900000',
    });
  });
});

describe('atomic dispatch detail plan save', () => {
  type PlanResponse = {
    fulfillmentId: number;
    fulfillmentVersion: number;
    shipmentId: number;
    shipmentVersion: number;
    classification: 'SINGLE' | 'DOUBLE' | 'COMBINED' | 'LCL';
    isCombined: boolean;
    dispatch: {
      carrierType: 'OWN' | 'EXTERNAL';
      carrierName: string | null;
      externalCarrierId: number | null;
      externalCarrierVehicleId: number | null;
      assignedPlate: string | null;
    };
    estimates: { plannedRevenue: string | null; plannedCarrierCost: string | null };
    lotFullyPlated: boolean;
    driverNotified: boolean;
    driverHint: string | null;
    replayed: boolean;
  };

  async function fetchShipmentAndFulfillment(fulfillmentId: number) {
    const [fulfillment] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillmentId));
    const [shipment] = await db.select().from(s.shipments)
      .where(eq(s.shipments.id, fulfillment.shipmentId));
    return { shipment, fulfillment };
  }

  test('one save applies carrier, vehicle, estimates, and the dispatcher classification atomically; lot flag stays CUS-owned', async () => {
    const carrier = await createCustomer(`Detail ext carrier ${suffix}-${createdCustomerIds.length}`, true);
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck, driver } = await createOwnedTruckWithDriver();
    const { shipment: freshShipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);

    const response = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: freshShipment.version,
        carrierType: 'EXTERNAL',
        externalCarrierId: carrier.id,
        plannedRevenue: 3_000_000,
        plannedCarrierCost: 2_200_000,
        // Phân loại is the dispatcher's call — persisted; the lot flag is
        // stripped at the route, so `isCombined: true` cannot rewrite it.
        classification: 'DOUBLE',
        isCombined: true,
      },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.replayed, false);
    assert.equal(response.data.dispatch.carrierType, 'EXTERNAL');
    assert.equal(response.data.dispatch.externalCarrierId, carrier.id);
    // Classification persists from the dispatch save; the lot combined flag
    // echoes the stored value the dispatcher cannot touch.
    assert.equal(response.data.classification, 'DOUBLE');
    assert.equal(response.data.isCombined, freshShipment.isCombined);
    assert.equal(response.data.estimates.plannedRevenue, '3000000');
    // Only the fulfillment changed → shipment version NOT bumped.
    assert.equal(response.data.shipmentVersion, freshShipment.version);
    assert.equal(response.data.fulfillmentVersion, fulfillment.version + 1);

    // The vehicle switched away from OWN with no plate — plate cleared.
    assert.equal(response.data.dispatch.assignedPlate, null);
    const { fulfillment: after } = await fetchShipmentAndFulfillment(fulfillment.id);
    assert.equal(after.dispatchClassification, 'DOUBLE');
    void truck; void driver;
  });

  test('omitting classification and isCombined leaves both stored values untouched', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { shipment: freshShipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);

    // Omitted fields mean "not part of this save": classification stays at
    // its CUS-derived value and the lot combined flag is untouched.
    const response = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: freshShipment.version,
        carrierType: 'OWN',
        plannedRevenue: 777_000,
        plannedCarrierCost: 555_000,
        isCombined: freshShipment.isCombined,
      },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.classification, fulfillment.dispatchClassification ?? 'SINGLE');
    assert.equal(response.data.isCombined, freshShipment.isCombined);
    const { fulfillment: after } = await fetchShipmentAndFulfillment(fulfillment.id);
    assert.equal(after.dispatchClassification, fulfillment.dispatchClassification);
  });

  test('isCombined unchanged → shipment version not bumped; classification exposed on rows', async () => {
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN', isCombined: false });
    const { shipment: freshShipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);

    const response = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: freshShipment.version,
        carrierType: 'OWN',
        truckId: null,
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
        isCombined: false,
      },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.shipmentVersion, freshShipment.version, 'shipment version must stay flat when isCombined is unchanged');
    void shipment;

    const rows = await fetchRows(dispatcherToken, `?q=${freshShipment.shipmentCode}`);
    assert.equal(rows.status, 200);
    const row = rows.data.items.find((item) => item.fulfillmentId === fulfillment.id)!;
    assert.equal(row.classification, 'SINGLE');
  });

  test('dispatcher omits isCombined → lot flag is NOT touched (CUS owns it)', async () => {
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN', isCombined: true });
    const { shipment: freshShipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);
    // Frontend dispatch editor now sends no `isCombined` field at all. The
    // backend must treat the absence as "not part of this save" — a
    // dispatcher editing one container must never rewrite a flag that spans
    // every container in the lot.
    const bodyWithoutIsCombined = {
      expectedFulfillmentVersion: fulfillment.version,
      expectedShipmentVersion: freshShipment.version,
      carrierType: 'OWN' as const,
      truckId: null,
      plannedRevenue: 4_200_000,
      plannedCarrierCost: 3_100_000,
      classification: 'COMBINED' as const,
    };
    const response = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: bodyWithoutIsCombined,
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));

    const rows = await fetchRows(dispatcherToken, `?q=${freshShipment.shipmentCode}`);
    assert.equal(rows.status, 200);
    const row = rows.data.items.find((item) => item.fulfillmentId === fulfillment.id)!;
    assert.equal(row.isCombined, true, 'omitted isCombined must echo the stored (true) value');
    // Phân loại is the dispatcher's call — it persists; only the lot flag is
    // stripped at the route.
    assert.equal(row.classification, 'COMBINED', 'dispatch save persists the dispatcher classification');
    assert.equal(row.estimates.plannedRevenue, '4200000');
    assert.equal(row.estimates.plannedCarrierCost, '3100000');

    const reloaded = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    assert.equal(reloaded[0]!.isCombined, true, 'shipments.is_combined must remain true after an editor save that omits isCombined');
    // The other plan fields did change, so the version IS allowed to bump —
    // the protection is specifically that isCombined is decoupled.
  });

  test('dispatcher explicitly sends false isCombined → silently coerced to "untouched" (per-container editor cannot rewrite lot flag)', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN', isCombined: true });
    const { shipment: freshShipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);
    const response = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: freshShipment.version,
        carrierType: 'OWN',
        truckId: null,
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
        isCombined: false,
      },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    // The route strips isCombined before the service runs, so the response
    // echoes the stored value — a dispatch save cannot flip the lot flag
    // even when a caller sends `isCombined: false` explicitly.
    assert.equal(response.data.isCombined, true);
    void freshShipment;
  });

  test('OWN truck assignment via atomic save stays silent; replay is silent', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const { shipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);

    const body = {
      expectedFulfillmentVersion: fulfillment.version,
      expectedShipmentVersion: shipment.version,
      carrierType: 'OWN' as const,
      truckId: truck.id,
      plannedRevenue: null,
      plannedCarrierCost: null,
      classification: 'SINGLE' as const,
      isCombined: shipment.isCombined,
    };
    const key = `plan-${suffix}-${fulfillment.id}-a`;
    const first = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH', token: dispatcherToken, body, idempotencyKey: key,
    });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.driverNotified, false);
    assert.equal(first.data.dispatch.assignedPlate, truck.licensePlate);
    assert.equal(first.data.lotFullyPlated, true);

    const replay = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH', token: dispatcherToken, body, idempotencyKey: key,
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.data));
    assert.equal(replay.data.replayed, true);

    // Planning saves never notify the driver.
    const notes = await db.select({ id: s.notifications.id }).from(s.notifications)
      .where(and(
        eq(s.notifications.relatedEntityType, 'trips'),
        inArray(
          s.notifications.relatedEntityId,
          db.select({ id: s.trips.id }).from(s.trips).where(eq(s.trips.fulfillmentId, fulfillment.id)),
        ),
      ));
    assert.equal(notes.length, 0);
  });

  // Carrier-less → OWN + truck in one atomic save: the flow the editor enables
  // for carrier-less rows (8afc13a9, Option B). null ≠ 'OWN' counts as a
  // carrier switch, so the truck block must resolve and land with the carrier
  // — pinning that the promotion cannot strand a plate without a carrier.
  test('carrier-less row promotes to OWN carrier when the atomic save carries an own-fleet truck', async () => {
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: null });
    const { truck } = await createOwnedTruckWithDriver();
    const { shipment: freshShipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);

    // Pre-save contract the grid relies on: the row is listed carrier-less.
    const before = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    assert.equal(before.status, 200, JSON.stringify(before.data));
    const carrierLessRow = before.data.items.find((row) => row.fulfillmentId === fulfillment.id);
    assert.ok(carrierLessRow, 'carrier-less row must be listed before the save');
    assert.equal(carrierLessRow.dispatch.carrierType, null);
    assert.equal(carrierLessRow.dispatch.carrierName, null);

    const response = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: freshShipment.version,
        carrierType: 'OWN',
        truckId: truck.id,
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
        isCombined: freshShipment.isCombined,
      },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.dispatch.carrierType, 'OWN');
    assert.equal(response.data.dispatch.carrierName, 'SilverSea');
    assert.equal(response.data.dispatch.externalCarrierId, null);
    assert.equal(response.data.dispatch.assignedPlate, truck.licensePlate);
    assert.equal(response.data.driverNotified, false, 'planning saves never notify the driver');

    const { fulfillment: after } = await fetchShipmentAndFulfillment(fulfillment.id);
    assert.equal(after.plannedCarrierType, 'OWN');
    assert.equal(after.plannedExternalCarrierId, null);
    assert.equal(after.plannedVehiclePlateNumber, truck.licensePlate);

    // Round-trip: the grid re-read shows the promoted carrier, matching the
    // editor's optimistic update.
    const rowsAfter = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    const promotedRow = rowsAfter.data.items.find((row) => row.fulfillmentId === fulfillment.id);
    assert.ok(promotedRow, 'promoted row must stay listed');
    assert.equal(promotedRow.dispatch.carrierType, 'OWN');
    assert.equal(promotedRow.dispatch.assignedPlate, truck.licensePlate);
  });

  test('stale shipment version or stale fulfillment version changes nothing', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const { shipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);

    const staleShipment = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: shipment.version + 5,
        carrierType: 'OWN',
        truckId: truck.id,
        plannedRevenue: 1,
        plannedCarrierCost: 1,
        classification: 'SINGLE',
        isCombined: shipment.isCombined,
      },
    });
    assert.equal(staleShipment.status, 409);

    const staleFulfillment = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version + 9,
        expectedShipmentVersion: shipment.version,
        carrierType: 'OWN',
        truckId: truck.id,
        plannedRevenue: 1,
        plannedCarrierCost: 1,
        classification: 'SINGLE',
        isCombined: shipment.isCombined,
      },
    });
    assert.equal(staleFulfillment.status, 409);

    // All-or-nothing: nothing was written.
    const after = await fetchShipmentAndFulfillment(fulfillment.id);
    assert.equal(after.fulfillment.version, fulfillment.version);
    assert.equal(after.fulfillment.plannedVehiclePlateNumber, null);
    assert.equal(after.fulfillment.plannedRevenue, null);
    assert.equal(after.shipment.version, shipment.version);
  });

  test('invalid vehicle for the incoming carrier rolls everything back', async () => {
    const carrier = await createCustomer(`Detail ext carrier ${suffix}-${createdCustomerIds.length}`, true);
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const { shipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);

    // EXTERNAL carrier but an OWN truck id → ownership mismatch → 400/409 and
    // classification/estimates must not land either.
    const response = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: shipment.version,
        carrierType: 'EXTERNAL',
        externalCarrierId: carrier.id,
        truckId: truck.id,
        plannedRevenue: 5_000_000,
        plannedCarrierCost: 4_000_000,
        classification: 'COMBINED',
        isCombined: shipment.isCombined,
      },
    });
    assert.ok(response.status === 400 || response.status === 409, `expected 400/409, got ${response.status}`);
    const after = await fetchShipmentAndFulfillment(fulfillment.id);
    assert.equal(after.fulfillment.plannedCarrierType, 'OWN');
    assert.equal(after.fulfillment.plannedRevenue, null);
    assert.equal(after.fulfillment.dispatchClassification, 'SINGLE');
    assert.equal(after.shipment.version, shipment.version);
  });

  test('classification omitted or invalid is rejected/ignored per CUS ownership', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const [fulfillment] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const [shipment] = await db.select().from(s.shipments)
      .where(eq(s.shipments.id, fulfillment.shipmentId));

    // classification + isCombined are CUS-owned: the route strips both from
    // a dispatch save, so omitting them succeeds (values stay untouched) —
    // but an INVALID classification literal still fails schema validation.
    const omitted = await apiFetch(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: shipment.version,
        carrierType: 'OWN',
        plannedRevenue: null,
        plannedCarrierCost: null,
        isCombined: false,
      },
    });
    assert.equal(omitted.status, 200, JSON.stringify(omitted.data));

    const invalid = await apiFetch(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: shipment.version,
        carrierType: 'OWN',
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'KEP',
        isCombined: false,
      },
    });
    assert.equal(invalid.status, 400);
  });

  test('CUS cannot save the plan; accounting lock blocks the atomic save', async () => {
    const { shipment, fulfillmentIds, customer } = await createAllocatedLot({ carrierType: 'OWN' });
    const { fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);

    const forbidden = await apiFetch(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: clerkToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: shipment.version,
        carrierType: 'OWN',
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
        isCombined: false,
      },
    });
    assert.equal(forbidden.status, 403);

    const [billingDoc] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityName: customer.name,
      rangeFrom: '2026-08-01',
      rangeTo: '2026-08-31',
      totalInclVat: '0',
      debitNoteStatus: 'SENT',
      issuedAt: new Date(),
      createdBy: adminUserId,
    }).returning();
    try {
      await db.insert(s.shipmentAccountingLocks).values({
        shipmentId: shipment.id,
        billingDocumentId: billingDoc.id,
        billingDocumentVersion: billingDoc.version,
        billingPeriodSnapshot: {
          rangeFrom: billingDoc.rangeFrom,
          rangeTo: billingDoc.rangeTo,
          issuedAt: billingDoc.issuedAt!.toISOString(),
        },
        shipmentVersionAtLock: shipment.version,
        reason: 'Kết thúc chu kỳ công nợ',
        activatedBy: adminUserId,
      });
      const locked = await apiFetch(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
        method: 'PATCH',
        token: dispatcherToken,
        body: {
          expectedFulfillmentVersion: fulfillment.version,
          expectedShipmentVersion: shipment.version,
          carrierType: 'OWN',
          plannedRevenue: null,
          plannedCarrierCost: null,
          classification: 'SINGLE',
          isCombined: false,
        },
      });
      assert.equal(locked.status, 409);
    } finally {
      await db.delete(s.shipmentAccountingLocks).where(eq(s.shipmentAccountingLocks.shipmentId, shipment.id));
      await db.delete(s.billingDocuments).where(eq(s.billingDocuments.id, billingDoc.id));
    }
  });
});

describe('dispatch detail plan server ordering', () => {
  test('rows follow cargo priority (20ft, 40ft, LCL, other) before pagination', async () => {
    const customer = await createCustomer(`Detail order customer ${suffix}`);
    const route = await createRoute();
    const site = await createOperationalSite(customer.id);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      routeId: route.id,
      cargoMode: 'FCL',
      isCombined: false,
      shipmentCode: `ORD-${suffix}`,
      bookingRef: `ORD-BOOK-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-20T08:00:00.000Z'),
      tradeDirection: 'EXPORT',
      operationalSiteId: site.id,
      createdBy: adminUserId,
    }).returning();
    createdShipmentIds.push(shipment.id);

    const type40 = await createContainerType('40HC');
    const type20 = await createContainerType('20DC');
    const type45 = await createContainerType('45G1');
    const [port] = await db.insert(s.ports).values({ name: `Detail order port ${suffix}` }).returning();
    createdPortIds.push(port.id);

    const specs: Array<{ type: typeof type20; classify?: 'LCL' }> = [
      { type: type45 },
      { type: type40 },
      { type: type20 },
    ];
    const expectedOrder: number[] = [];
    for (const spec of specs) {
      const [container] = await db.insert(s.shipmentContainers).values({
        shipmentId: shipment.id,
        containerTypeId: spec.type.id,
        containerNumber: `ORD${String(400000 + shipment.id).slice(-6)}${expectedOrder.length}`,
        pickupPortId: port.id,
        dropoffPortId: port.id,
        createdBy: adminUserId,
      }).returning();
      const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
        shipmentId: shipment.id,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        shipmentContainerId: container.id,
        sourceShipmentVersion: shipment.version,
        siteSnapshot: { deliverySite: { id: site.id, name: site.name, address: site.address } },
        plannedCarrierType: 'OWN',
        createdBy: adminUserId,
      }).returning();
      expectedOrder.push(fulfillment.id);
    }
    // LCL fulfillment on the same lot — should sort after all FCL containers.
    const [lclFulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'LCL_SHIPMENT',
      cargoMode: 'LCL',
      dispatchClassification: 'LCL',
      sourceShipmentVersion: shipment.version,
      siteSnapshot: { deliverySite: { id: site.id, name: site.name, address: site.address } },
      plannedCarrierType: 'OWN',
      createdBy: adminUserId,
    }).returning();
    // uniqueIndex on shipment_fulfillments_active_lcl_uniq_idx is per-shipment
    // and this shipment is fresh, so the insert is safe.

    const rows = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&limit=50`);
    assert.equal(rows.status, 200, JSON.stringify(rows.data));
    const ids = rows.data.items.map((item) => item.fulfillmentId);

    // Expected: 20 (index 2 in specs) → 40 (index 1) → LCL → 45 other (index 0).
    assert.ok(ids.includes(expectedOrder[2]!), '20ft container missing');
    assert.ok(ids.includes(expectedOrder[1]!), '40ft container missing');
    assert.ok(ids.includes(expectedOrder[0]!), '45ft container missing');
    assert.ok(ids.includes(lclFulfillment.id), 'LCL fulfillment missing');

    const pos20 = ids.indexOf(expectedOrder[2]!);
    const pos40 = ids.indexOf(expectedOrder[1]!);
    const posOther = ids.indexOf(expectedOrder[0]!);
    const posLcl = ids.indexOf(lclFulfillment.id);
    assert.ok(pos20 < pos40, `20ft (${pos20}) must sort before 40ft (${pos40})`);
    assert.ok(pos40 < posLcl, `40ft (${pos40}) must sort before LCL (${posLcl})`);
    assert.ok(posLcl < posOther, `LCL (${posLcl}) must sort before other (${posOther})`);
  });
});

describe('dispatch fleet LH truck suggestions', () => {
  type FleetResponse = {
    items: Array<{ id: number; licensePlate: string }>;
    suggestedItems: Array<{ truckId: number; plateNumber: string; reasons: Array<'D-1_DROP' | 'D+1_PICKUP'> }>;
    total: number;
    nextCursor: string | null;
  };

  // Target lot on D=2026-08-20 with an LH-zoned dropoff port on its container.
  async function createTargetWithLhPort(args: { dropoffLh: boolean; pickupLh: boolean; deliveryDate: string }) {
    const customer = await createCustomer(`Sugg target ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const site = await createOperationalSite(customer.id);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      routeId: route.id,
      cargoMode: 'FCL',
      shipmentCode: `SUG-${suffix}-${createdShipmentIds.length}`,
      bookingRef: `SUG-BOOK-${suffix}-${createdShipmentIds.length}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-20T08:00:00.000Z'),
      tradeDirection: 'EXPORT',
      operationalSiteId: site.id,
      expectedDeliveryDate: args.deliveryDate,
      createdBy: adminUserId,
    }).returning();
    createdShipmentIds.push(shipment.id);
    const containerType = await createContainerType('20G');
    const [lhPort] = await db.insert(s.ports).values({
      name: `Sugg LH port ${suffix}-${createdPortIds.length}`,
      dispatchZone: 'LACH_HUYEN',
    }).returning();
    createdPortIds.push(lhPort.id);
    const [plainPort] = await db.insert(s.ports).values({ name: `Sugg plain port ${suffix}-${createdPortIds.length}` }).returning();
    createdPortIds.push(plainPort.id);
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: containerType.id,
      containerNumber: `SUG${String(500000 + shipment.id).slice(-6)}`,
      pickupPortId: args.pickupLh ? lhPort.id : plainPort.id,
      dropoffPortId: args.dropoffLh ? lhPort.id : plainPort.id,
      createdBy: adminUserId,
    }).returning();
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: { deliverySite: { id: site.id, name: site.name, address: site.address } },
      plannedCarrierType: 'OWN',
      createdBy: adminUserId,
    }).returning();
    return { shipment, fulfillment, lhPort };
  }

  // Evidence lot: an OWN-planned fulfillment on some date whose plate matches
  // an owned truck.
  async function createEvidenceLot(args: {
    plate: string;
    workDate: string | null;
    lhPortId: number | null;
    atLhDropoff: boolean;
    canceled?: boolean;
  }) {
    const customer = await createCustomer(`Sugg evidence ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      routeId: route.id,
      cargoMode: 'FCL',
      shipmentCode: `SGE-${suffix}-${createdShipmentIds.length}`,
      bookingRef: `SGE-BOOK-${suffix}-${createdShipmentIds.length}`,
      status: 'READY_FOR_DISPATCH',
      closingAt: new Date('2026-08-20T08:00:00.000Z'),
      tradeDirection: 'EXPORT',
      expectedDeliveryDate: args.workDate,
      createdBy: adminUserId,
    }).returning();
    createdShipmentIds.push(shipment.id);
    const containerType = await createContainerType('20G');
    const [port] = await db.insert(s.ports).values({ name: `SGE port ${suffix}-${createdPortIds.length}` }).returning();
    createdPortIds.push(port.id);
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: containerType.id,
      containerNumber: `SGE${String(600000 + shipment.id).slice(-6)}`,
      pickupPortId: args.atLhDropoff ? port.id : (args.lhPortId ?? port.id),
      dropoffPortId: args.atLhDropoff ? (args.lhPortId ?? port.id) : port.id,
      createdBy: adminUserId,
    }).returning();
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      plannedCarrierType: 'OWN',
      plannedVehiclePlateNumber: args.plate,
      canceledAt: args.canceled ? new Date() : null,
      createdBy: adminUserId,
    }).returning();
    return { shipment, fulfillment };
  }

  test('D-1 LH dropoff and D+1 LH pickup surface as ranked reasons; canceled evidence ignored', async () => {
    const { fulfillment: target } = await createTargetWithLhPort({ dropoffLh: true, pickupLh: false, deliveryDate: '2026-08-20' });
    const { truck: truckA } = await createOwnedTruckWithDriver();
    const { truck: truckB } = await createOwnedTruckWithDriver();

    // LH port id comes from the target fixture's zoned port.
    const [targetContainer] = await db.select({ dropoffPortId: s.shipmentContainers.dropoffPortId })
      .from(s.shipmentFulfillments)
      .innerJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
      .where(eq(s.shipmentFulfillments.id, target.id));
    const lhPortId = targetContainer.dropoffPortId!;

    // truckA: LH dropoff on D-1 (2026-08-19) → D-1_DROP.
    await createEvidenceLot({ plate: truckA.licensePlate, workDate: '2026-08-19', lhPortId, atLhDropoff: true });
    // truckB: LH pickup on D+1 (2026-08-21) → D+1_PICKUP.
    await createEvidenceLot({ plate: truckB.licensePlate, workDate: '2026-08-21', lhPortId, atLhDropoff: false });
    // truckA canceled evidence — must not surface.
    await createEvidenceLot({ plate: truckA.licensePlate, workDate: '2026-08-21', lhPortId, atLhDropoff: false, canceled: true });

    const response = await apiFetch<FleetResponse>(`/dispatch-fleet?resource=TRUCK&limit=100&fulfillmentId=${target.id}`, {
      token: dispatcherToken,
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const suggested = response.data.suggestedItems ?? [];
    const truckASuggestion = suggested.find((item) => item.truckId === truckA.id);
    const truckBSuggestion = suggested.find((item) => item.truckId === truckB.id);
    assert.ok(truckASuggestion, `truckA expected in suggestions: ${JSON.stringify(suggested)}`);
    assert.deepEqual(truckASuggestion.reasons, ['D-1_DROP']);
    assert.ok(truckBSuggestion, `truckB expected in suggestions: ${JSON.stringify(suggested)}`);
    assert.deepEqual(truckBSuggestion.reasons, ['D+1_PICKUP']);
    // Reasons only — no shipment codes or customer names leak.
    assert.deepEqual(Object.keys(truckASuggestion).sort(), ['plateNumber', 'reasons', 'truckId']);
  });

  test('both signals rank first; neither-signal trucks and no-context calls stay unsuggested', async () => {
    const { fulfillment: target } = await createTargetWithLhPort({ dropoffLh: true, pickupLh: false, deliveryDate: '2026-08-20' });
    const [targetContainer] = await db.select({ dropoffPortId: s.shipmentContainers.dropoffPortId })
      .from(s.shipmentFulfillments)
      .innerJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
      .where(eq(s.shipmentFulfillments.id, target.id));
    const lhPortId = targetContainer.dropoffPortId!;
    const { truck } = await createOwnedTruckWithDriver();
    await createEvidenceLot({ plate: truck.licensePlate, workDate: '2026-08-19', lhPortId, atLhDropoff: true });
    await createEvidenceLot({ plate: truck.licensePlate, workDate: '2026-08-21', lhPortId, atLhDropoff: false });

    const both = await apiFetch<FleetResponse>(`/dispatch-fleet?resource=TRUCK&limit=100&fulfillmentId=${target.id}`, {
      token: dispatcherToken,
    });
    assert.equal(both.status, 200);
    const bothSuggestion = (both.data.suggestedItems ?? []).find((item) => item.truckId === truck.id);
    assert.ok(bothSuggestion);
    assert.deepEqual(bothSuggestion.reasons, ['D-1_DROP', 'D+1_PICKUP']);
    assert.equal((both.data.suggestedItems ?? [])[0]!.truckId, truck.id, 'both-signals truck ranks first');

    // No fulfillmentId → no suggestedItems at all (legacy callers unaffected).
    const plain = await apiFetch<FleetResponse>('/dispatch-fleet?resource=TRUCK&limit=100', { token: dispatcherToken });
    assert.equal(plain.status, 200);
    assert.deepEqual(plain.data.suggestedItems ?? [], []);
  });

  test('search narrows suggestions; current plate preserved outside suggestion set', async () => {
    const { fulfillment: target } = await createTargetWithLhPort({ dropoffLh: true, pickupLh: false, deliveryDate: '2026-08-20' });
    const [targetContainer] = await db.select({ dropoffPortId: s.shipmentContainers.dropoffPortId })
      .from(s.shipmentFulfillments)
      .innerJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
      .where(eq(s.shipmentFulfillments.id, target.id));
    const lhPortId = targetContainer.dropoffPortId!;
    const { truck } = await createOwnedTruckWithDriver();
    await createEvidenceLot({ plate: truck.licensePlate, workDate: '2026-08-19', lhPortId, atLhDropoff: true });

    const searched = await apiFetch<FleetResponse>(
      `/dispatch-fleet?resource=TRUCK&limit=100&fulfillmentId=${target.id}&q=${encodeURIComponent(truck.licensePlate.slice(0, 4))}`,
      { token: dispatcherToken },
    );
    assert.equal(searched.status, 200);
    assert.ok((searched.data.suggestedItems ?? []).some((item) => item.truckId === truck.id), 'search-matched suggestion kept');

    const missed = await apiFetch<FleetResponse>(
      `/dispatch-fleet?resource=TRUCK&limit=100&fulfillmentId=${target.id}&q=ZZZZ`,
      { token: dispatcherToken },
    );
    assert.equal(missed.status, 200);
    assert.deepEqual((missed.data.suggestedItems ?? []).filter((item) => item.truckId === truck.id), [], 'non-matching search drops suggestion');

    // Inaccessible target (random id) → no suggestions, request still 200.
    const stale = await apiFetch<FleetResponse>('/dispatch-fleet?resource=TRUCK&limit=100&fulfillmentId=99999999', {
      token: dispatcherToken,
    });
    assert.equal(stale.status, 200);
    assert.deepEqual(stale.data.suggestedItems ?? [], []);
  });

  describe('presence endpoint (all trucks with zone evidence for a viewing date)', () => {
    type PresenceResponse = {
      date: string;
      zone: string;
      zoneLabel: string;
      items: Array<{
        truckId: number;
        plateNumber: string;
        evidence: Array<{ reason: 'D-1_DROP' | 'D+1_PICKUP'; date: string; containerNumber: string | null; portName: string }>;
      }>;
    };

    function createLhPort(nameSeed: string) {
      return db.insert(s.ports).values({
        name: `Presence LH port ${suffix}-${nameSeed}-${createdPortIds.length}`,
        dispatchZone: 'LACH_HUYEN',
      }).returning();
    }

    test('returns trucks with D-1 drop and D+1 pickup evidence; canceled lots excluded', async () => {
      const [lhPortA] = await createLhPort('a');
      createdPortIds.push(lhPortA.id);
      const [lhPortB] = await createLhPort('b');
      createdPortIds.push(lhPortB.id);
      const { truck: truckA } = await createOwnedTruckWithDriver();
      const { truck: truckB } = await createOwnedTruckWithDriver();
      const { truck: truckC } = await createOwnedTruckWithDriver();

      // truckA: dropoff at LH on D-1 → ready for an LH order on D.
      await createEvidenceLot({ plate: truckA.licensePlate, workDate: '2026-08-19', lhPortId: lhPortA.id, atLhDropoff: true });
      // truckB: pickup from LH on D+1 → committed to LH.
      await createEvidenceLot({ plate: truckB.licensePlate, workDate: '2026-08-21', lhPortId: lhPortB.id, atLhDropoff: false });
      // truckC: canceled evidence — must not surface.
      await createEvidenceLot({ plate: truckC.licensePlate, workDate: '2026-08-19', lhPortId: lhPortA.id, atLhDropoff: true, canceled: true });
      // Noise: same truck on a date too far away to matter.
      await createEvidenceLot({ plate: truckA.licensePlate, workDate: '2026-08-17', lhPortId: lhPortA.id, atLhDropoff: true });

      const response = await apiFetch<PresenceResponse>('/dispatch-zone-truck-presence?zone=LACH_HUYEN&date=2026-08-20', {
        token: dispatcherToken,
      });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.equal(response.data.date, '2026-08-20');
      const items = response.data.items;

      const truckAItem = items.find((item) => item.truckId === truckA.id);
      assert.ok(truckAItem, `truckA expected in presence: ${JSON.stringify(items)}`);
      assert.equal(truckAItem.plateNumber, truckA.licensePlate);
      assert.equal(truckAItem.evidence.length, 1);
      assert.equal(truckAItem.evidence[0]!.reason, 'D-1_DROP');
      assert.equal(truckAItem.evidence[0]!.date, '2026-08-19');
      assert.equal(truckAItem.evidence[0]!.portName, lhPortA.name);

      const truckBItem = items.find((item) => item.truckId === truckB.id);
      assert.ok(truckBItem);
      assert.equal(truckBItem.evidence[0]!.reason, 'D+1_PICKUP');
      assert.equal(truckBItem.evidence[0]!.date, '2026-08-21');

      assert.ok(!items.some((item) => item.truckId === truckC.id), 'canceled evidence must not surface');

      // Evidence shape: containerNumber + portName only — no shipment/customer.
      for (const item of items) {
        for (const ev of item.evidence) {
          assert.deepEqual(Object.keys(ev).sort(), ['containerNumber', 'date', 'portName', 'reason']);
        }
      }
    });

    test('missing date defaults to today (Asia/Ho_Chi_Minh)', async () => {
      const [lhPort] = await createLhPort('today');
      createdPortIds.push(lhPort.id);
      const { truck } = await createOwnedTruckWithDriver();
      const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
      // Evidence dated today is neither D-1 nor D+1 of today → empty result.
      await createEvidenceLot({ plate: truck.licensePlate, workDate: today, lhPortId: lhPort.id, atLhDropoff: true });

      const response = await apiFetch<PresenceResponse>('/dispatch-zone-truck-presence?zone=LACH_HUYEN', { token: dispatcherToken });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.match(response.data.date, /^\d{4}-\d{2}-\d{2}$/);
      if (response.data.date === today) {
        // Other cases in this suite intentionally create D-1/D+1 evidence
        // for the real business date. Verify this case's own truck is absent
        // instead of assuming a globally empty shared test database.
        assert.ok(!response.data.items.some((item) => item.truckId === truck.id));
      }
    });

    test('non-dispatch role forbidden; garbage date rejected', async () => {
      const denied = await apiFetch('/dispatch-zone-truck-presence?zone=LACH_HUYEN&date=2026-08-20', { token: driverToken });
      assert.equal(denied.status, 403);

      const garbage = await apiFetch('/dispatch-zone-truck-presence?zone=LACH_HUYEN&date=20-08-2026', { token: dispatcherToken });
      assert.equal(garbage.status, 400);
    });
  });
});

describe('review fixes: carrier switch + explicit plate clear', () => {
  test('carrier switch without a vehicle block clears the previous carrier plate', async () => {
    const carrier = await createCustomer(`Fix ext carrier ${suffix}-${createdCustomerIds.length}`, true);
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const [fulfillment] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const [shipment] = await db.select().from(s.shipments)
      .where(eq(s.shipments.id, fulfillment.shipmentId));

    // Plate the OWN row first.
    const plated = await apiFetch(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, truckId: truck.id },
    });
    assert.equal(plated.status, 200, JSON.stringify(plated.data));

    // Now switch to EXTERNAL with NO vehicle fields — the stored own-truck
    // plate must be cleared, not silently retained.
    const [fresh] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillment.id));
    const switched = await apiFetch(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fresh.version,
        expectedShipmentVersion: shipment.version,
        carrierType: 'EXTERNAL',
        externalCarrierId: carrier.id,
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
        isCombined: shipment.isCombined,
      },
    });
    assert.equal(switched.status, 200, JSON.stringify(switched.data));
    const [after] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillment.id));
    assert.equal(after.plannedVehiclePlateNumber, null, 'foreign plate must not survive a carrier switch');
    assert.equal(after.plannedExternalCarrierVehicleId, null, 'vehicle link must not survive a carrier switch');
    assert.equal(after.plannedCarrierType, 'EXTERNAL');
  });

  test('clearVehicle=true explicitly unassigns the plate through the atomic save', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const [fulfillment] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const [shipment] = await db.select().from(s.shipments)
      .where(eq(s.shipments.id, fulfillment.shipmentId));

    const plated = await apiFetch(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, truckId: truck.id },
    });
    assert.equal(plated.status, 200);

    const [fresh] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillment.id));
    const cleared = await apiFetch(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fresh.version,
        expectedShipmentVersion: shipment.version,
        carrierType: 'OWN',
        clearVehicle: true,
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
        isCombined: shipment.isCombined,
      },
    });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
    const [after] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillment.id));
    assert.equal(after.plannedVehiclePlateNumber, null, 'clearVehicle must unassign the plate');
  });
});

describe('driver notification timing (xếp xe stays silent, issuance notifies)', () => {
  type IssueResponse = { trip: { id: number } };

  test('legacy plate assignment alone: no driver notification, tap-through 404', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck, driver } = await createOwnedTruckWithDriver();
    const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));

    const plated = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, truckId: truck.id },
    });
    assert.equal(plated.status, 200, JSON.stringify(plated.data));
    // Derived-driver display survives for the dispatcher; the notification does not.
    assert.equal(plated.data.assignedDriverId, driver.id);
    assert.equal(plated.data.driverNotified, false);

    assert.equal((await countDispatchNotifications(fulfillment.id)).length, 0, 'plate-only assignment must not notify');

    const token = signToken({ id: driver.userId!, username: null, role: Role.DRIVER });
    const detail = await driverFetch(`/fulfillments/${fulfillment.id}`, token);
    assert.equal(detail.status, 404, 'driver must not be able to open a not-yet-issued job');
  });

  test('atomic plan save alone: no driver notification, tap-through 404', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck, driver } = await createOwnedTruckWithDriver();
    const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const [shipment] = await db.select().from(s.shipments).where(eq(s.shipments.id, fulfillment.shipmentId));

    const saved = await apiFetch<PlateResponse & { driverNotified: boolean }>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: shipment.version,
        carrierType: 'OWN',
        truckId: truck.id,
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
        isCombined: shipment.isCombined,
      },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.driverNotified, false);

    assert.equal((await countDispatchNotifications(fulfillment.id)).length, 0, 'plan-only save must not notify');

    const token = signToken({ id: driver.userId!, username: null, role: Role.DRIVER });
    const detail = await driverFetch(`/fulfillments/${fulfillment.id}`, token);
    assert.equal(detail.status, 404, 'driver must not be able to open a not-yet-issued job');
  });

test('issuing the dispatch order notifies the driver exactly once and the job opens', async () => {
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck, driver } = await createOwnedTruckWithDriver();
    const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));

    // Step 1 — xếp xe via the legacy endpoint: silent.
    const plated = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, truckId: truck.id },
    });
    assert.equal(plated.status, 200, JSON.stringify(plated.data));
    assert.equal((await countDispatchNotifications(fulfillment.id)).length, 0);

    // Step 2 — issue the dispatch order: the existing issuance notification
    // fires exactly once, sourced from the persisted trips row.
    const issued = await apiFetch<IssueResponse>(`/${shipment.id}/dispatch`, {
      method: 'POST',
      token: dispatcherToken,
      body: {
        fulfillmentId: fulfillment.id,
        expectedVersion: plated.data.version,
        plannedStartAt: '2026-08-20T08:00:00+07:00',
        plannedEndAt: '2026-08-20T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: truck.id,
        driverId: driver.id,
      },
    });
    assert.equal(issued.status, 201, JSON.stringify(issued.data));
    createdTripIds.push(issued.data.trip.id);

    const notes = await countDispatchNotifications(fulfillment.id);
    assert.equal(notes.length, 1, 'issuance must notify exactly once');
    assert.equal(notes[0]!.title, 'Lệnh điều xe mới');

    // Step 3 — the driver can now open the job (the original repro's 404).
    const token = signToken({ id: driver.userId!, username: null, role: Role.DRIVER });
    const detail = await driverFetch(`/fulfillments/${fulfillment.id}`, token);
    assert.equal(detail.status, 200, JSON.stringify(detail.data));
  });
});

describe('dispatch task tags and driver-note plan save', () => {
  const tagFetch = async <T>(method: string, body?: unknown) => apiFetch<T>('/dispatch-task-tags', {
    method,
    token: dispatcherToken,
    ...(body !== undefined ? { body } : {}),
  });

  // Local copy of the atomic-save describe's helper (it is describe-scoped).
  const fetchShipmentAndFulfillment = async (fulfillmentId: number) => {
    const [fulfillment] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillmentId));
    const [shipment] = await db.select().from(s.shipments)
      .where(eq(s.shipments.id, fulfillment.shipmentId));
    return { shipment, fulfillment };
  };

  test('GET lists the migration-seeded pool', async () => {
    const response = await tagFetch<{ items: Array<{ id: number; label: string }> }>('GET');
    assert.equal(response.status, 200);
    const labels = response.data.items.map((item) => item.label);
    // 2026-09-10 (ticket a6cb2543, migration 0066): the pool is the canonical
    // 14-tag operation set. The old lowercase taxonomy ("Đặt đầu", "Gửi bãi",
    // …) was deactivated — its labels must NOT resurface.
    for (const seed of ['HẾT HẠN', 'ĐẢO VỎ', 'ĐẶT ĐUÔI', 'ĐẶT ĐẦU', 'KIỂM HÓA', 'QUAY ĐẦU', 'GỬI VỎ BÃI ĐĂNG KHOA', 'QUÁ TẢI', 'ĐẢO HÀNG', 'HẠ VỎ ICD QUẾ VÕ', 'GẮP VỎ ICD QUẾ VÕ', 'GẮP VỎ BÃI ĐĂNG KHOA', 'HẠ VỎ BÃI TRI PHƯƠNG', 'GẮP VỎ BÃI TRI PHƯƠNG']) {
      assert.ok(labels.includes(seed), `seed tag ${seed} missing from pool`);
    }
    for (const retired of ['Đặt đầu', 'Gửi bãi', 'Trả vỏ', 'Di động']) {
      assert.ok(!labels.includes(retired), `retired tag ${retired} resurfaced in pool`);
    }
  });

  test('GET denies drivers once the journey board embeds the pool (ticket 53a536f9)', async () => {
    // 53a536f9: the driver portal reads the tag pool from the journey-board
    // response (knownTagLabels) instead of this endpoint, so the B1 casbin
    // bypass is removed and the pool is dispatcher-only again. The
    // journey-board knownTagLabels contract is pinned in
    // driver-journey-board-fields.test.ts.
    const response = await apiFetch<{ message: string }>('/dispatch-task-tags', {
      method: 'GET',
      token: driverToken,
    });
    assert.equal(response.status, 403, JSON.stringify(response.data));
  });

  test('POST creates a tag and duplicate (case/diacritics-insensitive) yields 409', async () => {
    const label = `Chạy đêm ${suffix}`;
    const created = await tagFetch<{ id: number; label: string }>('POST', { label });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.label, label);

    const duplicate = await tagFetch<{ message: string }>('POST', { label: `  ${label.toUpperCase()}  ` });
    assert.equal(duplicate.status, 409);

    const list = await tagFetch<{ items: Array<{ id: number; label: string }> }>('GET');
    assert.equal(list.data.items.filter((item) => item.label === label).length, 1);
    // Cleanup this test's row (seed rows stay).
    await db.delete(s.dispatchTaskTags).where(eq(s.dispatchTaskTags.label, label));
  });

  test('POST validation: empty label 400, over-80 label 400, semicolon 400, DRIVER 403', async () => {
    const empty = await tagFetch<{ message: string }>('POST', { label: '   ' });
    assert.equal(empty.status, 400);
    const tooLong = await tagFetch<{ message: string }>('POST', { label: 'x'.repeat(81) });
    assert.equal(tooLong.status, 400);
    // ';' is the note-composer separator — a label containing it would never
    // re-parse as a chip and would duplicate on re-toggle.
    const semicolon = await tagFetch<{ message: string }>('POST', { label: 'Đón; trả' });
    assert.equal(semicolon.status, 400);
    const driverAttempt = await apiFetch<{ message: string }>('/dispatch-task-tags', {
      method: 'POST',
      token: driverToken,
      body: { label: 'Không được' },
    });
    assert.equal(driverAttempt.status, 403);
  });

  type NotePlanResponse = {
    fulfillmentVersion: number;
    shipmentVersion: number;
    isCombined: boolean;
    operationalNotes: string | null;
  };

  test('note rides the atomic save and persists to shipments.operational_notes', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { shipment: freshShipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);
    const note = 'Đặt đầu; Lấy vỏ ICD đi đóng; gọi lái trước 30p';

    const response = await apiFetch<NotePlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: freshShipment.version,
        carrierType: 'OWN',
        plannedRevenue: 1_500_000,
        plannedCarrierCost: 1_000_000,
        classification: 'SINGLE',
        isCombined: freshShipment.isCombined,
        operationalNotes: note,
      },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.operationalNotes, note);
    assert.equal(response.data.shipmentVersion, freshShipment.version + 1);
    const { shipment: after } = await fetchShipmentAndFulfillment(fulfillment.id);
    assert.equal(after.operationalNotes, note);
  });

  test('unchanged note → shipment version NOT bumped; omitted note → stored note untouched', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { shipment: freshShipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);

    const first = await apiFetch<NotePlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: freshShipment.version,
        carrierType: 'OWN',
        plannedRevenue: 0,
        plannedCarrierCost: 0,
        classification: 'SINGLE',
        isCombined: freshShipment.isCombined,
        operationalNotes: 'Đặt đuôi',
      },
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.shipmentVersion, freshShipment.version + 1);

    // Same note again → no shipment bump (fulfillment still bumps).
    const second = await apiFetch<NotePlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: first.data.fulfillmentVersion,
        expectedShipmentVersion: first.data.shipmentVersion,
        carrierType: 'OWN',
        plannedRevenue: 0,
        plannedCarrierCost: 0,
        classification: 'SINGLE',
        isCombined: freshShipment.isCombined,
        operationalNotes: 'Đặt đuôi',
      },
    });
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.shipmentVersion, first.data.shipmentVersion);

    // Omitted note → stored note untouched, still no shipment bump.
    const third = await apiFetch<NotePlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: second.data.fulfillmentVersion,
        expectedShipmentVersion: second.data.shipmentVersion,
        carrierType: 'OWN',
        plannedRevenue: 0,
        plannedCarrierCost: 0,
        classification: 'SINGLE',
        isCombined: freshShipment.isCombined,
      },
    });
    assert.equal(third.status, 200);
    assert.equal(third.data.shipmentVersion, second.data.shipmentVersion);
    const { shipment: after } = await fetchShipmentAndFulfillment(fulfillment.id);
    assert.equal(after.operationalNotes, 'Đặt đuôi');
  });

  test('empty note clears (null ≡ ""), and >4000 chars is rejected', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { shipment: freshShipment, fulfillment } = await fetchShipmentAndFulfillment(fulfillmentIds[0]!);

    const base = {
      expectedShipmentVersion: freshShipment.version,
      carrierType: 'OWN' as const,
      plannedRevenue: 0,
      plannedCarrierCost: 0,
      classification: 'SINGLE' as const,
      isCombined: freshShipment.isCombined,
    };

    // The fixture stores a default note; sending '' clears it → one bump.
    const clearFixture = await apiFetch<NotePlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { ...base, expectedFulfillmentVersion: fulfillment.version, operationalNotes: '' },
    });
    assert.equal(clearFixture.status, 200);
    assert.equal(clearFixture.data.shipmentVersion, freshShipment.version + 1);
    assert.equal(clearFixture.data.operationalNotes, '');

    // Sending '' again is the null ≡ '' no-op: no version bump.
    const noOp = await apiFetch<NotePlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { ...base, expectedFulfillmentVersion: clearFixture.data.fulfillmentVersion, expectedShipmentVersion: clearFixture.data.shipmentVersion, operationalNotes: '' },
    });
    assert.equal(noOp.status, 200);
    assert.equal(noOp.data.shipmentVersion, clearFixture.data.shipmentVersion);
    assert.equal(noOp.data.operationalNotes, '');

    // Set a note, then clear it → bump + stored NULL.
    const setNote = await apiFetch<NotePlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { ...base, expectedFulfillmentVersion: noOp.data.fulfillmentVersion, expectedShipmentVersion: noOp.data.shipmentVersion, operationalNotes: 'Gửi bãi' },
    });
    assert.equal(setNote.status, 200);

    const clearNote = await apiFetch<NotePlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { ...base, expectedFulfillmentVersion: setNote.data.fulfillmentVersion, expectedShipmentVersion: setNote.data.shipmentVersion, operationalNotes: '' },
    });
    assert.equal(clearNote.status, 200);
    assert.equal(clearNote.data.shipmentVersion, setNote.data.shipmentVersion + 1);
    const { shipment: cleared } = await fetchShipmentAndFulfillment(fulfillment.id);
    assert.equal(cleared.operationalNotes, '');

    const tooLong = await apiFetch<{ message: string }>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { ...base, expectedFulfillmentVersion: clearNote.data.fulfillmentVersion, expectedShipmentVersion: clearNote.data.shipmentVersion, operationalNotes: 'x'.repeat(4001) },
    });
    assert.equal(tooLong.status, 400);
  });
});

describe('planning remaining containers after partial dispatch', () => {
  // Issuing the first container's order flips the lot to DISPATCHED. The old
  // READY_FOR_DISPATCH-only guards on plan save and carrier assignment then
  // stranded every remaining READY container: the editor save 409'd ("Chỉ
  // được lưu kế hoạch…") and the grid mapped it to a misleading "reload"
  // banner, so the tags/driver-note could never be saved. The guards now
  // block only terminal lots, mirroring the 2026-09-05 issuance-side fix —
  // the per-row live-trip guard keeps issued rows un-editable.
  const fetchShipmentAndFulfillment = async (fulfillmentId: number) => {
    const [fulfillment] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillmentId));
    const [shipment] = await db.select().from(s.shipments)
      .where(eq(s.shipments.id, fulfillment.shipmentId));
    return { shipment, fulfillment };
  };

  /** Plate + issue container 1 so the lot status flips to DISPATCHED while
   *  container 2 stays READY — the partial-dispatch state under test. */
  async function issueFirstContainer(lot: { shipment: { id: number }; fulfillmentIds: number[] }) {
    const { truck, driver } = await createOwnedTruckWithDriver();
    const [first] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, lot.fulfillmentIds[0]!));
    const plated = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${lot.fulfillmentIds[0]}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: first.version, truckId: truck.id },
    });
    assert.equal(plated.status, 200, JSON.stringify(plated.data));

    const issued = await apiFetch<{ trip: { id: number } }>(`/${lot.shipment.id}/dispatch`, {
      method: 'POST',
      token: dispatcherToken,
      body: {
        fulfillmentId: lot.fulfillmentIds[0],
        expectedVersion: plated.data.version,
        plannedStartAt: '2026-08-20T08:00:00+07:00',
        plannedEndAt: '2026-08-20T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: truck.id,
        driverId: driver.id,
      },
    });
    assert.equal(issued.status, 201, JSON.stringify(issued.data));
    createdTripIds.push(issued.data.trip.id);
    return { truck, driver };
  }

  test('plan save with the tags note works on the READY container after the lot flipped DISPATCHED', async () => {
    const lot = await createAllocatedLot({ carrierType: 'OWN', containerCount: 2 });
    await issueFirstContainer(lot);

    const { shipment, fulfillment } = await fetchShipmentAndFulfillment(lot.fulfillmentIds[1]!);
    assert.equal(shipment.status, 'DISPATCHED', 'precondition: the lot flipped DISPATCHED');
    assert.equal(fulfillment.version, 1);

    const response = await apiFetch<{ fulfillmentVersion: number; shipmentVersion: number; operationalNotes: string | null }>(
      `/dispatch-detail-plan-rows/${fulfillment.id}/plan`,
      {
        method: 'PATCH',
        token: dispatcherToken,
        body: {
          expectedFulfillmentVersion: fulfillment.version,
          expectedShipmentVersion: shipment.version,
          carrierType: 'OWN',
          plannedRevenue: null,
          plannedCarrierCost: null,
          classification: 'SINGLE',
          // The composer note the dispatcher could not save before the fix.
          operationalNotes: 'Trả về; Di động',
        },
      },
    );
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.operationalNotes, 'Trả về; Di động');
    assert.equal(response.data.shipmentVersion, shipment.version + 1, 'note change bumps the shipment version');
    assert.equal(response.data.fulfillmentVersion, fulfillment.version + 1);

    const rows = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    const row = rows.data.items.find((item) => item.fulfillmentId === fulfillment.id);
    assert.ok(row, 'the READY row of a DISPATCHED lot must stay listed in the grid');
    assert.equal(row.notes.vehicleNote, 'Trả về; Di động');
  });

  test('carrier reassignment stays available on the READY row of a DISPATCHED lot', async () => {
    const lot = await createAllocatedLot({ carrierType: 'OWN', containerCount: 2 });
    await issueFirstContainer(lot);
    const carrier = await createCustomer(`Detail ext carrier ${suffix}-${createdCustomerIds.length}`, true);
    const { shipment, fulfillment } = await fetchShipmentAndFulfillment(lot.fulfillmentIds[1]!);

    const response = await apiFetch<CarrierResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/carrier`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedVersion: fulfillment.version,
        carrierType: 'EXTERNAL',
        externalCarrierId: carrier.id,
      },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    void shipment;
  });

  test('plan save on the already-issued container still refuses (per-row live-trip guard)', async () => {
    const lot = await createAllocatedLot({ carrierType: 'OWN', containerCount: 2 });
    await issueFirstContainer(lot);
    const { shipment, fulfillment } = await fetchShipmentAndFulfillment(lot.fulfillmentIds[0]!);
    assert.equal(fulfillment.version, 3, 'plate + issuance each bump the version');

    const response = await apiFetch<{ error?: string; message?: string }>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: shipment.version,
        carrierType: 'OWN',
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
      },
    });
    assert.equal(response.status, 409);
    assert.match(response.data.error ?? response.data.message ?? '', /phát hành lệnh/);
  });

  test('terminal lots still refuse plan save', async () => {
    const lot = await createAllocatedLot({ carrierType: 'OWN', containerCount: 1 });
    const { shipment, fulfillment } = await fetchShipmentAndFulfillment(lot.fulfillmentIds[0]!);
    await db.update(s.shipments).set({ status: 'COMPLETED' }).where(eq(s.shipments.id, shipment.id));

    const response = await apiFetch<{ error: string }>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: {
        expectedFulfillmentVersion: fulfillment.version,
        expectedShipmentVersion: shipment.version,
        carrierType: 'OWN',
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
      },
    });
    assert.equal(response.status, 409);
    assert.match(response.data.error, /kết thúc/);
  });

  test('resolve-carrier: dashed plate normalizes to the stored form; unknown and inactive carriers return nulls', async () => {
    const active = await createCustomer(`Resolve carrier A ${suffix}-${createdCustomerIds.length}`, true);
    const inactive = await createCustomer(`Resolve carrier B ${suffix}-${createdCustomerIds.length}`, true);
    await db.update(s.customers).set({ status: 'LOCKED' }).where(eq(s.customers.id, inactive.id));
    await db.insert(s.carrierFleetVehicles).values([
      { carrierId: active.id, licensePlate: '15H-061.14', normalizedPlate: '15H06114', isActive: true, createdBy: adminUserId },
      { carrierId: inactive.id, licensePlate: '16H-070.70', normalizedPlate: '16H07070', isActive: true, createdBy: adminUserId },
    ]);

    // The dispatcher types the plate with separators — the shared normalizer
    // (uppercase + strip ALL non-alphanumerics) must still match the stored
    // alphanumeric form.
    const dashed = await apiFetch<{ carrierId: number | null; carrierName: string | null }>(
      '/carrier-fleet-vehicles/resolve-carrier?plate=15h-061.14',
      { token: dispatcherToken },
    );
    assert.equal(dashed.status, 200);
    assert.equal(dashed.data.carrierId, active.id);
    assert.equal(typeof dashed.data.carrierName, 'string');

    const unknown = await apiFetch<{ carrierId: number | null; carrierName: string | null }>(
      '/carrier-fleet-vehicles/resolve-carrier?plate=99Z-999.99',
      { token: dispatcherToken },
    );
    assert.deepEqual(unknown.data, { carrierId: null, carrierName: null });

    // A LOCKED (non-ACTIVE) carrier resolves to nulls on BOTH fields — a non-null id
    // would auto-fill the editor with an entity the dispatch write later 409s.
    const dead = await apiFetch<{ carrierId: number | null; carrierName: string | null }>(
      '/carrier-fleet-vehicles/resolve-carrier?plate=16H-070.70',
      { token: dispatcherToken },
    );
    assert.deepEqual(dead.data, { carrierId: null, carrierName: null });
  });

  // ── 2026-09-12 regression: unassigned fulfillments must appear in the detail plan ──

  test('detail plan includes fulfillments with plannedCarrierType NULL (unassigned)', async () => {
    // Create a lot manually with NO carrier assigned (carrierType: null).
    const customer = await createCustomer(`Unassigned cust ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const site = await createOperationalSite(customer.id);
    const ct = await createContainerType(`UN${createdContainerTypeIds.length}`);
    const [pp] = await db.insert(s.ports).values({ name: `Un PP ${suffix}-${createdPortIds.length}` }).returning();
    createdPortIds.push(pp.id);
    const [dp] = await db.insert(s.ports).values({ name: `Un DP ${suffix}-${createdPortIds.length}` }).returning();
    createdPortIds.push(dp.id);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      status: 'READY_FOR_DISPATCH',
      cargoMode: 'FCL',
      tradeDirection: 'EXPORT',
      operationalSiteId: site.id,
      createdBy: adminUserId,
    }).returning();
    createdShipmentIds.push(shipment.id);
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: ct.id,
      containerNumber: `UNSH${String(700000 + shipment.id).slice(-6)}`,
      routeId: route.id,
      pickupPortId: pp.id,
      dropoffPortId: dp.id,
      customerAppointmentAt: new Date('2026-09-15T08:00:00.000Z'),
      createdBy: adminUserId,
    }).returning();
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: { deliverySite: { id: site.id, name: site.name, address: site.address } },
      plannedCarrierType: null,
      createdBy: adminUserId,
    }).returning();

    // Fetch the detail plan — search by container number to avoid pagination issues.
    const response = await apiFetch<{ items: Array<{
      fulfillmentId: number;
      dispatch: { carrierType: string | null; carrierName: string | null };
      container: { containerNumber: string | null };
    }> }>(
      `/dispatch-detail-plan-rows?limit=50&q=${container.containerNumber}`,
      { token: dispatcherToken },
    );
    assert.equal(response.status, 200);
    const unassignedRow = response.data.items.find((r) => r.fulfillmentId === fulfillment.id);
    assert.ok(unassignedRow, `unassigned fulfillment ${fulfillment.id} must appear in the detail plan`);
    assert.equal(unassignedRow.dispatch.carrierType, null, 'unassigned row must have null carrierType');
  });

  test('detail plan with date filter: unassigned fulfillment with matching appointment date appears', async () => {
    // Create a lot with a specific appointment date and no carrier.
    const customer = await createCustomer(`Date filter cust ${suffix}-${createdCustomerIds.length}`);
    const route = await createRoute();
    const site = await createOperationalSite(customer.id);
    const containerTypeLocal = await createContainerType(`20G${createdContainerTypeIds.length}`);
    const appointmentDate = '2026-08-26';
    const [pickupPortLocal] = await db.insert(s.ports).values({ name: `DF pickup ${suffix}-${createdPortIds.length}` }).returning();
    createdPortIds.push(pickupPortLocal.id);
    const [dropoffPortLocal] = await db.insert(s.ports).values({ name: `DF dropoff ${suffix}-${createdPortIds.length}` }).returning();
    createdPortIds.push(dropoffPortLocal.id);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      status: 'READY_FOR_DISPATCH',
      cargoMode: 'FCL',
      operationalSiteId: site.id,
      expectedDeliveryDate: appointmentDate,
      createdBy: adminUserId,
    }).returning();
    createdShipmentIds.push(shipment.id);
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: containerTypeLocal.id,
      containerNumber: `DCNU${String(800000 + shipment.id).slice(-6)}0`,
      routeId: route.id,
      pickupPortId: pickupPortLocal.id,
      dropoffPortId: dropoffPortLocal.id,
      customerAppointmentAt: new Date(`${appointmentDate}T08:00:00.000Z`),
      createdBy: adminUserId,
    }).returning();
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: { deliverySite: { id: site.id, name: site.name, address: site.address } },
      plannedCarrierType: null,
      createdBy: adminUserId,
    }).returning();

    // Fetch with matching date filter
    const response = await apiFetch<{ items: Array<{ fulfillmentId: number; dispatch: { carrierType: string | null } }> }>(
      `/dispatch-detail-plan-rows?date=${appointmentDate}&limit=50`,
      { token: dispatcherToken },
    );
    assert.equal(response.status, 200);
    const row = response.data.items.find((r) => r.fulfillmentId === fulfillment.id);
    assert.ok(row, `unassigned fulfillment with appointmentAt=${appointmentDate} must appear when filtering by that date`);
    assert.equal(row.dispatch.carrierType, null);
  });

  // ─── BUG 5 root cause (2026-09-12): the date-driven becomesReady flip is an
  // intake path of its own — it must decompose fulfillments or the shipment
  // turns READY_FOR_DISPATCH but never reaches the detail plan (its rows
  // query inner-joins live fulfillments). Pinned by the write-path
  // regression below + the NULL-transport-date filter contract.

  test('TC-UNASSIGNED-001: appointment-driven and date-driven READY_FOR_DISPATCH flips both decompose fulfillments so the container reaches the detail plan', async () => {
    // Reproduces SHP-2609-00007 both ways its status history shows the flip:
    // the containers reconcile ("ngày đóng/trả theo container") and the
    // shipment update ("ngày vận chuyển..."). Before the fix the lot turned
    // ready with ZERO fulfillments and the detail plan (inner-join on live
    // fulfillments) never showed it.
    const customer = await createCustomer(`Bug5 customer ${suffix}-${createdCustomerIds.length}`);
    const site = await createOperationalSite(customer.id);
    const containerType = await createContainerType(`20G${createdContainerTypeIds.length}`);

    // A: appointment lands via the containers batch reconcile.
    const [shipmentA] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: null, cargoMode: 'FCL',
      shipmentCode: `BUG5A-${suffix}-${createdShipmentIds.length}`,
      bookingRef: `BOOK5A-${suffix}-${createdShipmentIds.length}`,
      status: 'PENDING_DATE', tradeDirection: 'EXPORT',
      operationalSiteId: site.id, createdBy: adminUserId,
    }).returning();
    createdShipmentIds.push(shipmentA.id);
    const [containerA] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipmentA.id, containerTypeId: containerType.id,
      containerNumber: (() => { const p = `MSKU${String(400000 + shipmentA.id).slice(-6)}`; return `${p}${calculateCheckDigit(p)}`; })(),
      createdBy: adminUserId,
    }).returning();
    const reconcile = await apiFetch<{ shipmentVersion: number }>(`/${shipmentA.id}/containers`, {
      method: 'PUT',
      token: dispatcherToken,
      body: {
        expectedVersion: shipmentA.version,
        containers: [{ id: containerA.id, containerTypeId: containerType.id, containerNumber: containerA.containerNumber, customerAppointmentAt: '2026-08-20T08:00:00.000Z' }],
      },
    });
    assert.equal(reconcile.status, 200, JSON.stringify(reconcile.data));
    const [flippedA] = await db.select({ status: s.shipments.status }).from(s.shipments).where(eq(s.shipments.id, shipmentA.id));
    assert.equal(flippedA.status, 'READY_FOR_DISPATCH');
    const fulfillmentsA = await db.select({ id: s.shipmentFulfillments.id })
      .from(s.shipmentFulfillments)
      .where(and(eq(s.shipmentFulfillments.shipmentId, shipmentA.id), isNull(s.shipmentFulfillments.canceledAt)));
    assert.ok(fulfillmentsA.length > 0, 'appointment-driven becomesReady must decompose fulfillments');

    // B: delivery date lands via the plain shipment update.
    const [shipmentB] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: null, cargoMode: 'FCL',
      shipmentCode: `BUG5B-${suffix}-${createdShipmentIds.length}`,
      bookingRef: `BOOK5B-${suffix}-${createdShipmentIds.length}`,
      status: 'PENDING_DATE', tradeDirection: 'EXPORT',
      operationalSiteId: site.id, createdBy: adminUserId,
    }).returning();
    createdShipmentIds.push(shipmentB.id);
    await db.insert(s.shipmentContainers).values({
      shipmentId: shipmentB.id, containerTypeId: containerType.id,
      containerNumber: (() => { const p = `MSKU${String(500000 + shipmentB.id).slice(-6)}`; return `${p}${calculateCheckDigit(p)}`; })(),
      customerAppointmentAt: new Date('2026-08-20T08:00:00.000Z'),
      createdBy: adminUserId,
    });
    const updated = await apiFetch<{ status: string }>(`/${shipmentB.id}`, {
      method: 'PUT',
      token: dispatcherToken,
      body: { expectedVersion: shipmentB.version, expectedDeliveryDate: '2026-08-20' },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.equal(updated.data.status, 'READY_FOR_DISPATCH');
    const fulfillmentsB = await db.select({ id: s.shipmentFulfillments.id })
      .from(s.shipmentFulfillments)
      .where(and(eq(s.shipmentFulfillments.shipmentId, shipmentB.id), isNull(s.shipmentFulfillments.canceledAt)));
    assert.ok(fulfillmentsB.length > 0, 'date-driven becomesReady must decompose fulfillments');

    // Both lots must now ride the detail plan as unassigned rows.
    // The shared dev DB carries hundreds of plan rows — target each lot by
    // its unique shipment code instead of scanning page 1 of the whole grid.
    const rowsA = await fetchRows(dispatcherToken, `?limit=50&q=${shipmentA.shipmentCode}`);
    const rowsB = await fetchRows(dispatcherToken, `?limit=50&q=${shipmentB.shipmentCode}`);
    const rowA = rowsA.data.items.find((r) => r.shipmentId === shipmentA.id);
    const rowB = rowsB.data.items.find((r) => r.shipmentId === shipmentB.id);
    assert.ok(rowA, 'appointment-flipped container appears in the detail plan');
    assert.ok(rowB, 'date-flipped container appears in the detail plan');
    assert.equal(rowA!.dispatch.carrierType, null, 'carrier cell renders unassigned');
    assert.ok(rowA!.fulfillmentId != null && rowA!.version != null, 'row is renderable');
  });

  test('TC-UNASSIGNED-004: a specific date filter excludes a fulfillment whose transport date is NULL', async () => {
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: null });
    const [container] = await db.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, shipment.id)).limit(1);
    await db.update(s.shipmentContainers).set({ customerAppointmentAt: null }).where(eq(s.shipmentContainers.id, container.id));
    await db.update(s.shipments).set({ expectedDeliveryDate: null }).where(eq(s.shipments.id, shipment.id));

    const rows = await fetchRows(dispatcherToken, '?limit=50&date=2026-08-20');
    const row = rows.data.items.find((r) => r.fulfillmentId === fulfillmentIds[0]);
    assert.equal(row, undefined, 'NULL transport date cannot match a specific date');
  });
  // ─── BUG 5 secondary (9e ruling): fulfillment-less branch + decompose seam ──

  test('DSP-PAGE-01: mixed fulfillment and branch rows paginate once globally without losing containers', async () => {
    const group = `MERGED-${suffix}`;
    const planned = await createAllocatedLot({ carrierType: 'OWN', containerCount: 2 });
    const branch = await createAllocatedLot({ carrierType: null, containerCount: 3 });
    await db.update(s.shipments).set({ bookingRef: `${group}-planned` }).where(eq(s.shipments.id, planned.shipment.id));
    await db.update(s.shipments).set({ bookingRef: `${group}-branch` }).where(eq(s.shipments.id, branch.shipment.id));
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, branch.fulfillmentIds));
    const branchContainers = await db.select({ id: s.shipmentContainers.id }).from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, branch.shipment.id)).orderBy(s.shipmentContainers.id);
    const forty = await createContainerType('40HC');
    await db.update(s.shipments).set({ tradeDirection: 'IMPORT', bookingRef: null, blNumber: `${group}-branch` }).where(eq(s.shipments.id, branch.shipment.id));
    await db.update(s.shipmentContainers).set({ customerAppointmentAt: new Date('2026-09-30T08:00:00Z') })
      .where(eq(s.shipmentContainers.id, branchContainers[0]!.id));
    await db.update(s.shipmentContainers).set({ containerTypeId: forty.id, customerAppointmentAt: new Date('2026-09-01T08:00:00Z') })
      .where(eq(s.shipmentContainers.id, branchContainers[1]!.id));
    await db.update(s.shipmentContainers).set({ customerAppointmentAt: new Date('2026-09-02T08:00:00Z') })
      .where(eq(s.shipmentContainers.id, branchContainers[2]!.id));
    // 20ft IMPORT dates first, then 20ft EXPORT, then the earlier-dated 40ft.
    const expected = [
      `c-${branchContainers[2]!.id}`, `c-${branchContainers[0]!.id}`,
      ...planned.fulfillmentIds.map((id) => `f-${id}`),
      `c-${branchContainers[1]!.id}`,
    ];
    const seen: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await fetchRows(dispatcherToken, `?q=${group}&limit=2&page=${page}`);
      assert.equal(response.status, 200);
      assert.equal(response.data.total, 5);
      assert.equal(response.data.items.length, page === 3 ? 1 : 2, 'every non-final page must be full');
      seen.push(...response.data.items.map((row) => row.fulfillmentId == null ? `c-${row.shipmentContainerId}` : `f-${row.fulfillmentId}`));
    }
    assert.deepEqual(seen, expected, 'both sources share a single page boundary; no skipped or duplicated rows');
    const pastEnd = await fetchRows(dispatcherToken, `?q=${group}&limit=2&page=4`);
    assert.equal(pastEnd.data.total, 5);
    assert.deepEqual(pastEnd.data.items, []);
    const imports = await fetchRows(dispatcherToken, `?q=${group}&limit=2&page=2&direction=IMPORT`);
    assert.equal(imports.data.total, 3);
    assert.deepEqual(imports.data.items.map((row) => row.shipmentContainerId), [branchContainers[1]!.id]);
    const assigned = await fetchRows(dispatcherToken, `?q=${group}&limit=2&page=1&assignmentStatus=ASSIGNED`);
    assert.equal(assigned.data.total, 0);
    assert.deepEqual(assigned.data.items, []);

  });

  test('UNION-branch: a READY lot with NO fulfillments surfaces as an unassigned row (row + total)', async () => {
    const customer = await createCustomer(`Union customer ${suffix}-${createdCustomerIds.length}`);
    const site = await createOperationalSite(customer.id);
    const ct = await createContainerType(`UL${createdContainerTypeIds.length}`);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: null, cargoMode: 'FCL',
      status: 'READY_FOR_DISPATCH', tradeDirection: 'EXPORT',
      operationalSiteId: site.id, createdBy: adminUserId,
      shipmentCode: `UNION-${suffix}-${createdShipmentIds.length}`,
    }).returning();
    createdShipmentIds.push(shipment.id);
    await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id, containerTypeId: ct.id,
      containerNumber: `UNION${String(800000 + shipment.id).slice(-6)}`,
      customerAppointmentAt: new Date('2026-08-20T08:00:00.000Z'),
      createdBy: adminUserId,
    });

    const rows = await fetchRows(dispatcherToken, `?limit=50&q=${shipment.shipmentCode}`);
    const row = rows.data.items.find((r) => r.shipmentId === shipment.id);
    assert.ok(row, 'fulfillment-less READY container surfaces via the union branch');
    assert.equal(row.fulfillmentId, null, 'no fulfillment id on a branch row');
    assert.ok(Number.isInteger(row.shipmentContainerId), 'branch row carries its container id on the wire (decompose entrypoint)');
    assert.equal(row.dispatch.carrierType, null, 'carrier cell renders unassigned');
    assert.equal(row.dispatch.tripId, null);
    assert.ok(rows.data.total >= 1, 'total counts the branch row');
  });

  test('UNION-branch: route-less container on a routed lot shows the shipment route (same fallback as the rows branch)', async () => {
    const customer = await createCustomer(`UnionR customer ${suffix}-${createdCustomerIds.length}`);
    const site = await createOperationalSite(customer.id);
    const ct = await createContainerType(`UR${createdContainerTypeIds.length}`);
    const lotRoute = await createRoute();
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: lotRoute.id, cargoMode: 'FCL',
      status: 'READY_FOR_DISPATCH', tradeDirection: 'EXPORT',
      operationalSiteId: site.id, createdBy: adminUserId,
      shipmentCode: `UNIONR-${suffix}-${createdShipmentIds.length}`,
    }).returning();
    createdShipmentIds.push(shipment.id);
    await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id, containerTypeId: ct.id,
      // Deliberately NO container routeId — the lot-level route must surface
      // on the branch row exactly as CUS shows it.
      containerNumber: `UNIONR${String(810000 + shipment.id).slice(-6)}`,
      customerAppointmentAt: new Date('2026-08-20T08:00:00.000Z'),
      createdBy: adminUserId,
    });

    const rows = await fetchRows(dispatcherToken, `?limit=50&q=${shipment.shipmentCode}`);
    const row = rows.data.items.find((r) => r.shipmentId === shipment.id);
    assert.ok(row, 'branch row renders');
    assert.equal(row.customerRoute.routeName, lotRoute.name);
  });

  test('UNION-branch: date filter matches the branch row by its appointment; a NULL-dated branch row only shows unfiltered', async () => {
    const customer = await createCustomer(`UnionB customer ${suffix}-${createdCustomerIds.length}`);
    const site = await createOperationalSite(customer.id);
    const ct = await createContainerType(`UB${createdContainerTypeIds.length}`);
    const mk = async (dated: boolean, tag: string) => {
      const [shipment] = await db.insert(s.shipments).values({
        customerId: customer.id, routeId: null, cargoMode: 'FCL',
        status: 'READY_FOR_DISPATCH', tradeDirection: 'EXPORT',
        operationalSiteId: site.id, createdBy: adminUserId,
        shipmentCode: `${tag}-${suffix}-${createdShipmentIds.length}`,
      }).returning();
      createdShipmentIds.push(shipment.id);
      await db.insert(s.shipmentContainers).values({
        shipmentId: shipment.id, containerTypeId: ct.id,
        containerNumber: `${tag}${String(810000 + shipment.id).slice(-6)}`,
        ...(dated ? { customerAppointmentAt: new Date('2026-08-21T08:00:00.000Z') } : {}),
        createdBy: adminUserId,
      });
      return shipment;
    };
    const dated = await mk(true, 'UND');
    const undated = await mk(false, 'UNN');

    const filtered = await fetchRows(dispatcherToken, `?limit=50&q=${dated.shipmentCode}&date=2026-08-21`);
    assert.ok(filtered.data.items.some((r) => r.shipmentId === dated.id), 'dated branch row matches its date');

    const undatedFiltered = await fetchRows(dispatcherToken, `?limit=50&q=${undated.shipmentCode}&date=2026-08-21`);
    assert.ok(!undatedFiltered.data.items.some((r) => r.shipmentId === undated.id), 'NULL-dated branch row excluded by a date filter');

    const undatedOpen = await fetchRows(dispatcherToken, `?limit=50&q=${undated.shipmentCode}`);
    assert.ok(undatedOpen.data.items.some((r) => r.shipmentId === undated.id), 'NULL-dated branch row visible unfiltered');
  });

  test('UNION-branch: PENDING_DATE lots stay out (READY_FOR_DISPATCH only)', async () => {
    const customer = await createCustomer(`UnionC customer ${suffix}-${createdCustomerIds.length}`);
    const ct = await createContainerType(`UC${createdContainerTypeIds.length}`);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: null, cargoMode: 'FCL',
      status: 'PENDING_DATE', tradeDirection: 'EXPORT',
      createdBy: adminUserId,
      shipmentCode: `UNP-${suffix}-${createdShipmentIds.length}`,
    }).returning();
    createdShipmentIds.push(shipment.id);
    await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id, containerTypeId: ct.id,
      containerNumber: `UNP${String(820000 + shipment.id).slice(-6)}`,
      createdBy: adminUserId,
    });

    const rows = await fetchRows(dispatcherToken, `?limit=50&q=${shipment.shipmentCode}`);
    assert.ok(!rows.data.items.some((r) => r.shipmentId === shipment.id), 'PENDING_DATE stays out of the branch');
  });

  test('UNION-branch: canceled-only fulfillments resurface until re-decomposed', async () => {
    const customer = await createCustomer(`UnionD customer ${suffix}-${createdCustomerIds.length}`);
    const site = await createOperationalSite(customer.id);
    const ct = await createContainerType(`UD${createdContainerTypeIds.length}`);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: null, cargoMode: 'FCL',
      status: 'READY_FOR_DISPATCH', tradeDirection: 'EXPORT',
      operationalSiteId: site.id, createdBy: adminUserId,
      shipmentCode: `UNC-${suffix}-${createdShipmentIds.length}`,
    }).returning();
    createdShipmentIds.push(shipment.id);
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id, containerTypeId: ct.id,
      containerNumber: `UNC${String(830000 + shipment.id).slice(-6)}`,
      createdBy: adminUserId,
    }).returning();
    await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL',
      shipmentContainerId: container.id, sourceShipmentVersion: shipment.version,
      canceledAt: new Date(), createdBy: adminUserId,
    });

    const rows = await fetchRows(dispatcherToken, `?limit=50&q=${shipment.shipmentCode}`);
    assert.ok(rows.data.items.some((r) => r.shipmentId === shipment.id), 'canceled-only lot resurfaces via the branch');
  });

  test('decompose: fresh fulfillment for a branch row; replay returns the SAME id; CUS denied; stale version 409', async () => {
    const customer = await createCustomer(`Dec customer ${suffix}-${createdCustomerIds.length}`);
    const site = await createOperationalSite(customer.id);
    const ct = await createContainerType(`DC${createdContainerTypeIds.length}`);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: null, cargoMode: 'FCL',
      status: 'READY_FOR_DISPATCH', tradeDirection: 'EXPORT',
      operationalSiteId: site.id, createdBy: adminUserId,
      shipmentCode: `DEC-${suffix}-${createdShipmentIds.length}`,
    }).returning();
    createdShipmentIds.push(shipment.id);
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id, containerTypeId: ct.id,
      containerNumber: `DEC${String(840000 + shipment.id).slice(-6)}`,
      createdBy: adminUserId,
    }).returning();

    const first = await apiFetch<{ fulfillmentId: number; shipmentVersion: number }>(
      '/dispatch-detail-plan-rows/decompose',
      { method: 'POST', token: dispatcherToken, body: { shipmentId: shipment.id, containerId: container.id, expectedShipmentVersion: shipment.version } },
    );
    assert.equal(first.status, 201, JSON.stringify(first.data));
    assert.ok(Number.isInteger(first.data.fulfillmentId), 'fresh fulfillment id returned');

    const key = `be2-decompose-replay-${suffix}-${shipment.id}`;
    const replayBody = { shipmentId: shipment.id, containerId: container.id, expectedShipmentVersion: first.data.shipmentVersion };
    const replayFirst = await fetch(`${baseUrl}/api/shipments/dispatch-detail-plan-rows/decompose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dispatcherToken}`, 'Idempotency-Key': key },
      body: JSON.stringify(replayBody),
    });
    const replaySecond = await fetch(`${baseUrl}/api/shipments/dispatch-detail-plan-rows/decompose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dispatcherToken}`, 'Idempotency-Key': key },
      body: JSON.stringify(replayBody),
    });
    const firstJson = await replayFirst.json() as { fulfillmentId: number };
    const secondJson = await replaySecond.json() as { fulfillmentId: number };
    assert.equal(replaySecond.status, replayFirst.status);
    assert.equal(secondJson.fulfillmentId, firstJson.fulfillmentId, 'durable replay returns the SAME fulfillment');

    const [cusUser] = await db.insert(s.users).values({
      username: `dec-cus-${suffix}`, passwordHash: 'x', role: 'CUS', status: 'ACTIVE',
    }).returning();
    createdUserIds.push(cusUser.id);
    const cusToken = signToken({ id: cusUser.id, username: cusUser.username, role: 'CUS' });
    const denied = await apiFetch('/dispatch-detail-plan-rows/decompose', {
      method: 'POST', token: cusToken,
      body: { shipmentId: shipment.id, containerId: container.id, expectedShipmentVersion: first.data.shipmentVersion },
    });
    assert.equal(denied.status, 403, 'CUS stays out of the decompose path');

    const stale = await apiFetch('/dispatch-detail-plan-rows/decompose', {
      method: 'POST', token: dispatcherToken,
      body: { shipmentId: shipment.id, containerId: container.id, expectedShipmentVersion: 999999 },
    });
    assert.equal(stale.status, 409, 'stale expectedShipmentVersion rejected');

    const missing = await apiFetch('/dispatch-detail-plan-rows/decompose', {
      method: 'POST', token: dispatcherToken,
      body: { shipmentId: 999999999, containerId: container.id, expectedShipmentVersion: 1 },
    });
    assert.equal(missing.status, 404, 'missing shipment is a clean 404, not a 500');
  });

});

describe('dispatch fleet carrier-link resolution (plate → carrier)', () => {
  test('truck fleet-page link resolves for punctuated and normalized plates; unlinked and locked stay null', async () => {
    const carrier = await createCustomer('Fleet link carrier', true);
    const plate = `15E-${String(100 + createdTruckIds.length)}.26`;
    const [truck] = await db.insert(s.trucks).values({
      licensePlate: plate,
      status: 'ACTIVE',
      carrierId: carrier.id,
    }).returning();
    createdTruckIds.push(truck.id);

    const punctuated = await apiFetch<{ carrierId: number | null; carrierName: string | null }>(
      `/carrier-fleet-vehicles/resolve-carrier?plate=${encodeURIComponent(plate)}`,
      { token: dispatcherToken },
    );
    assert.equal(punctuated.data.carrierId, carrier.id);
    assert.equal(punctuated.data.carrierName, 'Fleet link carrier');

    // The normalized form (no separators) resolves the SAME link.
    const normalized = await apiFetch<{ carrierId: number | null }>(
      `/carrier-fleet-vehicles/resolve-carrier?plate=${encodeURIComponent(plate.replace(/[^A-Za-z0-9]/g, ''))}`,
      { token: dispatcherToken },
    );
    assert.equal(normalized.data.carrierId, carrier.id);

    // Unknown plate → nulls; the dispatcher picks the carrier deliberately.
    const unknown = await apiFetch<{ carrierId: number | null }>(
      '/carrier-fleet-vehicles/resolve-carrier?plate=99B-000.99',
      { token: dispatcherToken },
    );
    assert.equal(unknown.data.carrierId, null);

    // A LOCKED carrier's link reads as unlinked — never auto-fill an entity
    // the dispatch write would 409 on.
    await db.update(s.customers).set({ status: 'LOCKED' }).where(eq(s.customers.id, carrier.id));
    const locked = await apiFetch<{ carrierId: number | null }>(
      `/carrier-fleet-vehicles/resolve-carrier?plate=${encodeURIComponent(plate)}`,
      { token: dispatcherToken },
    );
    assert.equal(locked.data.carrierId, null);
  });

  test('TRUCK fleet search matches normalized plates and carries the carrier link', async () => {
    const carrier = await createCustomer('Fleet search carrier', true);
    const plate = `30D-${String(200 + createdTruckIds.length)}.77`;
    const [truck] = await db.insert(s.trucks).values({
      licensePlate: plate,
      status: 'ACTIVE',
      carrierId: carrier.id,
    }).returning();
    createdTruckIds.push(truck.id);

    const response = await apiFetch<{ items: Array<{ id: number; licensePlate: string; carrierId: number | null; carrierName: string | null }> }>(
      `/dispatch-fleet?resource=TRUCK&q=${encodeURIComponent(plate.replace(/[^A-Za-z0-9]/g, ''))}`,
      { token: dispatcherToken },
    );
    const found = response.data.items.find((item) => item.id === truck.id);
    assert.ok(found, 'normalized q finds the punctuated truck');
    assert.equal(found!.carrierId, carrier.id);
    assert.equal(found!.carrierName, 'Fleet search carrier');
  });
});

describe('driver acceptance on the detail-plan row wire', () => {
  /** Plate + issue the lot's first container so a live trip exists. */
  async function issueFirstContainer(lot: { shipment: { id: number }; fulfillmentIds: number[] }) {
    const { truck, driver } = await createOwnedTruckWithDriver();
    const [first] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, lot.fulfillmentIds[0]!));
    const plated = await apiFetch<{ version: number }>(`/dispatch-detail-plan-rows/${lot.fulfillmentIds[0]}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: first.version, truckId: truck.id },
    });
    assert.equal(plated.status, 200, JSON.stringify(plated.data));
    const issued = await apiFetch<{ trip: { id: number } }>(`/${lot.shipment.id}/dispatch`, {
      method: 'POST',
      token: dispatcherToken,
      body: {
        fulfillmentId: lot.fulfillmentIds[0],
        expectedVersion: plated.data.version,
        plannedStartAt: '2026-08-20T08:00:00+07:00',
        plannedEndAt: '2026-08-20T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: truck.id,
        driverId: driver.id,
      },
    });
    assert.equal(issued.status, 201, JSON.stringify(issued.data));
    createdTripIds.push(issued.data.trip.id);
    return { driver, tripId: issued.data.trip.id };
  }

  test('issued rows surface driverAccepted only once the ORDER_RECEIVED milestone exists', async () => {
    const acceptedLot = await createAllocatedLot({ carrierType: 'OWN', containerCount: 1 });
    const plainLot = await createAllocatedLot({ carrierType: 'OWN', containerCount: 1 });
    const accepted = await issueFirstContainer(acceptedLot);
    await issueFirstContainer(plainLot);

    const [event] = await db.insert(s.driverProgressEvents).values({
      tripId: accepted.tripId,
      driverId: accepted.driver.id,
      eventType: DriverProgressEventType.ORDER_RECEIVED,
      occurredAt: new Date(),
    }).returning();

    try {
      const acceptedRows = await fetchRows(dispatcherToken, `?q=${acceptedLot.shipment.shipmentCode}`);
      const acceptedRow = acceptedRows.data.items.find((item) => item.fulfillmentId === acceptedLot.fulfillmentIds[0])!;
      assert.equal(acceptedRow.taskStatus, 'DISPATCHED');
      assert.equal(acceptedRow.dispatch.driverAccepted, true);

      const plainRows = await fetchRows(dispatcherToken, `?q=${plainLot.shipment.shipmentCode}`);
      const plainRow = plainRows.data.items.find((item) => item.fulfillmentId === plainLot.fulfillmentIds[0])!;
      assert.equal(plainRow.dispatch.driverAccepted, false);
    } finally {
      await db.delete(s.driverProgressEvents).where(eq(s.driverProgressEvents.id, event.id));
    }
  });
});
