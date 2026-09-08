import { test, before, after } from 'node:test';
import assert from 'node:assert';
import sharp from 'sharp';
import { db, client } from '../db';
import * as s from '../db/schema';
import { eq, inArray, like } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { persistOcrPhoto } from '../routes/ocr';
import { prepareTripPhoto } from '../routes/upload';
import { storageService } from '../services/storage.service';
import {
  armStorageCleanupGuard,
  releaseStorageCleanupGuard,
} from '../services/durable-effect.service';
import { ApiError } from '../errors';

/**
 * Service-layer tests for `persistOcrPhoto` — the shared persist + link + authz
 * prefix used by both `POST /api/ocr` (capture) and `POST /api/ocr/persist-only`
 * (flush). Follows the `photo-authz.test.ts` idiom: node:test + a real (test) DB
 * + direct service-layer call, seeded + cleaned up by a namespaced marker. No
 * HTTP/supertest harness exists in this repo.
 *
 * These tests pin the authz + container-link behaviour that the new flush route
 * depends on. The recognition-skip guarantee itself is structural (`/persist-only`
 * has zero references to `extractContainerAndSeal`) and is verified by grep +
 * the `[ocr] persist-only-flush` log line, not here.
 */
const NS = 'ocrpersist';

let tripA: number;
let tripB: number;
let containerA: number; // belongs to tripA
let adminId: number;
let driverUserId: number;
let imgBuffer: Buffer;
const createdStorageKeys: string[] = [];
const createdTripIds: number[] = [];

async function runGuardedPersist(input: {
  type: 'CONTAINER' | 'SEAL';
  tripId: number;
  containerId: number | null;
  user: { userId: number; role: Role };
}) {
  const seed = `${NS}:${Date.now()}:${Math.random()}`;
  const preparedPhoto = await prepareTripPhoto(
    { buffer: imgBuffer },
    input.tripId,
    input.type,
    { forOcr: true, containerId: input.containerId, storageKeySeed: seed },
  );
  const cleanupGuard = await armStorageCleanupGuard({
    dedupeKey: `ocr-persist-test:${seed}`,
    storageKey: preparedPhoto.storageKey,
    entityType: 'trip_photos',
    entityId: input.tripId,
  });
  await storageService.upload(preparedPhoto.buffer, preparedPhoto.storageKey);
  try {
    return await db.transaction((tx) => persistOcrPhoto({
      ...input,
      tx,
      preparedPhoto,
      cleanupGuard,
    }));
  } catch (error) {
    await releaseStorageCleanupGuard(cleanupGuard, error);
    await storageService.delete(preparedPhoto.storageKey).catch(() => undefined);
    throw error;
  }
}

async function ensureUser(username: string, role: Role): Promise<number> {
  const existing = await db.select({ id: s.users.id }).from(s.users)
    .where(eq(s.users.username, username)).limit(1);
  if (existing[0]) {
    await db.update(s.users).set({ role }).where(eq(s.users.id, existing[0].id));
    return existing[0].id;
  }
  const [u] = await db.insert(s.users).values({
    username,
    fullName: `QA ${username}`,
    email: `${username}@ocrpersist.test`,
    phone: null,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  return u.id;
}

before(async () => {
  adminId = await ensureUser(`${NS}_admin`, Role.ADMIN);
  driverUserId = await ensureUser(`${NS}_drv`, Role.DRIVER);

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const [customer] = await db.insert(s.customers).values({ name: `${NS} customer ${suffix}` }).returning();
  const [route] = await db.insert(s.routes).values({ name: `${NS} route ${suffix}` }).returning();
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `${NS} cargo ${suffix}` }).returning();
  const made = await db.insert(s.trips).values([0, 1].map(i => ({
    tripCode: `${NS}-${suffix}-${i}`,
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargo.id,
    departureDate: '2026-06-17',
  }))).returning({ id: s.trips.id });
  createdTripIds.push(...made.map(t => t.id));
  tripA = made[0].id;
  tripB = made[1].id;

  // A real drivers row for the test DRIVER. It exists, but no seed trip points
  // at it, so the ownership check finds the driver yet no owned trip → 403.
  // This exercises the FULL ownership check (not just the no-driver-row branch).
  const [drv] = await db.insert(s.drivers).values({
    userId: driverUserId,
    name: `QA ${NS} driver`,
  }).returning({ id: s.drivers.id });
  // The driver record is created only to assert that an unrelated row doesn't
  // accidentally satisfy the new "trip driver" guard.
  void drv;

  // A container row linked to tripA — used for the happy-path link assertion
  // and the cross-trip (container-not-belonging) 400 case.
  const [c] = await db.insert(s.tripContainers).values({
    tripId: tripA,
    containerNumber: 'TEST1234567',
    createdBy: adminId,
  }).returning({ id: s.tripContainers.id });
  containerA = c.id;

  // A real JPEG so saveTripPhoto's sharp pipeline + sniffImageType succeed.
  imgBuffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
  }).jpeg().toBuffer();
});

