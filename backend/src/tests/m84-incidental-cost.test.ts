/**
 * Wave 4 M8.4 slice 3 — driver incidental-cost integration tests.
 *
 * Mirrors m84-driver-progress.test.ts: creates a driver + trip, exercises
 * `recordIncidentalCost` + `listIncidentalCosts`, tears down in `after`.
 *
 * Coverage (PRD M08-04-03 + Q23):
 *   - create → 201 (replayed=false).
 *   - idempotent replay (same key + same body) → SAME cost, replayed=true.
 *   - same key + different body → 409.
 *   - ownership: recording on another driver's trip → 403.
 *   - missing trip → 404.
 *   - LOCKED trip → 409 (costs affect financials).
 *   - list returns costs newest-first.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { recordIncidentalCost, listIncidentalCosts } from '../services/driver.service';
import { ApiError } from '../errors';
import { DriverIncidentalCostType } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

const createdCostIds: number[] = [];
const createdTripIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];

async function mkUserAndDriver() {
  const [u] = await db.insert(s.users).values({
    username: `m84ic-${suffix}-${createdUserIds.length}`,
    passwordHash: 'x', role: 'DRIVER',
  }).returning();
  createdUserIds.push(u.id);
  const [d] = await db.insert(s.drivers).values({ name: `M84IC driver ${suffix}`, userId: u.id }).returning();
  createdDriverIds.push(d.id);
  return { user: u, driver: d };
}

async function mkCatalogs() {
  const [customer] = await db.insert(s.customers).values({ name: `M84IC cust ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `M84IC route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `M84IC cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  return { customer, route, cargoType };
}

let tripCounter = 0;
async function mkTrip(driverId: number, customerId: number, routeId: number, cargoTypeId: number, opts: { status?: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'LOCKED' | 'CANCELED' } = {}) {
  tripCounter += 1;
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M84IC-${suffix}-${tripCounter}`.slice(0, 50),
    driverId, customerId, routeId, cargoTypeId,
    status: opts.status ?? 'IN_TRANSIT', departureDate: TODAY,
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function assertStatus(fn: () => Promise<unknown>, code: number): Promise<ApiError> {
  try { await fn(); throw new Error(`expected ApiError(${code}) but succeeded`); }
  catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}`);
    assert.equal((err as ApiError).statusCode, code);
    return err as ApiError;
  }
}

describe('M8.4 slice 3 — driver incidental costs', () => {
  test('create → replayed=false; list returns it', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const { cost, replayed } = await recordIncidentalCost(trip.id, driver.id,
      { costType: DriverIncidentalCostType.PER_DIEM, amount: 200000, occurredAt: TODAY, note: 'phụ cấp ngày' }, user.id, `create-${suffix}-${trip.id}`);
    createdCostIds.push(cost.id);
    assert.equal(replayed, false);
    assert.equal(cost.costType, 'PER_DIEM');
    assert.equal(cost.amount, '200000');
    const items = await listIncidentalCosts(trip.id, driver.id);
    assert.equal(items.length, 1);
  });

  test('idempotent replay → SAME cost, replayed=true, no duplicate', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const key = `ic-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
    const body = { costType: DriverIncidentalCostType.LIFT_FEE, amount: 150000, occurredAt: TODAY };
    const first = await recordIncidentalCost(trip.id, driver.id, body, user.id, key);
    createdCostIds.push(first.cost.id);
    const replay = await recordIncidentalCost(trip.id, driver.id, body, user.id, key);
    assert.equal(replay.replayed, true);
    assert.equal(replay.cost.id, first.cost.id);
    assert.equal((await listIncidentalCosts(trip.id, driver.id)).length, 1);
  });

  test('same key + different body → 409', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const key = `ic2-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
    const first = await recordIncidentalCost(trip.id, driver.id,
      { costType: DriverIncidentalCostType.PARKING, amount: 50000, occurredAt: TODAY }, user.id, key);
    createdCostIds.push(first.cost.id);
    await assertStatus(() => recordIncidentalCost(trip.id, driver.id,
      { costType: DriverIncidentalCostType.TOLL, amount: 30000, occurredAt: TODAY }, user.id, key), 409);
  });

  test('ownership → 403', async () => {
    const owner = await mkUserAndDriver();
    const other = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(owner.driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    await assertStatus(() => recordIncidentalCost(trip.id, other.driver.id,
      { costType: DriverIncidentalCostType.OTHER, amount: 10000, occurredAt: TODAY }, other.user.id, undefined), 403);
  });

  test('missing trip → 404', async () => {
    const { user, driver } = await mkUserAndDriver();
    await assertStatus(() => recordIncidentalCost(99_999_999, driver.id,
      { costType: DriverIncidentalCostType.OTHER, amount: 10000, occurredAt: TODAY }, user.id, undefined), 404);
  });

  test('LOCKED trip → 409 (costs affect financials)', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id, { status: 'LOCKED' });
    await assertStatus(() => recordIncidentalCost(trip.id, driver.id,
      { costType: DriverIncidentalCostType.FUEL, amount: 300000, occurredAt: TODAY }, user.id, `locked-${suffix}-${trip.id}`), 409);
  });

  test('list returns costs newest-first', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const a = await recordIncidentalCost(trip.id, driver.id,
      { costType: DriverIncidentalCostType.PER_DIEM, amount: 200000, occurredAt: TODAY }, user.id, `timeline-a-${suffix}-${trip.id}`);
    const b = await recordIncidentalCost(trip.id, driver.id,
      { costType: DriverIncidentalCostType.FUEL, amount: 300000, occurredAt: TODAY }, user.id, `timeline-b-${suffix}-${trip.id}`);
    createdCostIds.push(a.cost.id, b.cost.id);
    const items = await listIncidentalCosts(trip.id, driver.id);
    assert.equal(items.length, 2);
    assert.equal(items[0].id, b.cost.id, 'newest (b) sorts first');
    assert.equal(items[1].id, a.cost.id);
  });
});

after(async () => {
  try {
    if (createdCostIds.length > 0) await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.entityId, createdCostIds));
    if (createdCostIds.length > 0) await db.delete(s.driverIncidentalCosts).where(inArray(s.driverIncidentalCosts.id, createdCostIds));
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdDriverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } catch (err) {
    console.warn('[m84-incidental-cost.test] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
