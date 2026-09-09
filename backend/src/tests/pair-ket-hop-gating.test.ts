// Ghép kết hợp sequencing gate + journey-board pair fields (TC-GHEP-010/-011).
// Lệnh 2 of an ACTIVE KET_HOP pair cannot start until Lệnh 1 is finished
// (COMPLETED or evidence-ready); KEP pairs never gate. The board must expose
// pairId/pairKind/pairLocked so the app can render the lock.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { DriverProgressEventType, Role, TripStatus } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { createTripPair } from '../services/trip-pairs.service';
import { getDriverJourneyBoard } from '../services/driver-journey-board.service';
import { recordDriverFulfillmentProgress } from '../services/driver-fulfillment.service';
import { disconnectRedis } from '../lib/redis';
import { getShipmentDetail } from '../services/shipment-detail-reads.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdTripIds: number[] = [];
const createdPairIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdShipmentContainerIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdTruckIds: number[] = [];
const createdIdempotencyKeys: string[] = [];
let requestCounter = 0;

async function mkUser(username: string, role: Role) {
  const [user] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

before(async () => {
  const admin = await mkUser(`gate-admin-${suffix}`, Role.ADMIN);
  const driverUser = await mkUser(`gate-driver-${suffix}`, Role.DRIVER);

  const [customer] = await db.insert(s.customers).values({ name: `Gate customer ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Gate route ${suffix}`, distanceKm: 120 }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `Gate cargo ${suffix}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `20G${suffix.slice(-6)}`, name: "20'GP gate",
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  const [truck] = await db.insert(s.trucks).values({ licensePlate: `51G-${Math.floor(Math.random() * 9000 + 1000)}` }).returning();
  createdTruckIds.push(truck.id);
  const [driver] = await db.insert(s.drivers).values({
    name: `Gate driver ${suffix}`,
    userId: driverUser.id,
    assignedTruckId: truck.id,
  }).returning();
  createdDriverIds.push(driver.id);

  fixture = { adminId: admin.id, driverId: driver.id };
});

interface GateFixture { adminId: number; driverId: number }
let fixture: GateFixture;

after(async () => {
  if (createdIdempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, createdIdempotencyKeys));
  }
  if (createdTripIds.length > 0) {
    await db.update(s.trips).set({ activeTripPairId: null, activeTripPairOrder: null })
      .where(inArray(s.trips.id, createdTripIds));
  }
  if (createdPairIds.length > 0) {
    await db.delete(s.tripPairs).where(inArray(s.tripPairs.id, createdPairIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.driverProgressEvents).where(inArray(s.driverProgressEvents.tripId, createdTripIds));
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdFulfillmentIds.length > 0) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
  }
  if (createdShipmentContainerIds.length > 0) {
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, createdShipmentContainerIds));
  }
  if (createdShipmentIds.length > 0) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
  }
  if (createdDriverIds.length > 0) {
    await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
  }
  if (createdTruckIds.length > 0) {
    await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
  }
  if (createdContainerTypeIds.length > 0) {
    await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
  }
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await disconnectRedis();
  await client.end();
});

async function mkPairedLô(tag: string, args: {
  pairKind: 'KEP' | 'KET_HOP';
  first: { start: string; end: string };
  second: { start: string; end: string };
}) {
  const { adminId, driverId } = fixture;
  // Each pair gets its own truck: the status machine enforces one active
  // trip per truck, so a still-running trip from the previous test would
  // otherwise block this pair's ORDER_RECEIVED.
  const [truck] = await db.insert(s.trucks).values({ licensePlate: `51H-${Math.floor(Math.random() * 9000 + 1000)}-${tag}`.slice(0, 20) }).returning();
  createdTruckIds.push(truck.id);
  const [shipmentA] = await db.insert(s.shipments).values({
    customerId: createdCustomerIds[0],
    routeId: createdRouteIds[0],
    cargoTypeId: createdCargoTypeIds[0],
    cargoMode: 'FCL',
    status: 'DISPATCHED',
    bookingRef: `GATE-${tag}-A-${suffix}`,
  }).returning();
  createdShipmentIds.push(shipmentA.id);
  const [shipmentB] = await db.insert(s.shipments).values({
    customerId: createdCustomerIds[0],
    routeId: createdRouteIds[0],
    cargoTypeId: createdCargoTypeIds[0],
    cargoMode: 'FCL',
    status: 'DISPATCHED',
    bookingRef: `GATE-${tag}-B-${suffix}`,
  }).returning();
  createdShipmentIds.push(shipmentB.id);

  // Kết hợp reuses one physical shell: both lô carry the SAME vỏ number.
  // Kẹp rides two shells, so distinct numbers are correct there.
  const sharedShellNumber = `TGHU${String(900000 + createdShipmentContainerIds.length).padStart(6, '0')}7`;
  const fulfillments: number[] = [];
  const trips: number[] = [];
  for (const [index, shipment] of [shipmentA, shipmentB].entries()) {
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: createdContainerTypeIds[0],
      containerNumber: args.pairKind === 'KET_HOP'
        ? sharedShellNumber
        : `TGHU${String(100000 + createdShipmentContainerIds.length).padStart(6, '0')}1`,
    }).returning();
    createdShipmentContainerIds.push(container.id);
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      dispatchClassification: 'SINGLE',
    }).returning();
    createdFulfillmentIds.push(fulfillment.id);
    fulfillments.push(fulfillment.id);

    const window = index === 0 ? args.first : args.second;
    const trip = await insertTripComposite(db, {
      tripCode: `GATE-${tag}-${suffix}-${index + 1}`.slice(0, 50),
      customerId: createdCustomerIds[0],
      truckId: truck.id,
      driverId,
      routeId: createdRouteIds[0],
      cargoTypeId: createdCargoTypeIds[0],
      shipmentId: shipment.id,
      fulfillmentId: fulfillment.id,
      status: TripStatus.CREATED,
      departureDate: '2026-07-27',
      carrierType: 'OWN',
      revenue: '1500000',
      totalCost: '900000',
      driverSalary: '350000',
      plannedStartAt: new Date(window.start),
      plannedEndAt: new Date(window.end),
      canonicalOrigin: index === 0 ? 'Cat Lai' : 'Binh Duong',
      canonicalDestination: index === 0 ? 'Binh Duong' : 'Cat Lai',
      cargoWeightKg: '11000',
      vehicleCapacityKg: '18000',
    });
    createdTripIds.push(trip.id);
    trips.push(trip.id);
  }

  const pair = await createTripPair({
    firstTripId: trips[0],
    secondTripId: trips[1],
    pairKind: args.pairKind,
    firstTrip: {
      plannedStartAt: args.first.start,
      plannedEndAt: args.first.end,
      canonicalOrigin: 'Cat Lai',
      canonicalDestination: 'Binh Duong',
      cargoWeightKg: 11000,
      vehicleCapacityKg: 18000,
      expectedVersion: 1,
    },
    secondTrip: {
      plannedStartAt: args.second.start,
      plannedEndAt: args.second.end,
      canonicalOrigin: 'Binh Duong',
      canonicalDestination: 'Cat Lai',
      cargoWeightKg: 11000,
      vehicleCapacityKg: 18000,
      expectedVersion: 1,
    },
  }, adminId);
  createdPairIds.push(pair.id);
  return { pairId: pair.id, fulfillments, trips, shipmentIds: [shipmentA.id, shipmentB.id] };
}

function nextIdempotencyKey() {
  const key = `gate-${suffix}-${requestCounter++}`;
  createdIdempotencyKeys.push(key);
  return key;
}

describe('kết hợp sequencing gate + journey board pair fields', () => {
  test('KET_HOP: Lệnh 2 progress is blocked until Lệnh 1 completes, then allowed', async () => {
    const { driverId } = fixture;
    const { fulfillments, trips } = await mkPairedLô('ket', {
      pairKind: 'KET_HOP',
      first: { start: '2026-07-27T08:00:00', end: '2026-07-27T12:00:00' },
      second: { start: '2026-07-27T13:00:00', end: '2026-07-27T17:00:00' },
    });

    await assert.rejects(
      () => recordDriverFulfillmentProgress({
        fulfillmentId: fulfillments[1],
        driverId,
        input: { eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: new Date().toISOString() },
        recordedBy: fixture.adminId,
        idempotencyKey: nextIdempotencyKey(),
      }),
      (error: unknown) => error instanceof Error
        && 'statusCode' in error
        && (error as { statusCode?: number }).statusCode === 409
        && /Lệnh 2.*kết hợp|hoàn thành trả hàng Lệnh 1/.test(error.message),
    );

    // Board shows the lock while Lệnh 1 is unfinished.
    let board = await getDriverJourneyBoard(driverId);
    let lockedCard = board.find((card) => card.tripId === trips[1]);
    assert.ok(lockedCard);
    assert.equal(lockedCard.pairKind, 'KET_HOP');
    assert.equal(lockedCard.pairOrder, 2);
    assert.equal(lockedCard.pairLocked, true);

    // Finish Lệnh 1 — the gate opens.
    await db.update(s.trips).set({ status: TripStatus.COMPLETED, completedAt: new Date() })
      .where(eq(s.trips.id, trips[0]));
    board = await getDriverJourneyBoard(driverId);
    lockedCard = board.find((card) => card.tripId === trips[1]);
    assert.ok(lockedCard);
    assert.equal(lockedCard.pairLocked, false);

    const accepted = await recordDriverFulfillmentProgress({
      fulfillmentId: fulfillments[1],
      driverId,
      input: { eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: new Date().toISOString() },
      recordedBy: fixture.adminId,
      idempotencyKey: nextIdempotencyKey(),
    });
    assert.equal(accepted.event.eventType, DriverProgressEventType.ORDER_RECEIVED);
  });

  test('KEP: both cards run in parallel — no sequencing lock', async () => {
    const { driverId } = fixture;
    const { fulfillments, trips } = await mkPairedLô('kep', {
      pairKind: 'KEP',
      first: { start: '2026-07-27T08:00:00', end: '2026-07-27T12:00:00' },
      second: { start: '2026-07-27T08:00:00', end: '2026-07-27T12:00:00' },
    });

    const board = await getDriverJourneyBoard(driverId);
    for (const tripId of trips) {
      const card = board.find((item) => item.tripId === tripId);
      assert.ok(card);
      assert.equal(card.pairKind, 'KEP');
      assert.equal(card.pairLocked, false);
    }

    const accepted = await recordDriverFulfillmentProgress({
      fulfillmentId: fulfillments[1],
      driverId,
      input: { eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: new Date().toISOString() },
      recordedBy: fixture.adminId,
      idempotencyKey: nextIdempotencyKey(),
    });
    assert.equal(accepted.event.eventType, DriverProgressEventType.ORDER_RECEIVED);
  });

  test('detail view renders pair data source: paired containers carry their ACTIVE pair kind, unpaired/broken show none', async () => {
    const { trips, shipmentIds } = await mkPairedLô('det', {
      pairKind: 'KEP',
      first: { start: '2026-07-27T08:00:00', end: '2026-07-27T12:00:00' },
      second: { start: '2026-07-27T08:00:00', end: '2026-07-27T12:00:00' },
    });

    // An unpaired shipment with no fulfillment at all — the tag source is the
    // ACTIVE pair linkage, so it must read null.
    const [solo] = await db.insert(s.shipments).values({
      customerId: createdCustomerIds[0],
      routeId: createdRouteIds[0],
      cargoTypeId: createdCargoTypeIds[0],
      cargoMode: 'FCL',
      status: 'DISPATCHED',
      bookingRef: `GATE-det-solo-${suffix}`,
    }).returning();
    createdShipmentIds.push(solo.id);
    const [soloContainer] = await db.insert(s.shipmentContainers).values({
      shipmentId: solo.id,
      containerTypeId: createdContainerTypeIds[0],
      containerNumber: `TGHU${String(300000 + createdShipmentContainerIds.length).padStart(6, '0')}5`,
    }).returning();
    createdShipmentContainerIds.push(soloContainer.id);

    const pairedDetail = await getShipmentDetail(shipmentIds[0]);
    assert.equal(pairedDetail.containers.length, 1);
    assert.equal(pairedDetail.containers[0].pairKind, 'KEP');

    const soloDetail = await getShipmentDetail(solo.id);
    assert.equal(soloDetail.containers.length, 1);
    assert.equal(soloDetail.containers[0].pairKind, null);

    // Breaking the pair linkage removes the tag source (TC-GHEP-008: the tag
    // must vanish once the pair no longer exists).
    await db.update(s.trips).set({ activeTripPairId: null, activeTripPairOrder: null })
      .where(inArray(s.trips.id, trips));
    const brokenDetail = await getShipmentDetail(shipmentIds[0]);
    assert.equal(brokenDetail.containers[0].pairKind, null);
  });
});
