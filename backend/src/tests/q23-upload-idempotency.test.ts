import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import sharp from 'sharp';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import ocrRoutes from '../routes/ocr';
import { setTripPhotoAfterUploadHookForTest, uploadRouter } from '../routes/upload';
import {
  DURABLE_EFFECT_KIND,
  DURABLE_EFFECT_STATUS,
  processDueDurableEffectJobs,
  STORAGE_DELETE_MODE,
} from '../services/durable-effect.service';
import { IDEMPOTENCY_ENDPOINTS } from '../services/idempotency.service';
import { storageService } from '../services/storage.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];
const storageKeys: string[] = [];
let actorId = 0;
let tripId = 0;
let customerId = 0;
let routeId = 0;
let cargoTypeId = 0;
let imageBuffer: Buffer;
let server: http.Server;
let baseUrl = '';
const originalStorageDelete = storageService.delete.bind(storageService);

function buildPhotoForm(
  buffer = imageBuffer,
  type = 'CONTAINER',
  filename = 'photo.jpg',
  mimeType = 'image/jpeg',
): FormData {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
  form.set('trip_id', String(tripId));
  form.set('type', type);
  return form;
}

async function uploadPhoto(
  key?: string,
  buffer = imageBuffer,
  options: { filename?: string; mimeType?: string } = {},
) {
  if (key) idempotencyKeys.push(key);
  const response = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: key ? { 'Idempotency-Key': key } : {},
    body: buildPhotoForm(
      buffer,
      'CONTAINER',
      options.filename ?? 'photo.jpg',
      options.mimeType ?? 'image/jpeg',
    ),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function uploadCompanyLogo(key: string, buffer = imageBuffer) {
  idempotencyKeys.push(key);
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), 'logo.jpg');
  const response = await fetch(`${baseUrl}/api/upload/company-logo`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: form,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function persistOcrPhoto(key: string, buffer = imageBuffer) {
  idempotencyKeys.push(key);
  const form = buildPhotoForm(buffer);
  const response = await fetch(`${baseUrl}/api/ocr/persist-only`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: form,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function deletePhoto(storageKey: string, key: string) {
  idempotencyKeys.push(key);
  const response = await fetch(`${baseUrl}/api/upload/trips/${tripId}/photos/container/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ storage_key: storageKey }),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function listStorageDeleteJobs() {
  return db.select().from(s.durableEffectJobs)
    .where(eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE));
}

before(async () => {
  const [actor] = await db.insert(s.users).values({
    username: `q23-upload-${suffix}`,
    passwordHash: 'x',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  actorId = actor.id;

  const [customer] = await db.insert(s.customers).values({
    name: `Q23 upload customer ${suffix}`,
  }).returning({ id: s.customers.id });
  customerId = customer.id;
  const [route] = await db.insert(s.routes).values({
    name: `Q23 upload route ${suffix}`,
  }).returning({ id: s.routes.id });
  routeId = route.id;
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q23 upload cargo ${suffix}`,
  }).returning({ id: s.cargoTypes.id });
  cargoTypeId = cargoType.id;
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q23-UPLOAD-${suffix}`,
    customerId,
    routeId,
    cargoTypeId,
    departureDate: '2026-07-28',
  }).returning({ id: s.trips.id });
  tripId = trip.id;

  imageBuffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 8, g: 23, b: 42 } },
  }).jpeg().toBuffer();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      userId: actorId,
      username: `q23-upload-${suffix}`,
      email: null,
      fullName: null,
      role: Role.ADMIN,
    };
    next();
  });
  app.use(auditLogMiddleware);
  app.use('/api/upload', uploadRouter);
  app.use('/api/ocr', ocrRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
  }
  await db.delete(s.auditLogs).where(eq(s.auditLogs.userId, actorId));
  await db.delete(s.tripPhotos).where(eq(s.tripPhotos.tripId, tripId));
  const scopedDurableJobs = (await db.select({
    id: s.durableEffectJobs.id,
    dedupeKey: s.durableEffectJobs.dedupeKey,
    payload: s.durableEffectJobs.payload,
  }).from(s.durableEffectJobs)).filter((row) => {
    const storageKey = typeof (row.payload as Record<string, unknown>).storageKey === 'string'
      ? String((row.payload as Record<string, unknown>).storageKey)
      : null;
    return row.dedupeKey.includes(suffix) || (storageKey !== null && storageKeys.includes(storageKey));
  });
  if (scopedDurableJobs.length > 0) {
    await db.delete(s.durableEffectJobs)
      .where(inArray(s.durableEffectJobs.id, scopedDurableJobs.map((row) => row.id)));
  }
  for (const key of storageKeys) {
    await storageService.delete(key).catch(() => undefined);
  }
  await db.delete(s.trips).where(eq(s.trips.id, tripId));
  await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
  await db.delete(s.routes).where(eq(s.routes.id, routeId));
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await db.delete(s.users).where(eq(s.users.id, actorId));
  storageService.delete = originalStorageDelete;
  setTripPhotoAfterUploadHookForTest(null);
  await disconnectRedis();
  await client.end();
});

describe('Q23 operational evidence replay', () => {
  it('requires a transaction key before storing a trip photo', async () => {
    const response = await uploadPhoto();
    assert.equal(response.status, 400);
    assert.match(String(response.body.error ?? ''), /Idempotency-Key/);
  });

  it('replays one trip-photo object and rejects changed content under the same key', async () => {
    const key = `q23-upload-create-${suffix}`;
    const [first, replay] = await Promise.all([
      uploadPhoto(key),
      uploadPhoto(key),
    ]);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual(replay, first);

    const storageKey = String(first.body.storageKey);
    storageKeys.push(storageKey);
    const rows = await db.select({ storageKey: s.tripPhotos.storageKey })
      .from(s.tripPhotos)
      .where(eq(s.tripPhotos.storageKey, storageKey));
    assert.equal(rows.length, 1);
    const [idempotencyRow] = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, key));
    assert.equal(idempotencyRow.responseStatusCode, 201);
    const auditRows = await db.select().from(s.auditLogs)
      .where(eq(s.auditLogs.userId, actorId));
    const durableAudit = auditRows.find((row) => {
      const payload = row.payload as Record<string, unknown>;
      return payload.materialWriteEndpoint === IDEMPOTENCY_ENDPOINTS.UPLOAD_TRIP_PHOTO
        && payload.statusCode === 201
        && payload.outcome === 'SUCCEEDED';
    });
    assert.ok(durableAudit);

    const changedBuffer = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 10, b: 10 } },
    }).jpeg().toBuffer();
    const conflict = await uploadPhoto(key, changedBuffer);
    assert.equal(conflict.status, 409);
  });

  it('replays company-logo storage and rejects changed bytes under the same key', async () => {
    const key = `q23-upload-logo-${suffix}`;
    const first = await uploadCompanyLogo(key);
    const replay = await uploadCompanyLogo(key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual(replay, first);
    const storageKey = String(first.body.storageKey);
    storageKeys.push(storageKey);
    const [idempotencyRow] = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, key));
    assert.equal(idempotencyRow.responseStatusCode, 201);
    const auditRows = await db.select().from(s.auditLogs)
      .where(eq(s.auditLogs.userId, actorId));
    const durableAudit = auditRows.find((row) => {
      const payload = row.payload as Record<string, unknown>;
      return payload.materialWriteEndpoint === IDEMPOTENCY_ENDPOINTS.UPLOAD_COMPANY_LOGO
        && payload.statusCode === 201
        && payload.outcome === 'SUCCEEDED';
    });
    assert.ok(durableAudit);

    const changedBuffer = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 11, g: 190, b: 45 } },
    }).jpeg().toBuffer();
    const conflict = await uploadCompanyLogo(key, changedBuffer);
    assert.equal(conflict.status, 409);
  });

  it('replays OCR persist-only without inserting a second photo row', async () => {
    const key = `q23-ocr-persist-${suffix}`;
    const first = await persistOcrPhoto(key);
    const replay = await persistOcrPhoto(key);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(replay, first);

    const storageKey = String(first.body.storageKey);
    storageKeys.push(storageKey);
    const rows = await db.select({ storageKey: s.tripPhotos.storageKey })
      .from(s.tripPhotos)
      .where(eq(s.tripPhotos.storageKey, storageKey));
    assert.equal(rows.length, 1);
  });

  it('keeps separate orphan guards when the same request key leaks a .png and then a .jpg before cleanup runs', async () => {
    const key = `q23-upload-leak-png-jpg-${suffix}`;
    const pngBuffer = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 14, g: 140, b: 220 } },
    }).png().toBuffer();

    setTripPhotoAfterUploadHookForTest(() => {
      throw new Error('simulated trip-photo crash after upload');
    });
    try {
      const first = await uploadPhoto(key, pngBuffer, { filename: 'photo.png', mimeType: 'image/png' });
      const second = await uploadPhoto(key, imageBuffer, { filename: 'photo.jpg', mimeType: 'image/jpeg' });
      assert.equal(first.status, 500, JSON.stringify(first.body));
      assert.equal(second.status, 500, JSON.stringify(second.body));
    } finally {
      setTripPhotoAfterUploadHookForTest(null);
    }

    const leakedJobs = (await listStorageDeleteJobs()).filter((row) => row.dedupeKey.includes(key));
    assert.equal(leakedJobs.length, 2);

    const leakedStorageKeys = leakedJobs.map((row) => String((row.payload as Record<string, unknown>).storageKey));
    storageKeys.push(...leakedStorageKeys);
    assert.equal(new Set(leakedStorageKeys).size, 2);
    assert.ok(leakedStorageKeys.some((value) => value.endsWith('.png')));
    assert.ok(leakedStorageKeys.some((value) => value.endsWith('.jpg')));
    for (const row of leakedJobs) {
      assert.equal(row.status, DURABLE_EFFECT_STATUS.RETRY);
      assert.equal((row.payload as Record<string, unknown>).mode, STORAGE_DELETE_MODE.ORPHAN_GUARD);
    }
    for (const storageKey of leakedStorageKeys) {
      assert.equal(await storageService.exists(storageKey), true);
    }

    const processed = await processDueDurableEffectJobs(10, {
      now: () => new Date(Date.now() + 60_000),
    });
    for (const row of leakedJobs) {
      const processedRow = processed.find((job) => job.id === row.id);
      assert.equal(processedRow?.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    }
    for (const storageKey of leakedStorageKeys) {
      assert.equal(await storageService.exists(storageKey), false);
    }
  });

  it('retries the same trip-photo request after worker cleanup and converges on one committed row', async () => {
    const key = `q23-upload-recover-after-worker-${suffix}`;
    setTripPhotoAfterUploadHookForTest(() => {
      throw new Error('simulated trip-photo crash after upload');
    });
    try {
      const failed = await uploadPhoto(key);
      assert.equal(failed.status, 500, JSON.stringify(failed.body));
    } finally {
      setTripPhotoAfterUploadHookForTest(null);
    }

    const [failedJob] = (await listStorageDeleteJobs()).filter((row) => row.dedupeKey.includes(key));
    assert.ok(failedJob);
    const failedStorageKey = String((failedJob.payload as Record<string, unknown>).storageKey);
    storageKeys.push(failedStorageKey);
    assert.equal(failedJob.status, DURABLE_EFFECT_STATUS.RETRY);
    assert.equal(await storageService.exists(failedStorageKey), true);

    const firstWorkerPass = await processDueDurableEffectJobs(10, {
      now: () => new Date(Date.now() + 60_000),
    });
    const cleanedJob = firstWorkerPass.find((job) => job.id === failedJob.id);
    assert.equal(cleanedJob?.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    assert.equal(await storageService.exists(failedStorageKey), false);

    const retry = await uploadPhoto(key);
    const replay = await uploadPhoto(key);
    assert.equal(retry.status, 201, JSON.stringify(retry.body));
    assert.deepEqual(replay, retry);
    assert.equal(String(retry.body.storageKey), failedStorageKey);

    const rows = await db.select({ id: s.tripPhotos.id })
      .from(s.tripPhotos)
      .where(eq(s.tripPhotos.storageKey, failedStorageKey));
    assert.equal(rows.length, 1);
    const [idempotencyRow] = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, key));
    assert.equal(idempotencyRow.responseStatusCode, 201);

    const [reusedGuard] = await db.select().from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.id, failedJob.id));
    assert.equal(reusedGuard?.status, DURABLE_EFFECT_STATUS.CANCELLED);
  });

  it('replays photo deletion and leaves final storage removal to the durable worker', async () => {
    const create = await uploadPhoto(`q23-upload-delete-seed-${suffix}`);
    assert.equal(create.status, 201, JSON.stringify(create.body));
    const storageKey = String(create.body.storageKey);
    storageKeys.push(storageKey);

    const key = `q23-upload-delete-${suffix}`;
    const first = await deletePhoto(storageKey, key);
    const replay = await deletePhoto(storageKey, key);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(replay, first);
    assert.equal(first.body.removed, 1);

    const rows = await db.select({ id: s.tripPhotos.id })
      .from(s.tripPhotos)
      .where(eq(s.tripPhotos.storageKey, storageKey));
    assert.equal(rows.length, 0);

    const [deleteJob] = (await listStorageDeleteJobs()).filter((row) => {
      const payload = row.payload as Record<string, unknown>;
      return payload.storageKey === storageKey && payload.mode === STORAGE_DELETE_MODE.FINAL_DELETE;
    });
    assert.ok(deleteJob);
    assert.equal(deleteJob.status, DURABLE_EFFECT_STATUS.PENDING);
    assert.equal(await storageService.exists(storageKey), true);

    const processed = await processDueDurableEffectJobs(10, {
      now: () => new Date(Date.now() + 60_000),
    });
    const processedDelete = processed.find((job) => job.id === deleteJob.id);
    assert.equal(processedDelete?.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    assert.equal(await storageService.exists(storageKey), false);
  });
});
