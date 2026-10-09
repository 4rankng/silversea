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
  const [user] = await db.insert(s.users).values({ username: `ra-${suffix()}`.slice(0, 40), passwordHash: 'x', role: Role.MANAGER }).returning({ id: s.users.id });
  userIds.push(user.id);
  return user;
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
