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
import { globalErrorHandler } from '../middleware/errorHandler';
import ocrRoutes from '../routes/ocr';
import { uploadRouter } from '../routes/upload';
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

function buildPhotoForm(buffer = imageBuffer, type = 'CONTAINER'): FormData {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), 'photo.jpg');
  form.set('trip_id', String(tripId));
  form.set('type', type);
  return form;
}

async function uploadPhoto(key?: string, buffer = imageBuffer) {
  if (key) idempotencyKeys.push(key);
  const response = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: key ? { 'Idempotency-Key': key } : {},
    body: buildPhotoForm(buffer),
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
  await db.delete(s.tripPhotos).where(eq(s.tripPhotos.tripId, tripId));
  for (const key of storageKeys) {
    await storageService.delete(key).catch(() => undefined);
  }
  await db.delete(s.trips).where(eq(s.trips.id, tripId));
  await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
  await db.delete(s.routes).where(eq(s.routes.id, routeId));
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await db.delete(s.users).where(eq(s.users.id, actorId));
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

  it('replays photo deletion without a second storage or row mutation', async () => {
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
  });
});
