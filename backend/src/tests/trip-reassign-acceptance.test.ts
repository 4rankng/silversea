import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { DriverProgressEventType, Role, TripStatus } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { reassignTrip } from '../services/trip-mutations.service';
import { disconnectRedis } from '../lib/redis';

// Card 091026190520 (FB-081, option b): once the driver acknowledged the
// order (ORDER_RECEIVED), a VEHICLE-ONLY correction stays allowed — the
// driver keeps the job they accepted; only the truck/trailer (OWN) or the
// carrier/plate (EXTERNAL) may change. A driver change (or a carrier-type
// switch, which drops the driver) still needs the pre-acceptance window.
const tripIds: number[] = [];
const truckIds: number[] = [];
const driverIds: number[] = [];
const eventIds: number[] = [];
const userIds: number[] = [];
const customerIds: number[] = [];

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkUser() {
  const [user] = await db.insert(s.users).values({ username: `ra-${suffix()}`.slice(0, 40), passwordHash: 'x', role: Role.MANAGER }).returning({ id: s.users.id, username: s.users.username, role: s.users.role });
  userIds.push(user.id);
  return { id: user.id, userId: user.id, username: user.username, email: null, fullName: 'Manager', role: user.role };
}

async function mkDriver(userId: number, label: string) {
  const [driver] = await db.insert(s.drivers).values({ userId, name: `${label} ${suffix()}`, status: 'ACTIVE' }).returning({ id: s.drivers.id });
  driverIds.push(driver.id);
  return driver;
}

async function mkTruck(label: string) {
  const [truck] = await db.insert(s.trucks).values({ licensePlate: `${label}-${suffix()}`.slice(0, 20), trailerType: '40FT', status: 'ACTIVE' }).returning({ id: s.trucks.id });
  truckIds.push(truck.id);
  return truck;
}

