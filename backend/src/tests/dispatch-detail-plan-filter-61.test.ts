/**
 * Card 20260927_61 — advanced filters for /dispatch-detail (CHIEF rulings
 * 27/09): five new server-side filters with BOTH-BRANCH PARITY.
 *
 * Rulings baked in:
 * - Xe/Tài xế match the EFFECTIVE assignment (planned plate) only.
 * - Đội xe = OWN vs EXTERNAL (plannedCarrierType).
 * - Trailer type rides the ASSIGNED truck.
 * - Route rides the LOT (FCL container→lot fallback included).
 * - Fulfillment-less branch: route parity, structurally empty under any
 *   assignment-scoped filter.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';

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
const createdAssignmentIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdSiteIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let adminUserId = 0;
let dispatcherToken = '';

type Row = { fulfillmentId: number | null; shipmentContainerId: number | null };

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `flt61-${tag}-${suffix}-${createdUserIds.length}`,
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
    customerIds: [] as number[],
  }, config.jwtSecret);
}

async function fetchRows(query: string) {
  const response = await fetch(`${baseUrl}/api/shipments/dispatch-detail-plan-rows${query}`, {
    headers: { Authorization: `Bearer ${dispatcherToken}` },
  });
  const data = await response.json().catch(() => ({})) as { items?: Row[] };
  return { status: response.status, data };
}

async function mkCarrier(name: string) {
  const [customer] = await db.insert(s.customers).values({
    name,
    isCarrier: true,
    status: 'ACTIVE',
  }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute(label: string) {
  const [route] = await db.insert(s.routes).values({ name: `${label} ${suffix}` }).returning();
  createdRouteIds.push(route.id);
  return route;
}

async function mkSite(customerId: number) {
  const [site] = await db.insert(s.operationalSites).values({
    customerId,
    code: `SITE61-${suffix.slice(-6)}-${createdSiteIds.length}`.slice(0, 80),
    name: `Nhà máy 61 ${suffix}-${createdSiteIds.length}`,
    siteType: 'FACTORY',
    address: `Địa chỉ ${createdSiteIds.length}`,
  }).returning();
  createdSiteIds.push(site.id);
  return site;
}

/** Allocated FCL lot: container(s) + fulfillment(s) with the planned carrier
 *  block. Pass routeId to pin the CONTAINER route; routeId:null leaves the
 *  container unrouted (the lot route then must surface — the fallback). */
async function mkLot(args: {
  label: string;
  customer: number;
  route: number;
  containerRouteId?: number | null;
  carrierType?: 'OWN' | 'EXTERNAL' | null;
  externalCarrierId?: number | null;
  plate?: string | null;
  decomposed?: boolean;
}) {
  const site = await mkSite(args.customer);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customer,
    routeId: args.route,
    cargoMode: 'FCL',
    shipmentCode: `61-${args.label}-${suffix.slice(-8)}-${createdShipmentIds.length}`,
    bookingRef: `61BOOK-${args.label}-${suffix.slice(-8)}`,
    status: 'READY_FOR_DISPATCH',
    closingAt: new Date('2026-08-20T08:00:00.000Z'),
    tradeDirection: 'EXPORT',
    operationalSiteId: site.id,
    createdBy: adminUserId,
  }).returning();
  createdShipmentIds.push(shipment.id);
  const containerType = await createContainerType(`20G${createdContainerTypeIds.length}`);
  const [pickupPort] = await db.insert(s.ports).values({ name: `61 pickup ${suffix}-${createdShipmentIds.length}` }).returning();
  const [dropoffPort] = await db.insert(s.ports).values({ name: `61 dropoff ${suffix}-${createdShipmentIds.length}` }).returning();
  createdPortIds.push(pickupPort.id, dropoffPort.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: containerType.id,
    containerNumber: `MSCU${String(320000 + shipment.id).slice(-6)}`,
    routeId: args.containerRouteId === null ? null : (args.containerRouteId ?? args.route),
    pickupPortId: pickupPort.id,
    dropoffPortId: dropoffPort.id,
    cargoWeightKg: '1000',
    customerAppointmentAt: new Date('2026-08-20T08:00:00.000Z'),
    createdBy: adminUserId,
  }).returning();
  let fulfillmentId: number | null = null;
  if (args.decomposed !== false) {
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: { deliverySite: { id: site.id, name: site.name, address: site.address } },
      plannedCarrierType: args.carrierType ?? null,
      plannedExternalCarrierId: args.carrierType === 'EXTERNAL' ? args.externalCarrierId ?? null : null,
      plannedVehiclePlateNumber: args.plate ?? null,
      createdBy: adminUserId,
    }).returning();
    fulfillmentId = fulfillment.id;
  }
  return { shipment, container, fulfillmentId };
}

