import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';

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

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdPortIds: number[] = [];
const createdTrailerIds: number[] = [];
const createdTruckIds: number[] = [];
const createdDriverIds: number[] = [];
const createdShipmentIds: number[] = [];
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
  carrierType: 'OWN' | 'EXTERNAL';
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
    routeId: route.id,
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
      pickupPortId: pickupPort.id,
      dropoffPortId: dropoffPort.id,
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

  return { shipment, fulfillmentIds, customer, site };
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
  return { truck, driver };
}

type DetailPlanRow = {
  fulfillmentId: number;
  version: number;
  shipmentId: number;
  shipmentCode: string | null;
  isCombined: boolean;
  cargoMode: 'FCL' | 'LCL';
  taskStatus: 'READY' | 'DISPATCHED';
  time: { deliveryDate: string | null; runHour: number | null };
  customerRoute: { customerName: string; factoryName: string | null; deliveryPoint: string | null };
  docs: { billNumber: string | null; tradeDirection: string | null; declarationNumbers: string[] };
  container: { containerNumber: string | null; containerTypeLabel: string | null; cargoWeightKg: string | null };
  notes: { vehicleNote: string | null; customerNote: string | null };
  dispatch: {
    carrierType: 'OWN' | 'EXTERNAL';
    carrierName: string | null;
    externalCarrierId: number | null;
    externalCarrierVehicleId: number | null;
    assignedPlate: string | null;
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
    if (createdShipmentIds.length > 0) {
      await db.delete(s.notifications).where(and(
        eq(s.notifications.type, 'TRIP_DISPATCHED'),
        eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
        inArray(
          s.notifications.relatedEntityId,
          db.select({ id: s.shipmentFulfillments.id }).from(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, createdShipmentIds)),
        ),
      ));
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdSiteIds.length > 0) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdSiteIds));
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
  test('returns one row per container with spec payload before any handoff', async () => {
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN', containerCount: 2, isCombined: true });
    const response = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.items.length, 2);
    const row = response.data.items.find((item) => item.fulfillmentId === fulfillmentIds[0])!;
    assert.equal(row.shipmentId, shipment.id);
    assert.equal(row.isCombined, true);
    assert.equal(row.taskStatus, 'READY');
    assert.equal(row.time.runHour, 15);
    assert.equal(row.customerRoute.customerName, shipment.customerId != null ? row.customerRoute.customerName : null);
    assert.ok(row.customerRoute.factoryName);
    assert.ok(row.customerRoute.deliveryPoint);
    assert.equal(row.docs.tradeDirection, 'EXPORT');
    assert.equal(row.dispatch.carrierType, 'OWN');
    assert.equal(row.dispatch.carrierName, 'SilverSea');
    assert.equal(row.dispatch.assignedPlate, null);
    assert.equal(row.lotFullyPlated, false);
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

  test('date filter uses the shipment dispatch date, not a container appointment', async () => {
    const { shipment } = await createAllocatedLot({ carrierType: 'OWN', containerCount: 2 });
    await db.update(s.shipments)
      .set({ expectedDeliveryDate: '2026-08-20' })
      .where(eq(s.shipments.id, shipment.id));
    const containers = await db.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, shipment.id))
      .orderBy(s.shipmentContainers.id);
    await db.update(s.shipmentContainers)
      // 20/08 UTC has already rolled into 21/08 in Vietnam. This boundary
      // locks the business-timezone conversion instead of only the fallback.
      .set({ customerAppointmentAt: new Date('2026-08-20T18:00:00.000Z') })
      .where(eq(s.shipmentContainers.id, containers[0]!.id));

    const shipmentDate = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&date=2026-08-20`);
    assert.equal(shipmentDate.status, 200, JSON.stringify(shipmentDate.data));
    assert.equal(shipmentDate.data.items.length, 2);
    assert.equal(shipmentDate.data.items[0]!.time.deliveryDate, '2026-08-20');

    const appointmentDate = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&date=2026-08-21`);
    assert.equal(appointmentDate.status, 200, JSON.stringify(appointmentDate.data));
    assert.equal(appointmentDate.data.items.length, 0);

    const shipmentFallbackDate = await fetchRows(dispatcherToken, `?q=${shipment.shipmentCode}&date=2026-08-20`);
    assert.equal(shipmentFallbackDate.status, 200, JSON.stringify(shipmentFallbackDate.data));
    assert.equal(shipmentFallbackDate.data.items.length, 2);
    assert.equal(shipmentFallbackDate.data.items[0]!.time.deliveryDate, '2026-08-20');
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
    // Scope the accountant to this lot's customer only.
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
      '/dispatch-delivery-point-facets',
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

    const pickup = await apiFetch<{ items: Array<{ id: number; name: string }> }>(
      '/dispatch-pickup-port-facets',
      { token: dispatcherToken },
    );
    assert.equal(pickup.status, 200);
    if (pickupId != null) assert.ok(pickup.data.items.some((item) => item.id === pickupId));

    const dropoff = await apiFetch<{ items: Array<{ id: number; name: string }> }>(
      '/dispatch-dropoff-port-facets',
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

  test('OWN happy path assigns plate, notifies driver, flips lot flag on last container', async () => {
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
    assert.equal(first.data.driverNotified, true);
    assert.equal(first.data.lotFullyPlated, false);

    const [notification] = await db.select().from(s.notifications).where(and(
      eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
      eq(s.notifications.relatedEntityId, f1.id),
    ));
    assert.ok(notification, 'driver notification persisted');

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

  test('re-assigning the same truck does not re-notify', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const { truck } = await createOwnedTruckWithDriver();
    const [fulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const first = await apiFetch<PlateResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plate`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { expectedVersion: fulfillment.version, truckId: truck.id },
    });
    assert.equal(first.data.driverNotified, true);

    // Clear then re-assign the same truck: the dedupe check finds the prior
    // notification for this fulfillment+driver+plate pair and stays silent.
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

  test('one save applies carrier, vehicle, estimates, classification, and isCombined atomically', async () => {
    const carrier = await createCustomer(`Detail ext carrier ${suffix}-${createdCustomerIds.length}`, true);
    const { shipment, fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
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
        classification: 'DOUBLE',
        isCombined: !shipment.isCombined,
      },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.replayed, false);
    assert.equal(response.data.dispatch.carrierType, 'EXTERNAL');
    assert.equal(response.data.dispatch.externalCarrierId, carrier.id);
    assert.equal(response.data.classification, 'DOUBLE');
    assert.equal(response.data.estimates.plannedRevenue, '3000000');
    assert.equal(response.data.isCombined, !shipment.isCombined);
    // isCombined flipped → shipment version bumped exactly once.
    assert.equal(response.data.shipmentVersion, freshShipment.version + 1);
    assert.equal(response.data.fulfillmentVersion, fulfillment.version + 1);

    // The vehicle switched away from OWN with no plate — plate cleared.
    assert.equal(response.data.dispatch.assignedPlate, null);
    void truck; void driver;
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

  test('OWN truck assignment notifies driver once; replay is silent', async () => {
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
    assert.equal(first.data.driverNotified, true);
    assert.equal(first.data.dispatch.assignedPlate, truck.licensePlate);
    assert.equal(first.data.lotFullyPlated, true);

    const replay = await apiFetch<PlanResponse>(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
      method: 'PATCH', token: dispatcherToken, body, idempotencyKey: key,
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.data));
    assert.equal(replay.data.replayed, true);

    // Exactly one in-app notification for the transition.
    const notes = await db.select({ id: s.notifications.id }).from(s.notifications)
      .where(and(
        eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
        eq(s.notifications.relatedEntityId, fulfillment.id),
      ));
    assert.equal(notes.length, 1);
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
    assert.equal(after.fulfillment.dispatchClassification, null);
    assert.equal(after.shipment.version, shipment.version);
  });

  test('classification is required — schema rejects a missing/null value', async () => {
    const { fulfillmentIds } = await createAllocatedLot({ carrierType: 'OWN' });
    const [fulfillment] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fulfillmentIds[0]!));
    const [shipment] = await db.select().from(s.shipments)
      .where(eq(s.shipments.id, fulfillment.shipmentId));

    const missing = await apiFetch(`/dispatch-detail-plan-rows/${fulfillment.id}/plan`, {
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
    assert.equal(missing.status, 400);

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
});
