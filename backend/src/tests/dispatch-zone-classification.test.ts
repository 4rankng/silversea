// Card 20260919_6 part 1 — zone classification characterization suite.
//
// Pins the CURRENT zone-classification behavior (the mechanism is about to
// change under the port-identity purge, the behavior must not): detail-plan
// zone filter, per-zone port facet, zone truck presence, and the zone-code
// requirement. All fixtures use neutral generated zone codes — place names
// belong in data, never in identifiers (and never even in test fixtures here,
// so the suite stays a pure mechanism pin).
//
// After the purge lands, this suite must pass unchanged.
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
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';
import shipmentRoutes from '../routes/shipments';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const ZONE_A = `ZA${suffix.slice(-10)}`;
const ZONE_B = `ZB${suffix.slice(-10)}`;
const VIEW_DATE = '2026-10-01';
const D_MINUS_1 = '2026-09-30';
const D_PLUS_1 = '2026-10-02';

const zoneIds: number[] = [];
const portIds: number[] = [];
const containerTypeIds: number[] = [];
const siteIds: number[] = [];
const routeIds: number[] = [];
const customerIds: number[] = [];
const shipmentIds: number[] = [];
const containerIds: number[] = [];
const fulfillmentIds: number[] = [];
const truckIds: number[] = [];
const trailerIds: number[] = [];
const driverIds: number[] = [];
const assignmentIds: number[] = [];
const userIds: number[] = [];
let dispatcherId = 0;
let dispatcherToken = '';
let server: http.Server;
let baseUrl = '';

type ApiResult = { status: number; data: Record<string, unknown> };

