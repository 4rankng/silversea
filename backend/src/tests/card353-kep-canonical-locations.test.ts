/**
 * Card 353 rework (QA FAILED 2026-10-05): "Ghép chuyến" (Kẹp) hard-blocked
 * because trips.canonical_origin / trips.canonical_destination are NULL on
 * every issued trip — no backend writer ever filled them (schema + readers
 * only; prior tests seeded the columns directly). draftFor() blocks before
 * the POST and buildTripPairSnapshot 422s MISSING_LOCATION at the API.
 *
 * Contracts:
 *   - issue-order writes canonical_origin/destination from the fulfillment
 *     container's Cảng nâng / Cảng hạ (port operational name, raw-name
 *     fallback for ad-hoc orders) at dispatch time.
 *   - readers (getTripById → FE draftFor; loadTripsForPairing → pair
 *     authority + snapshot) coalesce from the container ports for trips
 *     issued before the fix (staging trips 131-134 population).
 *   - createTripPair's write-back persists the coalesced locations, so a
 *     first pair self-heals the two columns on legacy rows.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { issueOrderCreateOrUpdate } from '../services/dispatch-planning-commands.service';
import { createTripPair } from '../services/trip-pairs.service';
import { getTripById } from '../services/trip-queries.service';
import type { AuthUser } from '../middleware/auth';

/** The planning-authority fields the FE draftFor() derives a pair draft from. */
interface TripPlanningDetail {
  id: number;
  version: number;
  plannedStartAt: Date | string | null;
  plannedEndAt: Date | string | null;
  canonicalOrigin: string | null;
  canonicalDestination: string | null;
  cargoWeightKg: string | number | null;
  vehicleCapacityKg: string | number | null;
}