async function fixtureOwnTrip(status: TripStatus) {
  const suf = suffix();
  const [customer] = await db.insert(s.customers).values({ name: `RA-A ${suf}` }).returning({ id: s.customers.id });
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `RA-A route ${suf}` }).returning();
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `RA-A cargo ${suf}` }).returning();
  const user = await mkUser();
  const driver = await mkDriver(user.id, 'Lái A');
  const truckA = await mkTruck('RA-A1');
  const truckB = await mkTruck('RA-A2');
  const trip = await insertTripComposite(db, {
    tripCode: `RA-A-${suf}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status,
    version: 1,
    departureDate: '2026-10-20',
    revenue: '1000000',
    carrierType: 'OWN',
    truckId: truckA.id,
    driverId: driver.id,
  });
  tripIds.push(trip.id);
  return { trip, driver, truckA, truckB, user };
}

async function acknowledge(tripId: number, driverId: number, userId: number) {
  const [ev] = await db.insert(s.driverProgressEvents).values({
    tripId,
    driverId,
    eventType: DriverProgressEventType.ORDER_RECEIVED,
    occurredAt: new Date(),
    recordedBy: userId,
  }).returning({ id: s.driverProgressEvents.id });
  eventIds.push(ev.id);
}

async function ownAssignment(tripId: number) {
  const [row] = await db.select({ truckId: s.trips.truckId, driverId: s.trips.driverId })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  return row;
}

describe('reassignTrip after driver acceptance (card 091026190520, option b)', () => {
  test('acknowledged IN_TRANSIT: vehicle-only change is allowed, driver preserved', async () => {
    const { trip, driver, truckB, user } = await fixtureOwnTrip(TripStatus.IN_TRANSIT);
    await acknowledge(trip.id, driver.id, user.id);
    const result = await reassignTrip(trip.id, {
      carrierType: 'OWN',
      truckId: truckB.id,
      driverId: driver.id,
      expectedVersion: 1,
    });
    assert.equal(result.version, 2);
    const stored = await ownAssignment(trip.id);
    assert.equal(stored.truckId, truckB.id);
    assert.equal(stored.driverId, driver.id);
  });

  test('acknowledged IN_TRANSIT: driver change stays rejected with the vehicle-only message', async () => {
    const { trip, driver, truckA, user } = await fixtureOwnTrip(TripStatus.IN_TRANSIT);
    await acknowledge(trip.id, driver.id, user.id);
    const otherUser = await mkUser();
    const otherDriver = await mkDriver(otherUser.id, 'Lái B');
    await assert.rejects(
      reassignTrip(trip.id, { carrierType: 'OWN', truckId: truckA.id, driverId: otherDriver.id, expectedVersion: 1 }),
      /chỉ được đổi xe|Không thể điều chỉnh/,
    );
  });

  test('acknowledged IN_TRANSIT: carrier-type switch (drops the driver) stays rejected', async () => {
    const { trip, driver, user } = await fixtureOwnTrip(TripStatus.IN_TRANSIT);
    await acknowledge(trip.id, driver.id, user.id);
    await assert.rejects(
      reassignTrip(trip.id, { carrierType: 'EXTERNAL', externalPlateNumber: '51C-999.99', expectedVersion: 1 }),
      /chỉ được đổi xe|Không thể điều chỉnh/,
    );
  });

  test('acknowledged IN_TRANSIT EXTERNAL: plate change with the same driver is allowed', async () => {
    const suf = suffix();
    const [customer] = await db.insert(s.customers).values({ name: `RA-E ${suf}` }).returning({ id: s.customers.id });
    customerIds.push(customer.id);
    const [route] = await db.insert(s.routes).values({ name: `RA-E route ${suf}` }).returning();
    const [cargoType] = await db.insert(s.cargoTypes).values({ name: `RA-E cargo ${suf}` }).returning();
    const user = await mkUser();
    const trip = await insertTripComposite(db, {
      tripCode: `RA-E-${suf}`.slice(0, 50),
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      status: TripStatus.IN_TRANSIT,
      version: 1,
      departureDate: '2026-10-20',
      revenue: '1000000',
      carrierType: 'EXTERNAL',
      externalPlateNumber: '51C-111.11',
      externalDriverName: 'Anh Tư',
      externalDriverPhone: '0901111222',
    });
    tripIds.push(trip.id);
    const carrierDriver = await mkDriver(user.id, 'RA-E drv');
    await acknowledge(trip.id, carrierDriver.id, user.id);
    const result = await reassignTrip(trip.id, {
      carrierType: 'EXTERNAL',
      externalPlateNumber: '51C-222.22',
      externalDriverName: 'Anh Tư',
      externalDriverPhone: '0901111222',
      expectedVersion: 1,
    });
    assert.equal(result.version, 2);
  });

  test('unacknowledged IN_TRANSIT keeps the full reassignment window', async () => {
    const { trip, driver, truckB } = await fixtureOwnTrip(TripStatus.IN_TRANSIT);
    const result = await reassignTrip(trip.id, {
      carrierType: 'OWN',
      truckId: truckB.id,
      driverId: driver.id,
      expectedVersion: 1,
    });
    assert.equal(result.version, 2);
  });
});

after(async () => {
  if (eventIds.length) await db.delete(s.driverProgressEvents).where(inArray(s.driverProgressEvents.id, eventIds));
  if (tripIds.length) {
    await db.delete(s.notifications).where(inArray(s.notifications.relatedEntityId, tripIds));
    await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, tripIds));
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, tripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (driverIds.length) await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
  if (truckIds.length) await db.delete(s.trucks).where(inArray(s.trucks.id, truckIds));
  if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  await disconnectRedis();
  await client.end();
});

// ── Route-path rework (QA FAILED 22:5x): the operator route drives
// reassignIssuedDispatchWriteCommand → issueFulfillmentDispatchOrder, NOT
// reassignTrip. These cases pin the acceptance lock through THAT path. ──
import { issueOrderCreateOrUpdate, reassignIssuedDispatchWriteCommand } from '../services/dispatch-planning-commands.service';
import { ApiError } from '../errors';

async function mkRouteFixture() {
  const suf = suffix();
  const [customer] = await db.insert(s.customers).values({ name: `RA-R ${suf}` }).returning({ id: s.customers.id });
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `RA-R route ${suf}`, distanceKm: 120 }).returning({ id: s.routes.id });
  const user = await mkUser();
  const [driverUser] = await db.insert(s.users).values({ username: `ra-d-${suffix()}`.slice(0, 40), passwordHash: 'x', role: Role.DRIVER }).returning({ id: s.users.id });
  userIds.push(driverUser.id);
  const driver = await mkDriver(driverUser.id, 'Lái R');
  const [otherDriverUser] = await db.insert(s.users).values({ username: `ra-e-${suffix()}`.slice(0, 40), passwordHash: 'x', role: Role.DRIVER }).returning({ id: s.users.id });
  userIds.push(otherDriverUser.id);
  const otherDriver = await mkDriver(otherDriverUser.id, 'Lái R2');
  const mkRig = async (label: string) => {
    const [trailer] = await db.insert(s.trailers).values({ licensePlate: `RA-T-${label}-${suffix().slice(-5)}`.slice(0, 20), type: '40FT', status: 'ACTIVE' }).returning({ id: s.trailers.id });
    const [truck] = await db.insert(s.trucks).values({ licensePlate: `RA-F-${label}-${suffix().slice(-5)}`.slice(0, 20), currentTrailerId: trailer.id, trailerType: '40FT', status: 'ACTIVE' }).returning({ id: s.trucks.id });
    truckIds.push(truck.id);
    return truck;
  };
  const truckA = await mkRig('R1');
  const truckB = await mkRig('R2');
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoMode: 'FCL',
    shipmentCode: `RA-R-${suf}`.slice(0, 50),
    bookingRef: `RARBOOK-${suf}`.slice(0, 50),
    status: 'DISPATCHED',
    createdBy: user.userId,
  }).returning({ id: s.shipments.id });
  const [containerType] = await db.insert(s.containerTypes).values({ code: `20DC${suf.replace(/\D/g, '').slice(-7)}`, name: "20' test" }).returning({ id: s.containerTypes.id });
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: containerType.id,
    containerNumber: `RARU${suf.replace(/\D/g, '').slice(-7)}`.slice(0, 50),
    routeId: route.id,
    cargoWeightKg: '12000',
    createdBy: user.userId,
  }).returning({ id: s.shipmentContainers.id });
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    dispatchClassification: 'SINGLE',
    shipmentContainerId: container.id,
    sourceShipmentVersion: 1,
    siteSnapshot: {},
    plannedCarrierType: 'OWN',
    createdBy: user.userId,
  }).returning();
  const outcome = await db.transaction((tx) => issueOrderCreateOrUpdate(tx, {
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    expectedVersion: fulfillment.version,
    plannedStartAt: '2026-10-20T08:00:00+07:00',
    plannedEndAt: '2026-10-20T18:00:00+07:00',
    endTimeConfirmed: true,
    carrierType: 'OWN',
    truckId: truckA.id,
    driverId: driver.id,
    idempotencyKey: `rar-issue-${suf}`,
    actor: { ...user, role: Role.MANAGER },
  }));
  tripIds.push(outcome.trip.id);
  await db.update(s.trips).set({ status: TripStatus.IN_TRANSIT }).where(eq(s.trips.id, outcome.trip.id));
  await acknowledge(outcome.trip.id, driver.id, user.userId);
  const [freshFulfillment] = await db.select().from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id)).limit(1);
  return { shipment, fulfillment: freshFulfillment, trip: outcome.trip, driver, otherDriver, truckA, truckB, user };
}

describe('route path (reassignIssuedDispatchWriteCommand) — card 091026190520 rework', () => {
  test('acknowledged trip: truck swap with the driver kept is allowed', async () => {
    const fx = await mkRouteFixture();
    await db.transaction((_tx) => reassignIssuedDispatchWriteCommand({
      shipmentId: fx.shipment.id,
      fulfillmentId: fx.fulfillment.id,
      expectedVersion: fx.fulfillment.version,
      expectedTripVersion: fx.trip.version,
      plannedStartAt: '2026-10-20T08:00:00+07:00',
      plannedEndAt: '2026-10-20T18:00:00+07:00',
      endTimeConfirmed: true,
      carrierType: 'OWN',
      truckId: fx.truckB.id,
      driverId: fx.driver.id,
      idempotencyKey: `rar-vehicle-${suffix()}`,
      actor: { ...fx.user, role: Role.MANAGER },
    }));
    const [after] = await db.select({ truckId: s.trips.truckId, driverId: s.trips.driverId }).from(s.trips).where(eq(s.trips.id, fx.trip.id)).limit(1);
    assert.equal(after.truckId, fx.truckB.id, 'truck must swap to truckB through the route command');
    assert.equal(after.driverId, fx.driver.id, 'driver must be kept after acknowledgement');
  });

  test('acknowledged trip: driver change still blocked with the vehicle-only message', async () => {
    const fx = await mkRouteFixture();
    await assert.rejects(
      () => db.transaction((_tx) => reassignIssuedDispatchWriteCommand({
        shipmentId: fx.shipment.id,
        fulfillmentId: fx.fulfillment.id,
        expectedVersion: fx.fulfillment.version,
        expectedTripVersion: fx.trip.version,
        plannedStartAt: '2026-10-20T08:00:00+07:00',
        plannedEndAt: '2026-10-20T18:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: fx.truckA.id,
        driverId: fx.otherDriver.id,
        idempotencyKey: `rar-driver-${suffix()}`,
        actor: { ...fx.user, role: Role.MANAGER },
      })),
      (err: unknown) => {
        assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
        assert.equal(err.statusCode, 409);
        assert.equal(err.message, 'Lái xe đã nhận việc — chỉ được đổi xe, giữ lái xe.');
        return true;
      },
    );
  });
});