async function apiFetch(path: string, options: { token?: string } = {}): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}/api/shipments${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token ?? dispatcherToken}` },
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `zonechar-${role.toLowerCase()}-${suffix.slice(-6)}-${userIds.length}`,
    passwordHash: await bcrypt.hash('test-only', 10),
    role,
    status: 'ACTIVE',
  }).returning();
  userIds.push(user.id);
  return user;
}

function signToken(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign({
    userId: user.id, username: user.username ?? `user-${user.id}`, email: null, fullName: null,
    role: user.role as Role, customerId: null, customerIds: [],
  }, config.jwtSecret);
}

async function mkZone(code: string, opts?: { label?: string; sortOrder?: number; isActive?: boolean }) {
  const [zone] = await db.insert(s.dispatchZones).values({
    code,
    label: opts?.label ?? `Khu ${code}`,
    sortOrder: opts?.sortOrder ?? 0,
    isActive: opts?.isActive ?? true,
  }).returning();
  zoneIds.push(zone.id);
  return zone;
}

async function mkPort(name: string, dispatchZone: string | null = null) {
  const [port] = await db.insert(s.ports).values({ name, dispatchZone }).returning();
  portIds.push(port.id);
  return port;
}

interface LotArgs {
  tag: string;
  pickupZone?: string | null;
  dropoffZone?: string | null;
  expectedDeliveryDate?: string;
  plannedPlate?: string | null;
}

/** Minimal allocated lot: customer + shipment + container + OWN fulfillment. */
async function createLot(args: LotArgs) {
  const [customer] = await db.insert(s.customers).values({ name: `ZoneChar customer ${suffix} ${args.tag}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `ZoneChar route ${suffix} ${args.tag}` }).returning();
  routeIds.push(route.id);
  const [site] = await db.insert(s.operationalSites).values({
    customerId: customer.id,
    code: `ZC-${suffix.slice(-6)}-${siteIds.length}`.slice(0, 80),
    name: `Nhà máy ZoneChar ${args.tag}`,
    siteType: 'FACTORY',
    address: `Địa chỉ ${suffix} ${args.tag}`,
  }).returning();
  siteIds.push(site.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    isCombined: false,
    shipmentCode: `ZCL-${suffix}-${shipmentIds.length}`,
    bookingRef: `BOOK-ZCL-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    closingAt: new Date('2026-10-01T08:00:00.000Z'),
    ...(args.expectedDeliveryDate != null ? { expectedDeliveryDate: args.expectedDeliveryDate } : {}),
    operationalSiteId: site.id,
    createdBy: dispatcherId,
  }).returning();
  shipmentIds.push(shipment.id);
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `ZC${suffix.slice(-6)}${containerTypeIds.length}`.slice(0, 20),
    name: `ZoneChar container ${suffix} ${containerTypeIds.length}`,
  }).returning();
  containerTypeIds.push(containerType.id);
  const pickupPort = await mkPort(`ZoneChar pickup ${suffix} ${args.tag}`, args.pickupZone ?? null);
  const dropoffPort = await mkPort(`ZoneChar dropoff ${suffix} ${args.tag}`, args.dropoffZone ?? null);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: containerType.id,
    containerNumber: `ZCSU${String(700000 + shipment.id).slice(-6)}${containerIds.length % 10}`,
    routeId: route.id,
    pickupPortId: pickupPort.id,
    dropoffPortId: dropoffPort.id, 
    customerAppointmentAt: new Date('2026-10-01T08:00:00.000Z'),
    createdBy: dispatcherId,
  }).returning();
  containerIds.push(container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
    plannedCarrierType: 'OWN',
    ...(args.plannedPlate != null ? { plannedVehiclePlateNumber: args.plannedPlate } : {}),
    createdBy: dispatcherId,
  }).returning();
  fulfillmentIds.push(fulfillment.id);
  return { shipment, container, fulfillment, pickupPort, dropoffPort };
}

async function mkTruck(tag: string) {
  const plateTail = `${suffix.slice(-6)}${String(truckIds.length).padStart(2, '0')}`;
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${plateTail}`.slice(0, 20),
    type: '20FT',
    status: 'ACTIVE',
  }).returning();
  trailerIds.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51C-${plateTail}`.slice(0, 20),
    currentTrailerId: trailer.id,
    trailerType: '20FT',
    status: 'ACTIVE',
  }).returning();
  truckIds.push(truck.id);
  const driverUser = await mkUser(Role.DRIVER);
  const [driver] = await db.insert(s.drivers).values({
    userId: driverUser.id,
    name: `ZoneChar driver ${suffix} ${tag}`,
    assignedTruckId: truck.id,
    status: 'ACTIVE',
  }).returning();
  driverIds.push(driver.id);
  const [assignment] = await db.insert(s.truckDriverAssignments).values({
    truckId: truck.id,
    driverId: driver.id,
    role: 'PRIMARY',
  }).returning();
  assignmentIds.push(assignment.id);
  return truck;
}

before(async () => {
  await initEnforcer();
  const dispatcher = await mkUser(Role.DISPATCHER);
  dispatcherId = dispatcher.id;
  dispatcherToken = signToken(dispatcher);
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
    await db.delete(s.truckDriverAssignments).where(inArray(s.truckDriverAssignments.truckId, truckIds));
    await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
    await db.delete(s.trucks).where(inArray(s.trucks.id, truckIds));
    await db.delete(s.trailers).where(inArray(s.trailers.id, trailerIds));
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, containerIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.ports).where(inArray(s.ports.id, portIds));
    await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, containerTypeIds));
    await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, siteIds));
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    await db.delete(s.dispatchZones).where(inArray(s.dispatchZones.id, zoneIds));
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});


describe('dispatch zone classification characterization (card _6 part 1)', () => {
  test('detail-plan zone filter: pickup-only zoned lot shows in its zone, not the other', async () => {
    await mkZone(ZONE_A);
    await mkZone(ZONE_B);
    const lot = await createLot({ tag: 't1a', pickupZone: ZONE_A });
    const inA = await apiFetch(`/dispatch-detail-plan-rows?zone=${ZONE_A}&q=${suffix}`);
    const inB = await apiFetch(`/dispatch-detail-plan-rows?zone=${ZONE_B}&q=${suffix}`);
    assert.equal(inA.status, 200);
    assert.equal(inB.status, 200);
    const idsA = (inA.data.items as Array<{ fulfillmentId: number }>).map((row) => row.fulfillmentId);
    const idsB = (inB.data.items as Array<{ fulfillmentId: number }>).map((row) => row.fulfillmentId);
    assert.ok(idsA.includes(lot.fulfillment.id), 'pickup-only lot must appear under its pickup zone');
    assert.ok(!idsB.includes(lot.fulfillment.id), 'pickup-only lot must NOT appear under another zone');
  });

  test('detail-plan zone filter: dropoff-only zoned lot shows under the dropoff zone', async () => {
    const lot = await createLot({ tag: 't1b', dropoffZone: ZONE_A });
    const inA = await apiFetch(`/dispatch-detail-plan-rows?zone=${ZONE_A}&q=${suffix}`);
    const idsA = (inA.data.items as Array<{ fulfillmentId: number }>).map((row) => row.fulfillmentId);
    assert.ok(idsA.includes(lot.fulfillment.id), 'dropoff-only lot appears under the dropoff zone');
  });

  test('detail-plan zone filter: pickup and dropoff in different zones shows in BOTH filters', async () => {
    const lot = await createLot({ tag: 't1c', pickupZone: ZONE_A, dropoffZone: ZONE_B });
    const inA = await apiFetch(`/dispatch-detail-plan-rows?zone=${ZONE_A}&q=${suffix}`);
    const inB = await apiFetch(`/dispatch-detail-plan-rows?zone=${ZONE_B}&q=${suffix}`);
    const idsA = (inA.data.items as Array<{ fulfillmentId: number }>).map((row) => row.fulfillmentId);
    const idsB = (inB.data.items as Array<{ fulfillmentId: number }>).map((row) => row.fulfillmentId);
    assert.ok(idsA.includes(lot.fulfillment.id), 'cross-zone lot appears under its pickup zone');
    assert.ok(idsB.includes(lot.fulfillment.id), 'cross-zone lot appears under its dropoff zone');
  });

  test('detail-plan zone filter: soft-deleted zoned port stops matching the zone', async () => {
    const lot = await createLot({ tag: 't1d', pickupZone: ZONE_A });
    await db.update(s.ports).set({ deletedAt: new Date() }).where(eq(s.ports.id, lot.pickupPort.id));
    const inA = await apiFetch(`/dispatch-detail-plan-rows?zone=${ZONE_A}&q=${suffix}`);
    const idsA = (inA.data.items as Array<{ fulfillmentId: number }>).map((row) => row.fulfillmentId);
    assert.ok(!idsA.includes(lot.fulfillment.id), 'soft-deleted port stops zone matching');
  });

  test('detail-plan zone filter: unknown zone code is a 400', async () => {
    const res = await apiFetch('/dispatch-detail-plan-rows?zone=NO_SUCH_ZONE_XY&q=x');
    assert.equal(res.status, 400);
  });

  test('detail-plan zone filter: inactive zone code is a 400', async () => {
    await mkZone(`ZI${suffix.slice(-10)}`, { isActive: false });
    const res = await apiFetch(`/dispatch-detail-plan-rows?zone=ZI${suffix.slice(-10)}&q=x`);
    assert.equal(res.status, 400);
  });

  test('zone port facet lists ports of the persisted zone, disjoint per zone', async () => {
    await createLot({ tag: 't2a', pickupZone: ZONE_A, dropoffZone: ZONE_B });
    const facetA = await apiFetch(`/dispatch-zone-port-facets?zone=${ZONE_A}`);
    const facetB = await apiFetch(`/dispatch-zone-port-facets?zone=${ZONE_B}`);
    assert.equal(facetA.status, 200);
    assert.equal(facetB.status, 200);
    const idsA = (facetA.data.items as Array<{ id: number }>).map((p) => p.id);
    const idsB = (facetB.data.items as Array<{ id: number }>).map((p) => p.id);
    assert.ok(idsA.length > 0, 'zone A facet lists its ports');
    const overlap = idsA.filter((id) => idsB.includes(id));
    assert.deepEqual(overlap, [], 'zone facets are disjoint');
  });

  test('zone port facet excludes soft-deleted ports', async () => {
    const lot = await createLot({ tag: 't2b', pickupZone: ZONE_A });
    await db.update(s.ports).set({ deletedAt: new Date() }).where(eq(s.ports.id, lot.pickupPort.id));
    const facet = await apiFetch(`/dispatch-zone-port-facets?zone=${ZONE_A}`);
    const ids = (facet.data.items as Array<{ id: number }>).map((p) => p.id);
    assert.ok(!ids.includes(lot.pickupPort.id), 'deleted port excluded from the facet');
  });

  test('zone truck presence: D-1 dropoff evidence under its zone', async () => {
    const truck = await mkTruck('d1');
    await createLot({ tag: 't3a', dropoffZone: ZONE_A, expectedDeliveryDate: D_MINUS_1, plannedPlate: truck.licensePlate });
    const presence = await apiFetch(`/dispatch-zone-truck-presence?zone=${ZONE_A}&date=${VIEW_DATE}`);
    assert.equal(presence.status, 200);
    const items = presence.data.items as Array<{ truckId: number; evidence: Array<{ reason: string; date: string }> }>;
    const entry = items.find((item) => item.truckId === truck.id);
    assert.ok(entry, 'the D-1 drop truck must appear in its zone presence');
    assert.ok(entry.evidence.some((ev) => ev.reason === 'D-1_DROP' && String(ev.date).slice(0, 10) === D_MINUS_1));
  });

  test('zone truck presence: D+1 pickup evidence under its zone', async () => {
    const truck = await mkTruck('dp');
    await createLot({ tag: 't3b', pickupZone: ZONE_A, expectedDeliveryDate: D_PLUS_1, plannedPlate: truck.licensePlate });
    const presence = await apiFetch(`/dispatch-zone-truck-presence?zone=${ZONE_A}&date=${VIEW_DATE}`);
    const items = presence.data.items as Array<{ truckId: number; evidence: Array<{ reason: string; date: string }> }>;
    const entry = items.find((item) => item.truckId === truck.id);
    assert.ok(entry, 'the D+1 pickup truck must appear in its zone presence');
    assert.ok(entry.evidence.some((ev) => ev.reason === 'D+1_PICKUP' && String(ev.date).slice(0, 10) === D_PLUS_1));
  });

  test('zone truck presence: unzoned lot never appears in any zone presence', async () => {
    const truck = await mkTruck('unz');
    await createLot({ tag: 't3c', expectedDeliveryDate: D_MINUS_1, plannedPlate: truck.licensePlate });
    const presenceA = await apiFetch(`/dispatch-zone-truck-presence?zone=${ZONE_A}&date=${VIEW_DATE}`);
    const presenceB = await apiFetch(`/dispatch-zone-truck-presence?zone=${ZONE_B}&date=${VIEW_DATE}`);
    const idsA = (presenceA.data.items as Array<{ truckId: number }>).map((item) => item.truckId);
    const idsB = (presenceB.data.items as Array<{ truckId: number }>).map((item) => item.truckId);
    assert.ok(!idsA.includes(truck.id) && !idsB.includes(truck.id), 'unzoned work must not surface as zone presence');
  });

  test('zone truck presence: cross-zone disjointness', async () => {
    const truck = await mkTruck('xz');
    await createLot({ tag: 't3d', dropoffZone: ZONE_B, expectedDeliveryDate: D_MINUS_1, plannedPlate: truck.licensePlate });
    const presenceA = await apiFetch(`/dispatch-zone-truck-presence?zone=${ZONE_A}&date=${VIEW_DATE}`);
    const presenceB = await apiFetch(`/dispatch-zone-truck-presence?zone=${ZONE_B}&date=${VIEW_DATE}`);
    const idsA = (presenceA.data.items as Array<{ truckId: number }>).map((item) => item.truckId);
    const idsB = (presenceB.data.items as Array<{ truckId: number }>).map((item) => item.truckId);
    assert.ok(!idsA.includes(truck.id), 'zone B evidence must not leak into zone A presence');
    assert.ok(idsB.includes(truck.id), 'zone B evidence stays under zone B');
  });

  test('zone truck presence: plate matching is case/hyphen insensitive', async () => {
    const truck = await mkTruck('plate');
    await createLot({ tag: 't3e', dropoffZone: ZONE_A, expectedDeliveryDate: D_MINUS_1, plannedPlate: truck.licensePlate.toLowerCase().replace('-', '') });
    const presence = await apiFetch(`/dispatch-zone-truck-presence?zone=${ZONE_A}&date=${VIEW_DATE}`);
    const items = presence.data.items as Array<{ truckId: number }>;
    assert.ok(items.some((item) => item.truckId === truck.id), 'normalized plate match ignores case and separators');
  });
});