async function createContainerType(code: string) {
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `${code}-${suffix.slice(-6)}-${createdContainerTypeIds.length}`.slice(0, 20),
    name: `61 container ${code} ${suffix}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  return containerType;
}

async function mkOwnedTruck(args: { trailerType?: '20FT' | '40FT' } = {}) {
  const plateSuffix = `${suffix.slice(-6)}${String(createdTruckIds.length).padStart(2, '0')}`;
  const trailerType = args.trailerType ?? '20FT';
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${plateSuffix}`.slice(0, 20),
    type: trailerType,
    status: 'ACTIVE',
  }).returning();
  createdTrailerIds.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51C-${plateSuffix}`.slice(0, 20),
    currentTrailerId: trailer.id,
    trailerType,
    status: 'ACTIVE',
  }).returning();
  createdTruckIds.push(truck.id);
  const driverUser = await mkUser(Role.DRIVER, 'drv');
  const [driver] = await db.insert(s.drivers).values({
    userId: driverUser.id,
    name: `Driver 61 ${suffix}-${createdDriverIds.length}`,
    assignedTruckId: truck.id,
    status: 'ACTIVE',
  }).returning();
  createdDriverIds.push(driver.id);
  const [assignment] = await db.insert(s.truckDriverAssignments).values({
    truckId: truck.id,
    driverId: driver.id,
    role: 'PRIMARY',
  }).returning();
  createdAssignmentIds.push(assignment.id);
  return { truck, driver };
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
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
  const admin = await mkUser(Role.ADMIN, 'admin');
  const dispatcher = await mkUser(Role.DISPATCHER, 'dv');
  adminUserId = admin.id;
  dispatcherToken = signToken(dispatcher);
});

after(async () => {
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  try {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, createdShipmentIds));
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    if (createdSiteIds.length > 0) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdSiteIds));
    if (createdAssignmentIds.length > 0) await db.delete(s.truckDriverAssignments).where(inArray(s.truckDriverAssignments.id, createdAssignmentIds));
    if (createdDriverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    if (createdTruckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    if (createdTrailerIds.length > 0) await db.delete(s.trailers).where(inArray(s.trailers.id, createdTrailerIds));
    if (createdContainerTypeIds.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    if (createdPortIds.length > 0) await db.delete(s.ports).where(inArray(s.ports.id, createdPortIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    if (createdUserIds.length > 0) {
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } finally {
    await client.end();
  }
});

describe('20260927_61 — detail-plan advanced filters (both-branch parity)', () => {
  test('truckPlate matches only rows planned on that plate', async () => {
    const carrier = await mkCarrier(`61 carrier A ${suffix}`);
    const route = await mkRoute('61 route A');
    const { truck } = await mkOwnedTruck();
    const mine = await mkLot({ label: 'plate-mine', customer: carrier.id, route: route.id, carrierType: 'OWN', plate: truck.licensePlate });
    await mkLot({ label: 'plate-other', customer: carrier.id, route: route.id, carrierType: 'OWN', plate: '51Z-99.88' });

    const res = await fetchRows(`?q=${mine.shipment.shipmentCode}&truckPlate=${encodeURIComponent(truck.licensePlate)}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const rows = res.data.items ?? [];
    assert.equal(rows.length, 1, `expected exactly the matching row, got ${JSON.stringify(rows.map((r) => [r.fulfillmentId, (r as { dispatch?: { assignedPlate?: string | null } }).dispatch?.assignedPlate]))}`);
    assert.equal((rows[0] as { dispatch?: { assignedPlate?: string | null } }).dispatch?.assignedPlate, truck.licensePlate);
    const foreign = await fetchRows(`?q=${mine.shipment.shipmentCode}&truckPlate=${encodeURIComponent('51Z-99.88')}`);
    assert.equal(foreign.data.items?.length ?? -1, 0, 'foreign plate must not match the lot');
  });

  test('driverId matches rows on trucks actively assigned to that driver', async () => {
    const carrier = await mkCarrier(`61 carrier B ${suffix}`);
    const route = await mkRoute('61 route B');
    const { truck, driver } = await mkOwnedTruck();
    const mine = await mkLot({ label: 'drv-mine', customer: carrier.id, route: route.id, carrierType: 'OWN', plate: truck.licensePlate });
    await mkLot({ label: 'drv-other', customer: carrier.id, route: route.id, carrierType: 'OWN', plate: '51Y-77.66' });

    const res = await fetchRows(`?q=${mine.shipment.shipmentCode}&driverId=${driver.id}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const rows = res.data.items ?? [];
    assert.equal(rows.length, 1, 'driver row present');
  });

  test('carrierClass splits OWN vs EXTERNAL; unassigned rows only under Tất cả', async () => {
    const carrier = await mkCarrier(`61 carrier C ${suffix}`);
    const external = await mkCarrier(`61 external C ${suffix}`);
    const route = await mkRoute('61 route C');
    const own = await mkLot({ label: 'own', customer: carrier.id, route: route.id, carrierType: 'OWN', plate: '51X-11.22' });
    const ext = await mkLot({ label: 'ext', customer: carrier.id, route: route.id, carrierType: 'EXTERNAL', externalCarrierId: external.id, plate: '60E-33.44' });
    const unassigned = await mkLot({ label: 'unassigned', customer: carrier.id, route: route.id, carrierType: null, decomposed: true });

    const ownRes = await fetchRows(`?q=${own.shipment.shipmentCode}&carrierClass=OWN`);
    const extRes = await fetchRows(`?q=${ext.shipment.shipmentCode}&carrierClass=EXTERNAL`);
    const ownUnderExt = await fetchRows(`?q=${own.shipment.shipmentCode}&carrierClass=EXTERNAL`);
    const allRes = await fetchRows(`?q=${unassigned.shipment.shipmentCode}`);
    assert.equal(ownRes.status, 200);
    assert.equal((ownRes.data.items ?? []).length, 1, 'OWN row under OWN');
    assert.equal((extRes.data.items ?? []).length, 1, 'EXTERNAL row under EXTERNAL');
    assert.equal((ownUnderExt.data.items ?? []).length, 0, 'OWN lot excluded under EXTERNAL');
    assert.equal((allRes.data.items ?? []).length, 1, 'unassigned row visible under Tất cả');
  });

  test('trailerType rides the assigned truck', async () => {
    const carrier = await mkCarrier(`61 carrier D ${suffix}`);
    const route = await mkRoute('61 route D');
    const { truck } = await mkOwnedTruck({ trailerType: '40FT' });
    const mine = await mkLot({ label: 'trailer', customer: carrier.id, route: route.id, carrierType: 'OWN', plate: truck.licensePlate });
    await mkLot({ label: 'trailer-other', customer: carrier.id, route: route.id, carrierType: 'OWN', plate: '51W-55.44' });

    const res = await fetchRows(`?q=${mine.shipment.shipmentCode}&trailerType=40FT`);
    assert.equal(res.status, 200);
    const rows = res.data.items ?? [];
    assert.equal(rows.length, 1, '40FT-assigned row present');
    const wrongTrailer = await fetchRows(`?q=${mine.shipment.shipmentCode}&trailerType=20FT`);
    assert.equal((wrongTrailer.data.items ?? []).length, 0, '40FT lot excluded under 20FT');
  });

  test('routeId rides the LOT route with FCL fallback, both branches', async () => {
    const carrier = await mkCarrier(`61 carrier E ${suffix}`);
    const lotRoute = await mkRoute('61 route E');
    const { truck } = await mkOwnedTruck();
    const withContainerRoute = await mkLot({ label: 'route-c', customer: carrier.id, route: lotRoute.id, carrierType: 'OWN', plate: truck.licensePlate });
    const fallbackLot = await mkLot({ label: 'route-fallback', customer: carrier.id, route: lotRoute.id, containerRouteId: null, carrierType: 'OWN', plate: '51V-66.55' });
    const undecomposed = await mkLot({ label: 'route-undecomp', customer: carrier.id, route: lotRoute.id, decomposed: false });

    const res = await fetchRows(`?q=61-route&routeId=${lotRoute.id}`);
    assert.equal(res.status, 200);
    const rows = res.data.items ?? [];
    assert.ok(rows.some((r) => r.fulfillmentId === withContainerRoute.fulfillmentId), 'container-route row');
    assert.ok(rows.some((r) => r.fulfillmentId === fallbackLot.fulfillmentId), 'lot-fallback row');
    assert.ok(rows.some((r) => r.fulfillmentId === null && r.shipmentContainerId === undecomposed.container.id), 'undecomposed branch row with lot route');
    const otherRoute = await fetchRows(`?q=61-route&routeId=999999`);
    assert.equal((otherRoute.data.items ?? []).length, 0, 'foreign routeId must not match');
  });

  test('assignment-scoped filters empty the undecomposed branch', async () => {
    const carrier = await mkCarrier(`61 carrier F ${suffix}`);
    const route = await mkRoute('61 route F');
    const { truck } = await mkOwnedTruck();
    const assigned = await mkLot({ label: 'scoped', customer: carrier.id, route: route.id, carrierType: 'OWN', plate: truck.licensePlate });
    await mkLot({ label: 'scoped-undecomp', customer: carrier.id, route: route.id, decomposed: false });

    const res = await fetchRows(`?truckPlate=${encodeURIComponent(truck.licensePlate)}`);
    assert.equal(res.status, 200);
    const rows = res.data.items ?? [];
    assert.ok(rows.some((r) => r.fulfillmentId === assigned.fulfillmentId), 'assigned row still present');
    assert.ok(rows.every((r) => r.fulfillmentId !== null), 'no undecomposed rows under assignment-scoped filter');
    const undecomposedAlone = await fetchRows(`?q=${'61-scoped-undecomp'}&routeId=999999`);
    assert.equal((undecomposedAlone.data.items ?? []).length, 0, 'sanity: route 999999 matches nothing');
  });

  test('invalid carrierClass is rejected with 400', async () => {
    const res = await fetchRows('?carrierClass=NONE');
    assert.equal(res.status, 400);
  });
});
