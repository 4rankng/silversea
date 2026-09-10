/**
 * Driver journey-board card contract — operationalNotes passthrough and
 * blank-safe factoryShortName resolution.
 *
 * The driver "Hành trình" cards render operation-task chips by splitting
 * shipments.operationalNotes, and headline the factory via factoryShortName
 * (falling back to factoryName). operational_sites.short_name is notNull with
 * a '' default, so the short-name resolution must treat blank as missing.
 *
 * Coverage:
 *   - journey card carries shipments.operationalNotes verbatim (null too).
 *   - site short name wins when filled.
 *   - blank site short name falls back to the site's full name, never ''.
 *   - no container site (join miss) falls back to shipments.factoryName.
 *   - fulfillment detail carries the same factoryShortName + driverNotes.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { getDriverJourneyBoard } from '../services/driver-journey-board.service';
import { getDriverFulfillmentDetail } from '../services/driver.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NOTES = 'LẤY SỐ; GÓI CUỘN';

const createdTripIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdContainerIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdSiteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];

async function setup() {
  const [user] = await db.insert(s.users).values({
    username: `jb-fields-${suffix}-${createdUserIds.length}`, passwordHash: 'x', role: 'DRIVER',
  }).returning();
  createdUserIds.push(user.id);
  const [driver] = await db.insert(s.drivers).values({
    name: `JB driver ${suffix}-${createdDriverIds.length}`, userId: user.id,
  }).returning();
  createdDriverIds.push(driver.id);
  const [customer] = await db.insert(s.customers).values({
    name: `JB customer ${suffix}-${createdCustomerIds.length}`,
  }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({
    name: `JB route ${suffix}-${createdRouteIds.length}`,
  }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `JB cargo ${suffix}-${createdCargoTypeIds.length}`,
  }).returning();
  createdCargoTypeIds.push(cargoType.id);
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `20G${suffix.slice(-5)}${createdContainerTypeIds.length}`.slice(0, 20),
    name: `JB container ${suffix}-${createdContainerTypeIds.length}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  return { user, driver, customer, route, cargoType, containerType };
}

async function mkSite(customerId: number, name: string, shortName?: string) {
  const [site] = await db.insert(s.operationalSites).values({
    customerId,
    code: `JBS-${suffix.slice(-6)}-${createdSiteIds.length}`.slice(0, 80),
    name,
    siteType: 'FACTORY',
    address: `Địa chỉ ${suffix}-${createdSiteIds.length}`,
    ...(shortName === undefined ? {} : { shortName }),
  }).returning();
  createdSiteIds.push(site.id);
  return site;
}

/** FCL shipment whose fulfillment owns a container tied to a factory site. */
async function mkContainerTrip(args: {
  driverId: number; customerId: number; routeId: number; cargoTypeId: number;
  containerTypeId: number; siteId: number; notes: string | null; factoryName: string | null;
}) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customerId,
    routeId: args.routeId,
    cargoTypeId: args.cargoTypeId,
    cargoMode: 'FCL',
    status: 'DISPATCHED',
    operationalNotes: args.notes,
    factoryName: args.factoryName,
  }).returning();
  createdShipmentIds.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: args.containerTypeId,
    containerNumber: `JB${String(400000 + shipment.id).slice(-6)}`,
    operationalSiteId: args.siteId,
  }).returning();
  createdContainerIds.push(container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    dispatchClassification: 'SINGLE',
    sourceShipmentVersion: shipment.version,
    shipmentContainerId: container.id,
    siteSnapshot: {},
  }).returning();
  createdFulfillmentIds.push(fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `JB-${suffix}-${createdTripIds.length}`.slice(0, 50),
    driverId: args.driverId,
    customerId: args.customerId,
    routeId: args.routeId,
    cargoTypeId: args.cargoTypeId,
    status: 'CREATED',
    departureDate: new Date().toISOString().slice(0, 10),
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
  }).returning();
  createdTripIds.push(trip.id);
  return { shipment, container, fulfillment, trip };
}

/** LCL shipment with no container — the factory-site join misses entirely. */
async function mkContainerlessTrip(args: {
  driverId: number; customerId: number; routeId: number; cargoTypeId: number;
  notes: string | null; factoryName: string | null;
}) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customerId,
    routeId: args.routeId,
    cargoTypeId: args.cargoTypeId,
    cargoMode: 'LCL',
    status: 'DISPATCHED',
    operationalNotes: args.notes,
    factoryName: args.factoryName,
  }).returning();
  createdShipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
  }).returning();
  createdFulfillmentIds.push(fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `JB-${suffix}-${createdTripIds.length}`.slice(0, 50),
    driverId: args.driverId,
    customerId: args.customerId,
    routeId: args.routeId,
    cargoTypeId: args.cargoTypeId,
    status: 'CREATED',
    departureDate: new Date().toISOString().slice(0, 10),
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
  }).returning();
  createdTripIds.push(trip.id);
  return { shipment, fulfillment, trip };
}

describe('journey-board card fields — operationalNotes + factoryShortName', () => {
  test('cards carry operationalNotes verbatim and resolve blank-safe factory labels', async () => {
    const { driver, customer, route, cargoType, containerType } = await setup();

    // A: blank short_name (column default) + no shipment factoryName.
    const blankShortSite = await mkSite(customer.id, 'Nhà máy Đầy Đủ');
    const { fulfillment: fulfillmentA } = await mkContainerTrip({
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      containerTypeId: containerType.id, siteId: blankShortSite.id, notes: NOTES, factoryName: null,
    });

    // B: filled short_name wins over every other factory source.
    const shortSite = await mkSite(customer.id, 'Nhà máy Có Tên Ngắn', 'NM NGẮN');
    await mkContainerTrip({
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      containerTypeId: containerType.id, siteId: shortSite.id, notes: null, factoryName: 'Bị che bởi tên ngắn',
    });

    // C: no container site at all — falls back to the shipment text column.
    await mkContainerlessTrip({
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      notes: null, factoryName: 'Xưởng ABC',
    });

    const cards = await getDriverJourneyBoard(driver.id);
    assert.equal(cards.length, 3, JSON.stringify(cards.map((c) => c.tripCode)));

    const cardA = cards.find((c) => c.fulfillmentId === fulfillmentA.id)!;
    assert.equal(cardA.operationalNotes, NOTES);
    // Blank short_name must not surface as '' — falls back to the site's full name.
    assert.equal(cardA.factoryShortName, 'Nhà máy Đầy Đủ');
    assert.equal(cardA.factoryName, 'Nhà máy Đầy Đủ');

    const cardB = cards.find((c) => c.factoryShortName === 'NM NGẮN')!;
    assert.ok(cardB, 'short name must win when filled');
    assert.equal(cardB.operationalNotes, null);

    const cardC = cards.find((c) => c.factoryName === 'Xưởng ABC')!;
    assert.ok(cardC, 'join-miss falls back to shipments.factoryName');
    assert.equal(cardC.factoryShortName, 'Xưởng ABC');

    // Fulfillment detail must agree with the card contract.
    const detail = await getDriverFulfillmentDetail(driver.id, fulfillmentA.id);
    assert.equal(detail.factoryShortName, 'Nhà máy Đầy Đủ');
    assert.equal(detail.driverNotes, NOTES);
  });
});

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdFulfillmentIds.length > 0) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
    if (createdContainerIds.length > 0) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, createdContainerIds));
    if (createdShipmentIds.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    if (createdContainerTypeIds.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    if (createdSiteIds.length > 0) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdSiteIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdDriverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } catch (err) {
    console.warn('[driver-journey-board-fields.test] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
