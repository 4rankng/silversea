/**
 * Wave 4 M8.3 slice 1 — two-orders-per-day view integration tests.
 *
 * Hits the real Postgres DB (mirrors `forwarder-settlement-workflow.test.ts`):
 * creates a driver + today's trips in various statuses, exercises
 * `getDriverTwoOrdersView`, and tears everything down in `after`.
 *
 * Coverage (PRD M08-03-03 + open §3 threshold resolved as "earliest of 2+
 * today still CREATED"):
 *   - 0 trips today → all null/empty, firstOrderLate=false.
 *   - 1 CREATED trip today → next set, active null, firstOrderLate=false (only 1).
 *   - 1 IN_TRANSIT trip today → active set, next null, firstOrderLate=false.
 *   - 2 trips today, earliest CREATED, other CREATED → firstOrderLate=true.
 *   - 2 trips today, earliest IN_TRANSIT → firstOrderLate=false (first started).
 *   - active + next distinct: IN_TRANSIT + CREATED today → both set, no mixing.
 *   - trips on a different day are excluded.
 *   - CANCELED trips today are excluded.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { getDriverTwoOrdersView } from '../services/driver.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date();
const TODAY_STR = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`;
const OTHER_DAY = '2024-01-15'; // clearly not today

const createdTripIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];

async function mkUserAndDriver() {
  const [u] = await db.insert(s.users).values({
    username: `m83-drv-${suffix}-${createdUserIds.length}`,
    passwordHash: 'x',
    role: 'DRIVER',
  }).returning();
  createdUserIds.push(u.id);
  const [d] = await db.insert(s.drivers).values({ name: `M83 driver ${suffix}`, userId: u.id }).returning();
  createdDriverIds.push(d.id);
  return d;
}

async function mkCatalogs() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `M83 customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `M83 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `M83 cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  return { customer, route, cargoType };
}

let tripCounter = 0;
async function mkTrip(
  driverId: number,
  customerId: number,
  routeId: number,
  cargoTypeId: number,
  opts: { status?: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'LOCKED' | 'CANCELED'; departureDate?: string } = {},
) {
  tripCounter += 1;
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M83-${suffix}-${tripCounter}`.slice(0, 50),
    driverId,
    customerId,
    routeId,
    cargoTypeId,
    status: opts.status ?? 'CREATED',
    departureDate: opts.departureDate ?? TODAY_STR,
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

describe('M8.3 — getDriverTwoOrdersView', () => {
  test('0 trips today → all null/empty, firstOrderLate=false', async () => {
    const driver = await mkUserAndDriver();
    const view = await getDriverTwoOrdersView(driver.id);
    assert.equal(view.date, TODAY_STR);
    assert.equal(view.active, null);
    assert.equal(view.next, null);
    assert.equal(view.firstOrderLate, false);
    assert.deepEqual(view.allToday, []);
  });

  test('1 CREATED trip today → next set, active null, firstOrderLate=false (only 1)', async () => {
    const driver = await mkUserAndDriver();
    const cat = await mkCatalogs();
    await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const view = await getDriverTwoOrdersView(driver.id);
    assert.equal(view.active, null);
    assert.ok(view.next, 'next is the CREATED trip');
    assert.equal(view.next!.status, 'CREATED');
    assert.equal(view.firstOrderLate, false, 'only 1 trip — not late');
    assert.equal(view.allToday.length, 1);
  });

  test('1 IN_TRANSIT trip today → active set, next null, firstOrderLate=false', async () => {
    const driver = await mkUserAndDriver();
    const cat = await mkCatalogs();
    await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id, { status: 'IN_TRANSIT' });
    const view = await getDriverTwoOrdersView(driver.id);
    assert.ok(view.active, 'active is the IN_TRANSIT trip');
    assert.equal(view.active!.status, 'IN_TRANSIT');
    assert.equal(view.next, null);
    assert.equal(view.firstOrderLate, false);
  });

  test('2 trips today, earliest CREATED, other CREATED → firstOrderLate=true', async () => {
    const driver = await mkUserAndDriver();
    const cat = await mkCatalogs();
    await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const view = await getDriverTwoOrdersView(driver.id);
    assert.equal(view.allToday.length, 2);
    assert.equal(view.firstOrderLate, true, '2+ today and earliest still CREATED');
  });

  test('2 trips today, earliest IN_TRANSIT → firstOrderLate=false (first started)', async () => {
    const driver = await mkUserAndDriver();
    const cat = await mkCatalogs();
    await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id, { status: 'IN_TRANSIT' });
    await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const view = await getDriverTwoOrdersView(driver.id);
    assert.equal(view.allToday.length, 2);
    assert.equal(view.firstOrderLate, false, 'earliest already IN_TRANSIT');
    assert.ok(view.active);
    assert.equal(view.active!.status, 'IN_TRANSIT');
  });

  test('active + next distinct: IN_TRANSIT + CREATED today → both set, no mixing', async () => {
    const driver = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const activeTrip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id, { status: 'IN_TRANSIT' });
    const nextTrip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const view = await getDriverTwoOrdersView(driver.id);
    assert.ok(view.active);
    assert.ok(view.next);
    assert.equal(view.active!.id, activeTrip.id);
    assert.equal(view.next!.id, nextTrip.id);
    assert.notEqual(view.active!.id, view.next!.id, 'no mixing — distinct trips');
  });

  test('trips on a different day are excluded', async () => {
    const driver = await mkUserAndDriver();
    const cat = await mkCatalogs();
    await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id, { departureDate: OTHER_DAY });
    const view = await getDriverTwoOrdersView(driver.id);
    assert.equal(view.allToday.length, 0);
    assert.equal(view.active, null);
    assert.equal(view.next, null);
  });

  test('CANCELED trips today are excluded', async () => {
    const driver = await mkUserAndDriver();
    const cat = await mkCatalogs();
    await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id, { status: 'CANCELED' });
    await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const view = await getDriverTwoOrdersView(driver.id);
    assert.equal(view.allToday.length, 1, 'only the non-CANCELED trip counts');
    assert.equal(view.allToday[0].status, 'CREATED');
  });
});

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdDriverIds.length > 0) {
      await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (err) {
    console.warn('[m83-two-orders.test] cleanup partial:', (err as Error).message);
  }
  // Force-exit — same postgres-js drain issue as the other DB tests.
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
