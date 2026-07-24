import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { TripStatus } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { transitionTripStatus } from '../services/trip-status-machine.service';

/**
 * Photo evidence gate on LOCK — Bug 2.
 *
 * `transitionTripStatus(..., LOCKED)` requires:
 *   - baseline: ≥1 photo of any type, AND
 *   - if the trip's cargo type has requires_photos=true: additionally ≥1
 *     CONTAINER and ≥1 SEAL photo.
 * confirmNoPhoto:true overrides both. Completion stays permissive (the gate
 * lives only on the LOCK transition).
 *
 * Pattern mirrors ledger.service.chiho.test.ts: real Postgres, insert rows
 * directly, drive transitions through the status machine, clean up in `after`.
 */

const createdTripIds: number[] = [];
const createdPhotoIds: number[] = [];
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];

after(async () => {
  // Ledger rows for a trip are keyed by txnId=tripId (TRIP_REVENUE etc.).
  if (createdTripIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, createdTripIds));
  }
  if (createdPhotoIds.length > 0) {
    await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.id, createdPhotoIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
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
  await client.end();
});

interface SetupOptions {
  /** cargoTypes.requires_photos — default false (baseline gate only). */
  requiresPhotos?: boolean;
}

/**
 * Creates admin user + customer + route + cargoType + a COMPLETED trip with
 * revenue 5,000,000 (passes the zero-revenue guard). Returns all rows so the
 * caller can add photos and drive the lock transition.
 */
async function setupTrip(opts: SetupOptions = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [admin] = await db.insert(s.users).values({
    username: `photo-admin-${suffix}`.slice(0, 50),
    passwordHash: 'x',
    fullName: `PhotoGate admin ${suffix}`,
    role: 'ADMIN',
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(admin.id);

  const [customer] = await db.insert(s.customers)
    .values({ name: `PhotoGate customer ${suffix}` }).returning();
  const [route] = await db.insert(s.routes)
    .values({ name: `PhotoGate route ${suffix}` }).returning();
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `PhotoGate cargo ${suffix}`,
    requiresPhotos: opts.requiresPhotos ?? false,
  }).returning();
  createdCustomerIds.push(customer.id);
  createdRouteIds.push(route.id);
  createdCargoTypeIds.push(cargoType.id);

  const [trip] = await db.insert(s.trips).values({
    tripCode: `PG-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: TripStatus.COMPLETED,
    departureDate: '2026-06-20',
    revenue: '5000000',
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);

  return { admin, customer, route, cargoType, trip };
}

async function insertPhoto(tripId: number, uploadedBy: number, type: 'CONTAINER' | 'SEAL' | 'OTHER') {
  const [photo] = await db.insert(s.tripPhotos).values({
    tripId,
    type,
    storageKey: `test-photos/${tripId}-${type}-${Date.now()}.jpg`,
    uploadedBy,
  }).returning();
  createdPhotoIds.push(photo.id);
  return photo;
}

async function reloadTripStatus(tripId: number): Promise<TripStatus> {
  const [row] = await db.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  return row.status as TripStatus;
}

describe('LOCK photo-evidence gate', () => {
  test('rejects locking a COMPLETED trip with zero photos (baseline)', async () => {
    const { admin, trip } = await setupTrip();
    await assert.rejects(
      () => transitionTripStatus(trip.id, TripStatus.LOCKED, admin.id, 'ADMIN', false, false),
      /ảnh bằng chứng/,
    );
  });

  test('one OTHER photo satisfies the baseline gate when cargoType.requires_photos=false', async () => {
    const { admin, trip } = await setupTrip({ requiresPhotos: false });
    await insertPhoto(trip.id, admin.id, 'OTHER');

    await transitionTripStatus(trip.id, TripStatus.LOCKED, admin.id, 'ADMIN', false, false);

    assert.equal(await reloadTripStatus(trip.id), TripStatus.LOCKED);
  });

  test('confirmNoPhoto=true overrides the baseline zero-photo gate', async () => {
    const { admin, trip } = await setupTrip({ requiresPhotos: false });
    // No photos inserted.

    await transitionTripStatus(trip.id, TripStatus.LOCKED, admin.id, 'ADMIN', false, true);

    assert.equal(await reloadTripStatus(trip.id), TripStatus.LOCKED);
  });

  test('requires_photos cargo type with only an OTHER photo rejects with CONTAINER/SEAL message', async () => {
    const { admin, trip } = await setupTrip({ requiresPhotos: true });
    await insertPhoto(trip.id, admin.id, 'OTHER');

    await assert.rejects(
      () => transitionTripStatus(trip.id, TripStatus.LOCKED, admin.id, 'ADMIN', false, false),
      /CONTAINER.*SEAL/,
    );
  });
});
