/**
 * F6 factory-site snapshot at dispatch (MasterDataNhaMay MDN-13, PM decision
 * D2 2026-09-10): fulfillment-dispatched trips freeze the operational site's
 * name + address at dispatch, mirroring the trips.route_id route snapshot.
 *
 * Contracts:
 *   - dispatch write path persists the snapshot (container site beats
 *     shipment site; shipment free-text factory name is the last resort with
 *     no address).
 *   - reads prefer the frozen columns (SNAPSHOT) and fall back to the live
 *     master-data join (LIVE) only for legacy rows with null columns.
 *   - editing factory master data after dispatch cannot drift the frozen trip.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { issueOrderCreateOrUpdate } from '../services/dispatch-planning-commands.service';
import { getTripFactorySiteView } from '../services/trip-factory-site.service';
import type { AuthUser } from '../middleware/auth';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdSiteIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdTripIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdTrailerIds: number[] = [];
const createdTruckIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
let admin: AuthUser;

async function mkSite(name: string, shortName: string, customerId: number) {
  const [site] = await db.insert(s.operationalSites).values({
    customerId,
    code: `T8${suffix.replace(/\D/g, '').slice(-6)}${createdSiteIds.length}`.slice(0, 80),
    name,
    shortName,
    siteType: 'FACTORY',
    address: `Địa chỉ ${name}`,
  }).returning();
  createdSiteIds.push(site.id);
  return site;
}

async function mkFleet() {
  const plateSuffix = suffix.slice(-6);
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51T-${plateSuffix}${createdTrailerIds.length}`.slice(0, 20),
    type: '40FT',
    status: 'ACTIVE',
  }).returning();
  createdTrailerIds.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51F-${plateSuffix}${createdTruckIds.length}`.slice(0, 20),
    currentTrailerId: trailer.id,
    trailerType: '40FT',
    status: 'ACTIVE',
  }).returning();
  createdTruckIds.push(truck.id);
  const [driverUser] = await db.insert(s.users).values({
    username: `t8-driver-${suffix}-${createdDriverIds.length}`,
    passwordHash: 'test-only',
    role: Role.DRIVER,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(driverUser.id);
  const [driver] = await db.insert(s.drivers).values({
    userId: driverUser.id,
    name: `T8 driver ${suffix}-${createdDriverIds.length}`,
    assignedTruckId: truck.id,
    status: 'ACTIVE',
  }).returning();
  createdDriverIds.push(driver.id);
  await db.insert(s.truckDriverAssignments).values({
    truckId: truck.id,
    driverId: driver.id,
    role: 'PRIMARY',
  });
  return { trailer, truck, driver };
}

async function mkDispatchableShipment(args: {
  customerId: number;
  routeId: number;
  containerSiteId?: number | null;
  shipmentSiteId?: number | null;
  factoryName?: string | null;
}) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customerId,
    routeId: args.routeId,
    cargoMode: 'FCL',
    operationalSiteId: args.shipmentSiteId ?? null,
    factoryName: args.factoryName ?? null,
    shipmentCode: `T8-${suffix}-${createdShipmentIds.length}`,
    bookingRef: `T8BOOK-${suffix}-${createdShipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    closingAt: new Date('2026-08-05T08:00:00.000Z'),
    createdBy: admin.userId,
  }).returning();
  createdShipmentIds.push(shipment.id);

  const [containerType] = await db.insert(s.containerTypes).values({
    code: `4G${suffix.replace(/\D/g, '').slice(-5)}${createdContainerTypeIds.length}`.slice(0, 20),
    name: "40'DC",
  }).returning();
  createdContainerTypeIds.push(containerType.id);

  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    routeId: args.routeId,
    containerTypeId: containerType.id,
    operationalSiteId: args.containerSiteId ?? null,
    createdBy: admin.userId,
  }).returning();

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
    plannedCarrierType: 'OWN',
    createdBy: admin.userId,
  }).returning();
  createdFulfillmentIds.push(fulfillment.id);

  return { shipment, container, fulfillment };
}

async function dispatch(shipment: { id: number }, fulfillment: { id: number; version: number }) {
  const fleet = await mkFleet();
  const outcome = await db.transaction((tx) => issueOrderCreateOrUpdate(tx, {
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    expectedVersion: fulfillment.version,
    plannedStartAt: '2026-08-01T08:00:00+07:00',
    plannedEndAt: '2026-08-01T18:00:00+07:00',
    endTimeConfirmed: true,
    carrierType: 'OWN',
    truckId: fleet.truck.id,
    driverId: fleet.driver.id,
    trailerId: fleet.trailer.id,
    idempotencyKey: `t8-dispatch-${suffix}-${fulfillment.id}`,
    actor: { ...admin, role: Role.ADMIN },
  }));
  createdTripIds.push(outcome.trip.id);
  return outcome;
}

before(async () => {
  const [user] = await db.insert(s.users).values({
    username: `t8-admin-${suffix}`,
    passwordHash: 'test-only',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  admin = {
    userId: user.id,
    username: user.username,
    email: null,
    fullName: null,
    role: Role.ADMIN,
  };
});

after(async () => {
  for (const id of createdTripIds) {
    await db.delete(s.tripContainers).where(eq(s.tripContainers.tripId, id)).catch(() => {});
    await db.delete(s.trips).where(eq(s.trips.id, id)).catch(() => {});
  }
  await db.delete(s.notifications).where(inArray(
    s.notifications.relatedEntityId,
    createdFulfillmentIds.length > 0 ? createdFulfillmentIds : [-1],
  )).catch(() => {});
  await db.delete(s.shipmentFulfillments).where(inArray(
    s.shipmentFulfillments.id,
    createdFulfillmentIds.length > 0 ? createdFulfillmentIds : [-1],
  )).catch(() => {});
  await db.delete(s.shipmentContainers).where(inArray(
    s.shipmentContainers.shipmentId,
    createdShipmentIds.length > 0 ? createdShipmentIds : [-1],
  )).catch(() => {});
  await db.delete(s.shipments).where(inArray(
    s.shipments.id,
    createdShipmentIds.length > 0 ? createdShipmentIds : [-1],
  )).catch(() => {});
  await db.delete(s.truckDriverAssignments).where(inArray(
    s.truckDriverAssignments.truckId,
    createdTruckIds.length > 0 ? createdTruckIds : [-1],
  )).catch(() => {});
  await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds.length > 0 ? createdDriverIds : [-1])).catch(() => {});
  await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds.length > 0 ? createdTruckIds : [-1])).catch(() => {});
  await db.delete(s.trailers).where(inArray(s.trailers.id, createdTrailerIds.length > 0 ? createdTrailerIds : [-1])).catch(() => {});
  await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds.length > 0 ? createdContainerTypeIds : [-1])).catch(() => {});
  await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdSiteIds.length > 0 ? createdSiteIds : [-1])).catch(() => {});
  await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds.length > 0 ? createdRouteIds : [-1])).catch(() => {});
  await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds.length > 0 ? createdCustomerIds : [-1])).catch(() => {});
  await db.delete(s.users).where(inArray(s.users.id, createdUserIds.length > 0 ? createdUserIds : [-1])).catch(() => {});
  await client.end();
  await disconnectRedis();
});

describe('F6 factory-site snapshot at dispatch', () => {
  test('dispatch freezes the container site name + address; master edits cannot drift it', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `T8 customer ${suffix}` }).returning();
    createdCustomerIds.push(customer.id);
    const [route] = await db.insert(s.routes)
      .values({ name: `T8 route ${suffix}` }).returning();
    createdRouteIds.push(route.id);
    const containerSite = await mkSite('Nhà máy cấp container', 'XƯỞNG CT', customer.id);
    const shipmentSite = await mkSite('Nhà máy cấp lô', 'XƯỞNG LÔ', customer.id);

    const fixture = await mkDispatchableShipment({
      customerId: customer.id,
      routeId: route.id,
      containerSiteId: containerSite.id,
      shipmentSiteId: shipmentSite.id,
    });
    const outcome = await dispatch(fixture.shipment, fixture.fulfillment);

    const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, outcome.trip.id));
    assert.ok(trip);
    assert.equal(trip.factorySiteName, 'XƯỞNG CT', 'container site wins over shipment site');
    assert.equal(trip.factorySiteAddress, 'Địa chỉ Nhà máy cấp container');

    const view = await getTripFactorySiteView(trip.id);
    assert.equal(view?.source, 'SNAPSHOT');
    assert.equal(view?.name, 'XƯỞNG CT');

    // Drift guard: renaming the site after dispatch leaves the trip frozen.
    await db.update(s.operationalSites)
      .set({ shortName: 'ĐỔI TÊN RỒI', name: 'Tên mới' })
      .where(eq(s.operationalSites.id, containerSite.id));
    const [frozen] = await db.select().from(s.trips).where(eq(s.trips.id, trip.id));
    assert.equal(frozen.factorySiteName, 'XƯỞNG CT', 'frozen columns must not drift');
    const viewAfter = await getTripFactorySiteView(trip.id);
    assert.equal(viewAfter?.source, 'SNAPSHOT');
    assert.equal(viewAfter?.name, 'XƯỞNG CT');
  });

  test('shipment-level site used when the container has none; free-text factory name is the last resort', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `T8b customer ${suffix}` }).returning();
    createdCustomerIds.push(customer.id);
    const [route] = await db.insert(s.routes)
      .values({ name: `T8b route ${suffix}` }).returning();
    createdRouteIds.push(route.id);
    const shipmentSite = await mkSite('Nhà máy mức lô', 'ASKEY-9', customer.id);

    const viaShipment = await mkDispatchableShipment({
      customerId: customer.id,
      routeId: route.id,
      shipmentSiteId: shipmentSite.id,
    });
    const outcome = await dispatch(viaShipment.shipment, viaShipment.fulfillment);
    const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, outcome.trip.id));
    assert.equal(trip.factorySiteName, 'ASKEY-9');
    assert.equal(trip.factorySiteAddress, 'Địa chỉ Nhà máy mức lô');

    const freeText = await mkDispatchableShipment({
      customerId: customer.id,
      routeId: route.id,
      factoryName: 'Xưởng tự do 88',
    });
    const outcome2 = await dispatch(freeText.shipment, freeText.fulfillment);
    const [trip2] = await db.select().from(s.trips).where(eq(s.trips.id, outcome2.trip.id));
    assert.equal(trip2.factorySiteName, 'Xưởng tự do 88');
    assert.equal(trip2.factorySiteAddress, null, 'free-text has no address to freeze');
  });

  test('legacy trip with null snapshot columns reads LIVE from master data', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `T8c customer ${suffix}` }).returning();
    createdCustomerIds.push(customer.id);
    const [route] = await db.insert(s.routes)
      .values({ name: `T8c route ${suffix}` }).returning();
    createdRouteIds.push(route.id);
    const site = await mkSite('Nhà máy legacy', 'LEGACY-SITE', customer.id);

    const fixture = await mkDispatchableShipment({
      customerId: customer.id,
      routeId: route.id,
      containerSiteId: site.id,
    });
    const outcome = await dispatch(fixture.shipment, fixture.fulfillment);

    // Simulate a legacy row: clear the frozen columns.
    await db.update(s.trips)
      .set({ factorySiteName: null, factorySiteAddress: null })
      .where(eq(s.trips.id, outcome.trip.id));
    await db.update(s.operationalSites)
      .set({ shortName: 'LEGACY-RENAMED' })
      .where(eq(s.operationalSites.id, site.id));

    const view = await getTripFactorySiteView(outcome.trip.id);
    assert.equal(view?.source, 'LIVE', 'null snapshot falls back to the live join');
    assert.equal(view?.name, 'LEGACY-RENAMED', 'live join sees current master data');
  });
});
