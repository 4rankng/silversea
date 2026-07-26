/**
 * Wave 4 M8.4 slice 4 — advisory evidence-readiness before completion.
 *
 * Creates trips with/without photos + progress events, exercises
 * getCompletionEvidenceStatus, tears down.
 *
 * Coverage (PRD M08-04-03 §3 resolved as advisory):
 *   - No evidence → not ready, all 3 missing.
 *   - With photo only → still missing DEPARTED + ARRIVED.
 *   - With photo + DEPARTED + ARRIVED → ready.
 *   - Missing field lists correct Vietnamese labels.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { getCompletionEvidenceStatus } from '../services/driver.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdPhotoIds: number[] = [];
const createdEventIds: number[] = [];
const createdTripIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];

let setupCounter = 0;
async function setup() {
  setupCounter += 1;
  const tag = `${suffix}-${setupCounter}`;
  const [u] = await db.insert(s.users).values({
    username: `m84ev-${tag}`, passwordHash: 'x', role: 'DRIVER',
  }).returning();
  createdUserIds.push(u.id);
  const [d] = await db.insert(s.drivers).values({ name: `M84EV ${tag}`, userId: u.id }).returning();
  createdDriverIds.push(d.id);
  const [cust] = await db.insert(s.customers).values({ name: `M84EV cust ${tag}` }).returning();
  createdCustomerIds.push(cust.id);
  const [rt] = await db.insert(s.routes).values({ name: `M84EV route ${tag}` }).returning();
  createdRouteIds.push(rt.id);
  const [ct] = await db.insert(s.cargoTypes).values({ name: `M84EV cargo ${tag}` }).returning();
  createdCargoTypeIds.push(ct.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M84EV-${tag}`.slice(0, 50), driverId: d.id, customerId: cust.id,
    routeId: rt.id, cargoTypeId: ct.id, status: 'IN_TRANSIT',
    departureDate: new Date().toISOString().slice(0, 10),
  }).returning();
  createdTripIds.push(trip.id);
  return { user: u, driver: d, trip };
}

let tc = 0;

describe('M8.4 slice 4 — advisory evidence-readiness', () => {
  test('No evidence → not ready, all 3 missing', async () => {
    const { trip } = await setup();
    tc++;
    const st = await getCompletionEvidenceStatus(trip.id);
    assert.equal(st.ready, false);
    assert.equal(st.missing.length, 3);
    assert.ok(st.missing.includes('Ảnh container/seal'));
    assert.ok(st.missing.includes('Sự kiện xuất phát'));
    assert.ok(st.missing.includes('Sự kiện đến nơi'));
  });

  test('With photo only → still missing DEPARTED + ARRIVED', async () => {
    const { trip, user } = await setup();
    tc++;
    const [photo] = await db.insert(s.tripPhotos).values({
      tripId: trip.id, type: 'CONTAINER', storageKey: 'test/evidence.jpg', uploadedBy: user.id,
    }).returning();
    createdPhotoIds.push(photo.id);
    const st = await getCompletionEvidenceStatus(trip.id);
    assert.equal(st.ready, false);
    assert.equal(st.missing.length, 2);
    assert.ok(!st.missing.includes('Ảnh container/seal'));
  });

  test('With photo + DEPARTED + ARRIVED → ready', async () => {
    const { trip, driver, user } = await setup();
    tc++;
    const [photo] = await db.insert(s.tripPhotos).values({
      tripId: trip.id, type: 'CONTAINER', storageKey: 'test/ready.jpg', uploadedBy: user.id,
    }).returning();
    createdPhotoIds.push(photo.id);
    for (const eventType of ['DEPARTED', 'ARRIVED'] as const) {
      const [ev] = await db.insert(s.driverProgressEvents).values({
        tripId: trip.id, driverId: driver.id, eventType,
        occurredAt: new Date(), recordedBy: user.id,
      }).returning();
      createdEventIds.push(ev.id);
    }
    const st = await getCompletionEvidenceStatus(trip.id);
    assert.equal(st.ready, true);
    assert.deepEqual(st.missing, []);
    assert.equal(st.hasContainerPhotos, true);
    assert.equal(st.hasDepartedEvent, true);
    assert.equal(st.hasArrivedEvent, true);
  });

  test('Missing field lists correct Vietnamese labels', async () => {
    const { trip } = await setup();
    tc++;
    const st = await getCompletionEvidenceStatus(trip.id);
    for (const label of st.missing) {
      assert.ok(label.length > 0 && /[à-ỹÀ-Ỹ]/.test(label), `Vietnamese label: ${label}`);
    }
  });
});

after(async () => {
  try {
    if (createdPhotoIds.length > 0) await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.id, createdPhotoIds));
    if (createdEventIds.length > 0) await db.delete(s.driverProgressEvents).where(inArray(s.driverProgressEvents.id, createdEventIds));
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
    console.warn('[m84-evidence-status.test] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
