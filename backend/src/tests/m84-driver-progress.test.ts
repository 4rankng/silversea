/**
 * Wave 4 M8.4 slice 1 — driver progress-event log integration tests.
 *
 * Hits the real Postgres DB (mirrors `m83-two-orders.test.ts`): creates a
 * driver + trip + progress events, exercises `recordDriverProgress` and
 * `listDriverProgress`, and tears everything down in `after`.
 *
 * Coverage (PRD M08-04-03 + Q23):
 *   - create event → 201 (replayed=false).
 *   - idempotent replay (same key + same body) → returns the SAME event
 *     (replayed=true); no duplicate row.
 *   - same key + different body → ApiError 409.
 *   - no key → rejected (Q23 durable command boundary).
 *   - ownership: a driver recording progress on another driver's trip → 403.
 *   - missing trip → 404.
 *   - list returns events oldest-first (timeline order).
 *   - LOCKED trip still accepts progress (event is a log, not a state mutation).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { recordDriverProgress, listDriverProgress } from '../services/driver.service';
import { ApiError } from '../errors';
import { DriverProgressEventType } from '@tingting/shared';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../services/idempotency.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NOW_ISO = new Date().toISOString();

const createdEventIds: number[] = [];
const createdTripIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];
let userCounter = 0;

async function mkUserAndDriver() {
  userCounter += 1;
  const [u] = await db.insert(s.users).values({
    username: `m84-drv-${suffix}-${userCounter}`,
    passwordHash: 'x',
    role: 'DRIVER',
  }).returning();
  createdUserIds.push(u.id);
  const [d] = await db.insert(s.drivers).values({ name: `M84 driver ${suffix}-${userCounter}`, userId: u.id }).returning();
  createdDriverIds.push(d.id);
  return { user: u, driver: d };
}

async function mkCatalogs() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `M84 customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `M84 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `M84 cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  return { customer, route, cargoType };
}

let tripCounter = 0;
async function mkTrip(driverId: number, customerId: number, routeId: number, cargoTypeId: number, opts: { status?: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'LOCKED' | 'CANCELED' } = {}) {
  tripCounter += 1;
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M84-${suffix}-${tripCounter}`.slice(0, 50),
    driverId,
    customerId,
    routeId,
    cargoTypeId,
    status: opts.status ?? 'IN_TRANSIT',
    departureDate: new Date().toISOString().slice(0, 10),
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function assert403(fn: () => Promise<unknown>): Promise<ApiError> {
  try { await fn(); throw new Error('expected ApiError(403) but call succeeded'); }
  catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}`);
    assert.equal((err as ApiError).statusCode, 403);
    return err as ApiError;
  }
}
async function assert404(fn: () => Promise<unknown>): Promise<ApiError> {
  try { await fn(); throw new Error('expected ApiError(404) but call succeeded'); }
  catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}`);
    assert.equal((err as ApiError).statusCode, 404);
    return err as ApiError;
  }
}
async function assert409(fn: () => Promise<unknown>): Promise<ApiError> {
  try { await fn(); throw new Error('expected ApiError(409) but call succeeded'); }
  catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}`);
    assert.equal((err as ApiError).statusCode, 409);
    return err as ApiError;
  }
}
async function assert400(fn: () => Promise<unknown>): Promise<ApiError> {
  try { await fn(); throw new Error('expected ApiError(400) but call succeeded'); }
  catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}`);
    assert.equal((err as ApiError).statusCode, 400);
    return err as ApiError;
  }
}

async function fetchDriverProgressCount(tripId: number, driverId: number) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.driverProgressEvents)
    .where(and(
      eq(s.driverProgressEvents.tripId, tripId),
      eq(s.driverProgressEvents.driverId, driverId),
    ));
  return Number(total ?? 0);
}

async function fetchDriverProgressIdempotencyCount(idempotencyKey: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.idempotencyKeys)
    .where(and(
      eq(s.idempotencyKeys.endpoint, IDEMPOTENCY_ENDPOINTS.DRIVER_PROGRESS),
      eq(s.idempotencyKeys.idempotencyKey, idempotencyKey),
    ));
  return Number(total ?? 0);
}

describe('M8.4 — driver progress events', () => {
  test('create event → replayed=false; list returns it oldest-first', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);

    const { event, replayed } = await recordDriverProgress(
      trip.id, driver.id,
      { eventType: DriverProgressEventType.DEPARTED, occurredAt: NOW_ISO, note: 'xuất phát đúng giờ' },
      user.id, `create-${suffix}-${trip.id}`,
    );
    createdEventIds.push(event.id);
    assert.equal(replayed, false);
    assert.equal(event.eventType, 'DEPARTED');
    assert.equal(event.tripId, trip.id);
    assert.equal(event.driverId, driver.id);

    const items = await listDriverProgress(trip.id, driver.id);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, event.id);
  });

  test('idempotent replay (same key + same body) → returns SAME event, replayed=true; no duplicate', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const key = `replay-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
    const body = { eventType: DriverProgressEventType.ARRIVED, occurredAt: NOW_ISO, note: 'đến nơi' };

    const first = await recordDriverProgress(trip.id, driver.id, body, user.id, key);
    createdEventIds.push(first.event.id);
    assert.equal(first.replayed, false);

    const replay = await recordDriverProgress(trip.id, driver.id, body, user.id, key);
    assert.equal(replay.replayed, true);
    assert.equal(replay.event.id, first.event.id, 'replay returns the SAME event id — no duplicate');

    const items = await listDriverProgress(trip.id, driver.id);
    assert.equal(items.length, 1, 'no duplicate row');
  });

  test('same key + different body → 409', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const key = `conflict-${suffix}-${Math.random().toString(36).slice(2, 8)}`;

    const first = await recordDriverProgress(trip.id, driver.id,
      { eventType: DriverProgressEventType.FUELED, occurredAt: NOW_ISO }, user.id, key);
    createdEventIds.push(first.event.id);

    await assert409(() => recordDriverProgress(trip.id, driver.id,
      { eventType: DriverProgressEventType.INCIDENT, occurredAt: NOW_ISO, note: 'different' }, user.id, key));
  });

  test('no key → rejected by the durable command boundary', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);

    await assert400(() => recordDriverProgress(trip.id, driver.id,
      { eventType: DriverProgressEventType.DEPARTED, occurredAt: NOW_ISO }, user.id, undefined));
    assert.equal(await fetchDriverProgressCount(trip.id, driver.id), 0);
  });

  test('ownership: recording progress on another driver\'s trip → 403', async () => {
    const owner = await mkUserAndDriver();
    const other = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(owner.driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);

    await assert403(() => recordDriverProgress(trip.id, other.driver.id,
      { eventType: DriverProgressEventType.NOTE, occurredAt: NOW_ISO }, other.user.id, undefined));
  });

  test('missing trip → 404', async () => {
    const { user, driver } = await mkUserAndDriver();
    await assert404(() => recordDriverProgress(99_999_999, driver.id,
      { eventType: DriverProgressEventType.NOTE, occurredAt: NOW_ISO }, user.id, undefined));
  });

  test('list returns events oldest-first (timeline order)', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);

    const earlier = await recordDriverProgress(trip.id, driver.id,
      { eventType: DriverProgressEventType.DEPARTED, occurredAt: '2026-07-26T08:00:00Z' }, user.id, `timeline-a-${suffix}-${trip.id}`);
    const later = await recordDriverProgress(trip.id, driver.id,
      { eventType: DriverProgressEventType.ARRIVED, occurredAt: '2026-07-26T18:00:00Z' }, user.id, `timeline-b-${suffix}-${trip.id}`);
    createdEventIds.push(earlier.event.id, later.event.id);

    const items = await listDriverProgress(trip.id, driver.id);
    assert.equal(items.length, 2);
    assert.equal(items[0].id, earlier.event.id, 'earlier occurredAt sorts first');
    assert.equal(items[1].id, later.event.id);
  });

  test('LOCKED trip still accepts progress (event is a log, not a state mutation)', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id, { status: 'LOCKED' });

    const { event, replayed } = await recordDriverProgress(trip.id, driver.id,
      { eventType: DriverProgressEventType.NOTE, occurredAt: NOW_ISO, note: 'ghi chú sau chốt' }, user.id, `locked-${suffix}-${trip.id}`);
    createdEventIds.push(event.id);
    assert.equal(replayed, false, 'LOCKED trip accepts a new progress event');
  });

  test('pool-sized unique keyed progress writes all complete without nested-connection starvation', async () => {
    const cat = await mkCatalogs();
    const fixtures = await Promise.all(Array.from({ length: 11 }, async (_value, index) => {
      const actor = await mkUserAndDriver();
      const trip = await mkTrip(actor.driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
      return { ...actor, trip, index };
    }));

    const results = await Promise.race([
      Promise.all(fixtures.map(({ user, driver, trip, index }) => recordDriverProgress(
        trip.id,
        driver.id,
        {
          eventType: DriverProgressEventType.NOTE,
          occurredAt: NOW_ISO,
          note: `pool-${index}`,
        },
        user.id,
        `progress-pool-${suffix}-${index}`,
      ))),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('timed out waiting for keyed driver-progress concurrency')), 8_000);
      }),
    ]);

    assert.equal(results.length, 11);
    for (const result of results) {
      assert.equal(result.replayed, false);
      createdEventIds.push(result.event.id);
    }
  });

  test('forced progress-create failure rolls back both event row and idempotency key', async () => {
    const { user, driver } = await mkUserAndDriver();
    const cat = await mkCatalogs();
    const trip = await mkTrip(driver.id, cat.customer.id, cat.route.id, cat.cargoType.id);
    const idempotencyKey = `progress-rollback-${suffix}`;

    await assert.rejects(
      () => runIdempotent({
        endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PROGRESS,
        idempotencyKey,
        payload: {
          tripId: trip.id,
          driverId: driver.id,
          eventType: DriverProgressEventType.NOTE,
          occurredAt: NOW_ISO,
          note: 'rollback',
        },
        createdBy: user.id,
        entityType: 'driver_progress_event',
        create: async (tx) => {
          await tx.insert(s.driverProgressEvents).values({
            tripId: trip.id,
            driverId: driver.id,
            eventType: DriverProgressEventType.NOTE,
            occurredAt: new Date(NOW_ISO),
            note: 'rollback',
            recordedBy: user.id,
          });
          throw new Error('forced rollback');
        },
        load: async () => {
          throw new Error('load should not be called');
        },
      }),
      /forced rollback/,
    );

    assert.equal(await fetchDriverProgressCount(trip.id, driver.id), 0);
    assert.equal(await fetchDriverProgressIdempotencyCount(idempotencyKey), 0);
  });
});

after(async () => {
  try {
    if (createdEventIds.length > 0) {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.entityId, createdEventIds));
    }
    if (createdEventIds.length > 0) {
      await db.delete(s.driverProgressEvents).where(inArray(s.driverProgressEvents.id, createdEventIds));
    }
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
    console.warn('[m84-driver-progress.test] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