/** One rig (xe + moóc + lái) shared by both KEP orders of a lot. */
interface TestFleet {
  trailer: { id: number };
  truck: { id: number };
  driver: { id: number };
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdPortIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdTripIds: number[] = [];
const createdPairIds: number[] = [];
const createdTrailerIds: number[] = [];
const createdTruckIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
let admin: AuthUser;

async function mkPort(name: string, shortName: string) {
  const [port] = await db.insert(s.ports).values({ name, shortName }).returning();
  createdPortIds.push(port.id);
  return port;
}

async function mkFleet(): Promise<TestFleet> {
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
    username: `c353-driver-${suffix}-${createdDriverIds.length}`,
    passwordHash: 'test-only',
    role: Role.DRIVER,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(driverUser.id);
  const [driver] = await db.insert(s.drivers).values({
    userId: driverUser.id,
    name: `C353 driver ${suffix}-${createdDriverIds.length}`,
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

/**
 * One lot, two 20' containers, each with its own fulfillment — the staging
 * E2E-KEP3-QA2 shape (2×20'DC, Cảng nâng Tân Vũ → Bãi SITC, 15.000 kg/cont,
 * PHÂN LOẠI Kẹp = dispatchClassification DOUBLE).
 */
async function mkKepLot(args: { pickupPortId: number; dropoffPortId: number }) {
  const [customer] = await db.insert(s.customers)
    .values({ name: `C353 customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `C353 route ${suffix}-${createdRouteIds.length}`, distanceKm: 120 }).returning();
  createdRouteIds.push(route.id);

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoMode: 'FCL',
    shipmentCode: `C353-${suffix}-${createdShipmentIds.length}`,
    bookingRef: `C353BOOK-${suffix}-${createdShipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    closingAt: new Date('2026-10-10T08:00:00.000Z'),
    createdBy: admin.userId,
  }).returning();
  createdShipmentIds.push(shipment.id);

  const [containerType] = await db.insert(s.containerTypes).values({
    code: `20DC${suffix.replace(/\D/g, '').slice(-8)}${createdContainerTypeIds.length}`.slice(0, 20),
    name: "20'DC",
  }).returning();
  createdContainerTypeIds.push(containerType.id);

  const fulfillments: Array<typeof s.shipmentFulfillments.$inferSelect> = [];
  for (const index of [0, 1]) {
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: containerType.id,
      containerNumber: `C353KEP${suffix.replace(/\D/g, '').slice(-7)}${index}`.slice(0, 50),
      routeId: route.id,
      pickupPortId: args.pickupPortId,
      dropoffPortId: args.dropoffPortId,
      cargoWeightKg: '15000',
      createdBy: admin.userId,
    }).returning();
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      dispatchClassification: 'DOUBLE',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      plannedCarrierType: 'OWN',
      createdBy: admin.userId,
    }).returning();
    createdFulfillmentIds.push(fulfillment.id);
    fulfillments.push(fulfillment);
  }
  return { shipment, fulfillments };
}

/** Both KEP orders issue on ONE rig (same xe/moóc/lái, like staging QA2). */
async function issue(fulfillment: { id: number; version: number }, shipmentId: number, fleet: Awaited<ReturnType<typeof mkFleet>>) {
  const outcome = await db.transaction((tx) => issueOrderCreateOrUpdate(tx, {
    shipmentId,
    fulfillmentId: fulfillment.id,
    expectedVersion: fulfillment.version,
    plannedStartAt: '2026-10-06T08:00:00+07:00',
    plannedEndAt: '2026-10-06T18:00:00+07:00',
    endTimeConfirmed: true,
    carrierType: 'OWN',
    truckId: fleet.truck.id,
    driverId: fleet.driver.id,
    trailerId: fleet.trailer.id,
    idempotencyKey: `c353-dispatch-${suffix}-${fulfillment.id}`,
    actor: { ...admin, role: Role.ADMIN },
  }));
  createdTripIds.push(outcome.trip.id);
  return outcome;
}

/** The FE draftFor() shape — fails loudly if any planning field is missing. */
function draftFromDetail(trip: TripPlanningDetail) {
  assert.ok(trip.plannedStartAt && trip.plannedEndAt, `trip ${trip.id}: thiếu planned window`);
  assert.ok(trip.canonicalOrigin, `trip ${trip.id}: canonicalOrigin null — draftFor() sẽ chặn (thiếu điểm đi)`);
  assert.ok(trip.canonicalDestination, `trip ${trip.id}: canonicalDestination null — draftFor() sẽ chặn (thiếu điểm đến)`);
  assert.ok(trip.cargoWeightKg && trip.vehicleCapacityKg, `trip ${trip.id}: thiếu khối lượng/tải trọng`);
  return {
    plannedStartAt: new Date(trip.plannedStartAt).toISOString(),
    plannedEndAt: new Date(trip.plannedEndAt).toISOString(),
    canonicalOrigin: trip.canonicalOrigin,
    canonicalDestination: trip.canonicalDestination,
    cargoWeightKg: Number(trip.cargoWeightKg),
    vehicleCapacityKg: Number(trip.vehicleCapacityKg),
    expectedVersion: trip.version,
  };
}

before(async () => {
  const [user] = await db.insert(s.users).values({
    username: `c353-admin-${suffix}`,
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
  await db.delete(s.tripPairs).where(inArray(
    s.tripPairs.id,
    createdPairIds.length > 0 ? createdPairIds : [-1],
  )).catch(() => {});
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
  await db.delete(s.ports).where(inArray(s.ports.id, createdPortIds.length > 0 ? createdPortIds : [-1])).catch(() => {});
  await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds.length > 0 ? createdRouteIds : [-1])).catch(() => {});
  await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds.length > 0 ? createdCustomerIds : [-1])).catch(() => {});
  await db.delete(s.users).where(inArray(s.users.id, createdUserIds.length > 0 ? createdUserIds : [-1])).catch(() => {});
  await client.end();
  await disconnectRedis();
});

