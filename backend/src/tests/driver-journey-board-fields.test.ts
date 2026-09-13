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
 *   - card loadingType = the trip's LAST leg (ĐÓNG/TRẢ); null when leg-less.
 *   - fulfillment detail carries the same factoryShortName + driverNotes.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { getDriverJourneyBoard } from '../services/driver-journey-board.service';
import { getDriverFulfillmentDetail } from '../services/driver.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NOTES = 'LẤY SỐ; GÓI CUỘN';

const createdTripIds: number[] = [];
const createdLegIds: number[] = [];
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

/** One trip leg (ĐÓNG/TRẢ loadingType per leg). */
async function mkLeg(tripId: number, sequence: number, loadingType: 'HANG' | 'VO') {
  const [leg] = await db.insert(s.tripLegs).values({
    tripId,
    sequence,
    origin: `Điểm đi ${sequence}-${suffix}`,
    destination: `Điểm đến ${sequence}-${suffix}`,
    km: 10 * sequence,
    loadingType,
  }).returning();
  createdLegIds.push(leg.id);
}

/** FCL shipment with optional trade direction + fulfillment-owned container
 *  tied to a factory site. */
async function mkContainerTrip(args: {
  driverId: number; customerId: number; routeId: number; cargoTypeId: number;
  containerTypeId: number; siteId: number; notes: string | null; factoryName: string | null;
  tripStatus?: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED';
  tradeDirection?: 'IMPORT' | 'EXPORT';
}) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customerId,
    routeId: args.routeId,
    cargoTypeId: args.cargoTypeId,
    cargoMode: 'FCL',
    status: 'DISPATCHED',
    operationalNotes: args.notes,
    factoryName: args.factoryName,
    tradeDirection: args.tradeDirection,
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
    status: args.tripStatus ?? 'CREATED',
    departureDate: new Date().toISOString().slice(0, 10),
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
  }).returning();
  createdTripIds.push(trip.id);
  return { shipment, container, fulfillment, trip };
}

/** LCL shipment (optional trade direction) with no container — the
 *  factory-site join misses entirely. */
async function mkContainerlessTrip(args: {
  driverId: number; customerId: number; routeId: number; cargoTypeId: number;
  notes: string | null; factoryName: string | null;
  tradeDirection?: 'IMPORT' | 'EXPORT';
}) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customerId,
    routeId: args.routeId,
    cargoTypeId: args.cargoTypeId,
    cargoMode: 'LCL',
    status: 'DISPATCHED',
    operationalNotes: args.notes,
    factoryName: args.factoryName,
    tradeDirection: args.tradeDirection,
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

    // A: blank short_name (column default) + no shipment factoryName. One
    // HANG leg → the card's loadingType is that leg's. EXPORT shipment → the
    // card's tradeDirection passes through for the FE ĐÓNG pill.
    const blankShortSite = await mkSite(customer.id, 'Nhà máy Đầy Đủ');
    const { fulfillment: fulfillmentA, trip: tripA } = await mkContainerTrip({
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      containerTypeId: containerType.id, siteId: blankShortSite.id, notes: NOTES, factoryName: null,
      tradeDirection: 'EXPORT',
    });
    await mkLeg(tripA.id, 1, 'HANG');

    // B: filled short_name wins over every other factory source. Two legs —
    // the LAST one (VO) must win the card's loadingType (destination
    // semantics, same rule the billing draft applies).
    const shortSite = await mkSite(customer.id, 'Nhà máy Có Tên Ngắn', 'NM NGẮN');
    const { fulfillment: fulfillmentB, trip: tripB } = await mkContainerTrip({
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      containerTypeId: containerType.id, siteId: shortSite.id, notes: null, factoryName: 'Bị che bởi tên ngắn',
    });
    await mkLeg(tripB.id, 1, 'HANG');
    await mkLeg(tripB.id, 2, 'VO');

    // C: no container site at all — falls back to the shipment text column.
    // No legs either → the card's loadingType stays null (graceful hide path).
    // IMPORT shipment → the card's tradeDirection passes through for the FE
    // TRẢ pill.
    await mkContainerlessTrip({
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      notes: null, factoryName: 'Xưởng ABC',
      tradeDirection: 'IMPORT',
    });

    const board = await getDriverJourneyBoard(driver.id);
    const cards = board.items;
    assert.equal(cards.length, 3, JSON.stringify(cards.map((c) => c.tripCode)));

    // The board embeds the operation-tag pool (ticket 53a536f9): the driver
    // page resolves note chips from this response alone, no tag-pool fetch.
    assert.ok(board.knownTagLabels.length > 0, 'tag pool must ride on the board response');
    assert.ok(board.knownTagLabels.every((label) => typeof label === 'string'));
    for (const seed of ['ĐẶT ĐẦU', 'ĐẶT ĐUÔI', 'ĐẢO VỎ']) {
      assert.ok(board.knownTagLabels.includes(seed), `canonical seed ${seed} must be in knownTagLabels`);
    }

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

    // 3a0bd5af: the card's ĐÓNG/TRẢ loadingType comes from the trip's LAST
    // leg (destination semantics); leg-less trips stay null so the FE badge
    // hides gracefully.
    assert.equal(cardA.loadingType, 'HANG', 'single-leg trip → that leg wins');
    assert.equal(cardB.loadingType, 'VO', 'multi-leg trip → last leg wins');
    assert.equal(cardC.loadingType, null, 'leg-less trip → null, FE badge hides');

    // The card wire carries shipments.trade_direction pass-through — the FE
    // pill's source axis (EXPORT → ĐÓNG, IMPORT → TRẢ), a DIFFERENT axis from
    // the leg handling-type loadingType above.
    assert.equal(cardA.tradeDirection, 'EXPORT', 'FCL EXPORT passes through');
    assert.equal(cardB.tradeDirection, null, 'shipment without direction → null');
    assert.equal(cardC.tradeDirection, 'IMPORT', 'LCL IMPORT passes through');

    // Fulfillment detail must agree with the card contract.
    const detail = await getDriverFulfillmentDetail(driver.id, fulfillmentA.id);
    assert.equal(detail.factoryShortName, 'Nhà máy Đầy Đủ');
    // The full-name row reads the canonical site name (container factory
    // join) — the free-text shipment factoryName only rides as a fallback.
    assert.equal(detail.factoryFullName, 'Nhà máy Đầy Đủ');
    assert.equal(detail.driverNotes, NOTES);
    // Chain order lock: B's shipment free text ("Bị che bởi tên ngắn") is a
    // distinct stale value — the canonical site name must still win the
    // full-name chain, exactly as the card's short-name resolution does.
    const detailB = await getDriverFulfillmentDetail(driver.id, fulfillmentB.id);
    assert.equal(detailB.factoryFullName, 'Nhà máy Có Tên Ngắn', 'canonical site name beats stale free text');
    assert.equal(detailB.factoryShortName, 'NM NGẮN');
    // Trip-detail polish (2026-09-11): the detail wire carries the same
    // contract fields the FE surface renders.
    assert.equal(detail.factoryAddress, `Địa chỉ ${suffix}-0`, 'site street address rides the detail wire');
    assert.equal(detail.khoPhone, null, 'site without contact_phone → kho phone hidden path');
    assert.equal(detail.invoiceMaster, null, 'customer without master data → no master block');
    assert.ok(detail.knownTagLabels.length > 0, 'tag pool must ride on the detail response');
    assert.ok(detail.knownTagLabels.every((label) => typeof label === 'string'));
  });
});