after(async () => {
  try {
    // Drop the trip_photos rows + on-disk files the happy-path test created
    // (only that path reaches saveTripPhoto; the 403/400 paths throw first).
    for (const key of createdStorageKeys) {
      await db.delete(s.tripPhotos).where(eq(s.tripPhotos.storageKey, key));
      await storageService.delete(key).catch(() => { /* best-effort */ });
    }
    await db.delete(s.durableEffectJobs)
      .where(like(s.durableEffectJobs.dedupeKey, `ocr-persist-test:${NS}%`));
    // trip_photos.tripContainerId is ON DELETE SET NULL, so deleting the
    // container after the photos is safe; order rows → container → driver → users.
    await db.delete(s.tripContainers).where(eq(s.tripContainers.id, containerA));
    if (createdTripIds.length) {
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    const testUsers = await db.select({ id: s.users.id }).from(s.users)
      .where(like(s.users.username, `${NS}_%`));
    if (testUsers.length > 0) {
      await db.delete(s.notifications)
        .where(inArray(s.notifications.userId, testUsers.map((user) => user.id)));
      await db.delete(s.drivers)
        .where(inArray(s.drivers.userId, testUsers.map((user) => user.id)));
    }
    await db.delete(s.users).where(like(s.users.username, `${NS}_%`));
  } catch (err) {
    console.warn('[ocr-persist.test] cleanup failed:', err);
  }
  await client.end();
});

test('persistOcrPhoto: ADMIN persists a CONTAINER photo linked to the container row', async () => {
  const saved = await runGuardedPersist({
    type: 'CONTAINER',
    tripId: tripA,
    containerId: containerA,
    user: { userId: adminId, role: Role.ADMIN },
  });
  createdStorageKeys.push(saved.storageKey);

  assert.ok(saved.photoUrl.startsWith('/api/photos/'), `unexpected photoUrl: ${saved.photoUrl}`);
  assert.ok(saved.storageKey, 'storageKey should be set');
  assert.ok(Buffer.isBuffer(saved.buffer), 'buffer should be returned for recognition reuse');

  const [row] = await db.select({
    tripContainerId: s.tripPhotos.tripContainerId,
    type: s.tripPhotos.type,
    uploadedBy: s.tripPhotos.uploadedBy,
  })
    .from(s.tripPhotos)
    .where(eq(s.tripPhotos.storageKey, saved.storageKey))
    .limit(1);
  assert.ok(row, 'a trip_photos row should have been inserted');
  assert.strictEqual(row!.tripContainerId, containerA, 'photo linked to the container row');
  assert.strictEqual(row!.type, 'CONTAINER');
  assert.strictEqual(row!.uploadedBy, adminId);
});

test('persistOcrPhoto: DRIVER who does not own the trip → ApiError 403', async () => {
  await assert.rejects(
    () => runGuardedPersist({
      type: 'CONTAINER',
      tripId: tripA,
      containerId: containerA,
      user: { userId: driverUserId, role: Role.DRIVER },
    }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, `expected ApiError, got ${err?.constructor?.name}`);
      assert.strictEqual((err as ApiError).statusCode, 403);
      return true;
    },
  );
});

test('persistOcrPhoto: container not belonging to trip → ApiError 400', async () => {
  // containerA belongs to tripA; call with tripB. ADMIN bypasses ownership, so
  // the only check that can fire is container-belongs-to-trip.
  await assert.rejects(
    () => runGuardedPersist({
      type: 'SEAL',
      tripId: tripB,
      containerId: containerA,
      user: { userId: adminId, role: Role.ADMIN },
    }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, `expected ApiError, got ${err?.constructor?.name}`);
      assert.strictEqual((err as ApiError).statusCode, 400);
      return true;
    },
  );
});