describe('card 353 — canonical_origin/destination at issue + pairing', () => {
  test('repro: pair of issued trips with NULL canonical columns (staging trips 131-134 shape) pairs from container ports instead of 422 MISSING_LOCATION', async () => {
    const pickup = await mkPort('Cảng Tân Vũ', 'Tân Vũ');
    const dropoff = await mkPort('Bãi SITC', 'SITC');
    const lot = await mkKepLot({ pickupPortId: pickup.id, dropoffPortId: dropoff.id });
    const fleet = await mkFleet();
    const first = await issue(lot.fulfillments[0], lot.shipment.id, fleet);
    const second = await issue(lot.fulfillments[1], lot.shipment.id, fleet);

    // Legacy rows: trips issued BEFORE the fix keep NULL canonical columns —
    // exactly the staging census (trip-133.json / trip-134.json).
    await db.update(s.trips).set({ canonicalOrigin: null, canonicalDestination: null })
      .where(inArray(s.trips.id, [first.trip.id, second.trip.id]));

    // Straight API call with the container's ports as drafts — the staging
    // probe api-pair-response-133-134-422.json shape that returned
    // 422 "Cần nhập đủ điểm đi và điểm đến cho cả hai chuyến" at HEAD.
    const [firstRow] = await db.select().from(s.trips).where(eq(s.trips.id, first.trip.id));
    const [secondRow] = await db.select().from(s.trips).where(eq(s.trips.id, second.trip.id));
    const draft = (row: typeof s.trips.$inferSelect) => ({
      plannedStartAt: row.plannedStartAt!.toISOString(),
      plannedEndAt: row.plannedEndAt!.toISOString(),
      canonicalOrigin: 'Tân Vũ',
      canonicalDestination: 'SITC',
      cargoWeightKg: Number(row.cargoWeightKg),
      vehicleCapacityKg: Number(row.vehicleCapacityKg),
      expectedVersion: row.version,
    });

    const pair = await createTripPair({
      firstTripId: first.trip.id,
      secondTripId: second.trip.id,
      pairKind: 'KEP',
      firstTrip: draft(firstRow),
      secondTrip: draft(secondRow),
    }, admin.userId);
    createdPairIds.push(pair.id);
    assert.equal(pair.status, 'ACTIVE');

    // Self-heal: the pair write-back persists the coalesced locations.
    const [healed] = await db.select().from(s.trips).where(eq(s.trips.id, first.trip.id));
    assert.equal(healed.canonicalOrigin, 'Tân Vũ', 'pair write-back phải tự heal canonical_origin');
    assert.equal(healed.canonicalDestination, 'SITC', 'pair write-back phải tự heal canonical_destination');
  });

  test('issue order writes canonical_origin/destination from the container Cảng nâng/Cảng hạ (draftFor no longer blocks)', async () => {
    const pickup = await mkPort('Cảng Tân Cảng', 'Tân Cảng');
    const dropoff = await mkPort('Bãi Nam Hải', 'Nam Hải');
    const lot = await mkKepLot({ pickupPortId: pickup.id, dropoffPortId: dropoff.id });
    const fleet = await mkFleet();
    const first = await issue(lot.fulfillments[0], lot.shipment.id, fleet);
    const second = await issue(lot.fulfillments[1], lot.shipment.id, fleet);

    const firstDetail = await getTripById(first.trip.id);
    const secondDetail = await getTripById(second.trip.id);
    assert.ok(firstDetail && secondDetail);
    // The stored columns themselves carry the locations at issue time.
    const [firstStored] = await db.select().from(s.trips).where(eq(s.trips.id, first.trip.id));
    assert.equal(firstStored.canonicalOrigin, 'Tân Cảng');
    assert.equal(firstStored.canonicalDestination, 'Nam Hải');

    // The FE dialog derives drafts from getTripById — all fields present.
    const pair = await createTripPair({
      firstTripId: first.trip.id,
      secondTripId: second.trip.id,
      pairKind: 'KEP',
      firstTrip: draftFromDetail(firstDetail),
      secondTrip: draftFromDetail(secondDetail),
    }, admin.userId);
    createdPairIds.push(pair.id);
    assert.equal(pair.status, 'ACTIVE');
  });

  test('reader coalesce: getTripById returns container ports for already-issued trips with NULL canonical columns', async () => {
    const pickup = await mkPort('Cảng Hải Phòng', 'Hải Phòng');
    const dropoff = await mkPort('Kho Thái Nguyên', 'Thái Nguyên');
    const lot = await mkKepLot({ pickupPortId: pickup.id, dropoffPortId: dropoff.id });
    const fleet = await mkFleet();
    const first = await issue(lot.fulfillments[0], lot.shipment.id, fleet);

    await db.update(s.trips).set({ canonicalOrigin: null, canonicalDestination: null })
      .where(eq(s.trips.id, first.trip.id));

    const detail = await getTripById(first.trip.id);
    assert.ok(detail);
    assert.equal(detail.canonicalOrigin, 'Hải Phòng', 'legacy trip phải coalesce từ Cảng nâng của container');
    assert.equal(detail.canonicalDestination, 'Thái Nguyên', 'legacy trip phải coalesce từ Cảng hạ của container');
  });
});