describe('journey-board bucketing — acceptance, not departure, marks Đã nhận (Docx4 BUG2)', () => {
  test('ops-departed unacknowledged trip buckets NEW; acknowledged IN_TRANSIT buckets RUNNING', async () => {
    const { driver, customer, route, cargoType, containerType } = await setup();
    const site = await mkSite(customer.id, 'Nhà máy Bucket');

    // A: ops "Phát lệnh" flipped the trip to IN_TRANSIT and the driver never
    // acknowledged — the card must stay in Lệnh mới so the accept bar stays
    // reachable (the reported bug had it under Đã nhận with no way in).
    const { trip: tripA } = await mkContainerTrip({
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      containerTypeId: containerType.id, siteId: site.id, notes: null, factoryName: null,
      tripStatus: 'IN_TRANSIT',
    });

    // B: same ops departure, but the driver HAS acknowledged — Đã nhận.
    const { trip: tripB } = await mkContainerTrip({
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      containerTypeId: containerType.id, siteId: site.id, notes: null, factoryName: null,
      tripStatus: 'IN_TRANSIT',
    });
    await db.insert(s.driverProgressEvents).values({
      tripId: tripB.id,
      driverId: driver.id,
      eventType: 'ORDER_RECEIVED',
      occurredAt: new Date(),
    });

    // C: CREATED (issued, nothing departed) — NEW as before.
    const { trip: tripC } = await mkContainerTrip({
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      containerTypeId: containerType.id, siteId: site.id, notes: null, factoryName: null,
    });

    const board = await getDriverJourneyBoard(driver.id);
    const bucketByTrip = new Map(board.items.map((card) => [card.tripId, card.bucket]));
    assert.equal(bucketByTrip.get(tripA.id), 'NEW', 'ops-departed unacknowledged → Lệnh mới');
    assert.equal(bucketByTrip.get(tripB.id), 'RUNNING', 'acknowledged IN_TRANSIT → Đã nhận');
    assert.equal(bucketByTrip.get(tripC.id), 'NEW', 'CREATED → Lệnh mới (unchanged)');

    await db.delete(s.driverProgressEvents).where(eq(s.driverProgressEvents.tripId, tripB.id));
  });
});

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
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
