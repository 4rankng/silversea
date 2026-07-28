import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import driverRoutes from '../routes/driver';
import forwarderRoutes, { setForwarderExpensePhotoAfterUploadHookForTest } from '../routes/forwarder';
import ocrRoutes, { setExtractPumpReadingHandlerForTest } from '../routes/ocr';
import { globalErrorHandler } from '../middleware/errorHandler';
import {
  DURABLE_EFFECT_KIND,
  DURABLE_EFFECT_STATUS,
  processDueDurableEffectJobs,
  STORAGE_DELETE_MODE,
} from '../services/durable-effect.service';
import { createTripContainer } from '../services/forwarder-container.service';
import { storageService } from '../services/storage.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];
const storageKeys = new Set<string>();

let adminUserId = 0;
let driverUserId = 0;
let driverId = 0;
let forwarderUserId = 0;
let tripId = 0;
let tripContainerId = 0;
let tripExpenseId = 0;
let customerId = 0;
let shipmentId = 0;
let routeId = 0;
let cargoTypeId = 0;
let server: http.Server;
let baseUrl = '';
let imageBuffer: Buffer;
const originalStorageDelete = storageService.delete.bind(storageService);

async function jsonRequest(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    idempotencyKey?: string;
    expectedUpdatedAt?: string;
  } = {},
) {
  if (options.idempotencyKey) idempotencyKeys.push(options.idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      ...(options.expectedUpdatedAt ? { 'If-Unmodified-Since': options.expectedUpdatedAt } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function multipartRequest(
  path: string,
  form: FormData,
  options: {
    idempotencyKey?: string;
    expectedUpdatedAt?: string;
  } = {},
) {
  if (options.idempotencyKey) idempotencyKeys.push(options.idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      ...(options.expectedUpdatedAt ? { 'If-Unmodified-Since': options.expectedUpdatedAt } : {}),
    },
    body: form,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function seedDriverPhotos(keys: string[]) {
  const rows = [];
  for (const key of keys) {
    storageKeys.add(key);
    await storageService.upload(Buffer.from('driver-photo'), key);
    const [row] = await db.insert(s.tripPhotos).values({
      tripId,
      tripContainerId,
      type: 'CONTAINER',
      storageKey: key,
      uploadedBy: driverUserId,
    }).returning();
    rows.push(row);
  }
  return rows;
}

async function createForwarderExpensePhoto(storageKey: string) {
  storageKeys.add(storageKey);
  await storageService.upload(Buffer.from('forwarder-photo'), storageKey);
  const [row] = await db.insert(s.tripExpensePhotos).values({
    tripExpenseId,
    storageKey,
    uploadedBy: forwarderUserId,
  }).returning();
  return row;
}

async function listStorageDeleteJobs() {
  return db.select().from(s.durableEffectJobs)
    .where(eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE));
}

before(async () => {
  const [admin, driverUser, forwarderUser] = await db.insert(s.users).values([
    {
      username: `q23-field-admin-${suffix}`,
      passwordHash: 'x',
      role: Role.ADMIN,
      status: 'ACTIVE',
    },
    {
      username: `q23-field-driver-${suffix}`,
      passwordHash: 'x',
      role: Role.DRIVER,
      status: 'ACTIVE',
    },
    {
      username: `q23-field-forwarder-${suffix}`,
      passwordHash: 'x',
      role: Role.FORWARDER,
      status: 'ACTIVE',
    },
  ]).returning({ id: s.users.id });
  adminUserId = admin.id;
  driverUserId = driverUser.id;
  forwarderUserId = forwarderUser.id;

  const [driver] = await db.insert(s.drivers).values({
    userId: driverUserId,
    name: `Q23 Driver ${suffix}`,
  }).returning({ id: s.drivers.id });
  driverId = driver.id;

  const [customer] = await db.insert(s.customers).values({
    name: `Q23 Field Customer ${suffix}`,
  }).returning({ id: s.customers.id });
  customerId = customer.id;
  const [route] = await db.insert(s.routes).values({
    name: `Q23 Field Route ${suffix}`,
  }).returning({ id: s.routes.id });
  routeId = route.id;
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q23 Field Cargo ${suffix}`,
  }).returning({ id: s.cargoTypes.id });
  cargoTypeId = cargoType.id;
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `Q23-FIELD-SHP-${suffix}`.slice(0, 50),
    customerId,
    cargoTypeId,
  }).returning({ id: s.shipments.id });
  shipmentId = shipment.id;
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q23-FIELD-${suffix}`,
    shipmentId,
    customerId,
    routeId,
    cargoTypeId,
    driverId,
    departureDate: '2026-07-28',
    status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id });
  tripId = trip.id;

  await db.insert(s.userShipmentLinks).values({
    userId: forwarderUserId,
    shipmentId,
  });

  const container = await createTripContainer({
    tripId,
    containerNumber: 'CONT0000001',
    sealNumber: null,
    notes: 'seed',
    createdBy: adminUserId,
  });
  tripContainerId = container.id;

  const [expense] = await db.insert(s.tripExpenses).values({
    tripId,
    forwarderId: forwarderUserId,
    createdBy: forwarderUserId,
    expenseType: 'OTHER',
    buyAmount: '1000',
    sellAmount: '0',
    note: 'q23 field expense',
  }).returning({ id: s.tripExpenses.id });
  tripExpenseId = expense.id;

  imageBuffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 50, b: 90 } },
  }).jpeg().toBuffer();

  setExtractPumpReadingHandlerForTest(async () => ({
    success: true,
    litres: 50,
    unitPrice: 25000,
    total: 1250000,
    mismatch: false,
    computedTotal: 1250000,
    provider: null,
    model: 'test-model',
    error: null,
  }));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/driver/me')) {
      req.user = {
        userId: driverUserId,
        username: `q23-field-driver-${suffix}`,
        email: null,
        fullName: null,
        role: Role.DRIVER,
      };
    } else if (req.path.startsWith('/api/forwarder/me')) {
      req.user = {
        userId: forwarderUserId,
        username: `q23-field-forwarder-${suffix}`,
        email: null,
        fullName: null,
        role: Role.FORWARDER,
      };
    } else {
      req.user = {
        userId: adminUserId,
        username: `q23-field-admin-${suffix}`,
        email: null,
        fullName: null,
        role: Role.ADMIN,
      };
    }
    next();
  });
  app.use('/api/driver/me', driverRoutes);
  app.use('/api/forwarder/me', forwarderRoutes);
  app.use('/api/ocr', ocrRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  setExtractPumpReadingHandlerForTest(null);
  storageService.delete = originalStorageDelete;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
  }
  await db.delete(s.auditLogs)
    .where(inArray(s.auditLogs.userId, [adminUserId, driverUserId, forwarderUserId]));
  setForwarderExpensePhotoAfterUploadHookForTest(null);
  await db.delete(s.tripExpensePhotos).where(eq(s.tripExpensePhotos.tripExpenseId, tripExpenseId));
  await db.delete(s.tripPhotos).where(eq(s.tripPhotos.tripId, tripId));
  const scopedDurableJobs = (await db.select({
    id: s.durableEffectJobs.id,
    dedupeKey: s.durableEffectJobs.dedupeKey,
    payload: s.durableEffectJobs.payload,
  }).from(s.durableEffectJobs)).filter((row) => {
    const storageKey = typeof (row.payload as Record<string, unknown>).storageKey === 'string'
      ? String((row.payload as Record<string, unknown>).storageKey)
      : null;
    return row.dedupeKey.includes(suffix) || (storageKey !== null && storageKeys.has(storageKey));
  });
  if (scopedDurableJobs.length > 0) {
    await db.delete(s.durableEffectJobs)
      .where(inArray(s.durableEffectJobs.id, scopedDurableJobs.map((row) => row.id)));
  }
  await db.delete(s.tripContainerSeals).where(eq(s.tripContainerSeals.tripContainerId, tripContainerId));
  await db.delete(s.tripContainers).where(eq(s.tripContainers.tripId, tripId));
  await db.delete(s.tripExpenses).where(eq(s.tripExpenses.tripId, tripId));
  await db.delete(s.trips).where(eq(s.trips.id, tripId));
  await db.delete(s.userShipmentLinks).where(eq(s.userShipmentLinks.shipmentId, shipmentId));
  await db.delete(s.shipments).where(eq(s.shipments.id, shipmentId));
  await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
  await db.delete(s.routes).where(eq(s.routes.id, routeId));
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await db.delete(s.drivers).where(eq(s.drivers.id, driverId));
  await db.delete(s.users).where(inArray(s.users.id, [adminUserId, driverUserId, forwarderUserId]));
  for (const key of storageKeys) {
    await storageService.delete(key).catch(() => undefined);
  }
  await disconnectRedis();
  await client.end();
});

describe('Q23 field operations replay boundary', () => {
  it('replays driver container creation and rejects same-key payload drift', async () => {
    const key = `q23-driver-container-create-${suffix}`;
    const first = await jsonRequest(`/api/driver/me/trips/${tripId}/containers`, {
      method: 'POST',
      idempotencyKey: key,
      body: { containerNumber: 'DRV0000001' },
    });
    const replay = await jsonRequest(`/api/driver/me/trips/${tripId}/containers`, {
      method: 'POST',
      idempotencyKey: key,
      body: { containerNumber: 'DRV0000001' },
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual(replay, first);

    const conflict = await jsonRequest(`/api/driver/me/trips/${tripId}/containers`, {
      method: 'POST',
      idempotencyKey: key,
      body: { containerNumber: 'DRV0000002' },
    });
    assert.equal(conflict.status, 409);
  });

  it('replays driver container updates and rejects stale replacements', async () => {
    const [containerBefore] = await db.select({ updatedAt: s.tripContainers.updatedAt })
      .from(s.tripContainers)
      .where(eq(s.tripContainers.id, tripContainerId));
    const missingVersion = await jsonRequest(`/api/driver/me/trips/${tripId}/containers/${tripContainerId}`, {
      method: 'PATCH',
      idempotencyKey: `q23-driver-container-missing-version-${suffix}`,
      body: { notes: 'must-not-write' },
    });
    assert.equal(missingVersion.status, 428);

    const key = `q23-driver-container-update-${suffix}`;
    const first = await jsonRequest(`/api/driver/me/trips/${tripId}/containers/${tripContainerId}`, {
      method: 'PATCH',
      idempotencyKey: key,
      expectedUpdatedAt: containerBefore.updatedAt.toISOString(),
      body: { notes: 'driver-updated' },
    });
    const replay = await jsonRequest(`/api/driver/me/trips/${tripId}/containers/${tripContainerId}`, {
      method: 'PATCH',
      idempotencyKey: key,
      expectedUpdatedAt: containerBefore.updatedAt.toISOString(),
      body: { notes: 'driver-updated' },
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(replay, first);

    const stale = await jsonRequest(`/api/driver/me/trips/${tripId}/containers/${tripContainerId}`, {
      method: 'PATCH',
      idempotencyKey: `q23-driver-container-stale-${suffix}`,
      expectedUpdatedAt: containerBefore.updatedAt.toISOString(),
      body: { notes: 'stale-write' },
    });
    assert.equal(stale.status, 409);

    const [stored] = await db.select({ notes: s.tripContainers.notes })
      .from(s.tripContainers)
      .where(eq(s.tripContainers.id, tripContainerId));
    assert.equal(stored.notes, 'driver-updated');
  });

  it('replays driver seal reconciliation and returns stale conflicts on outdated container versions', async () => {
    const [containerBefore] = await db.select({ updatedAt: s.tripContainers.updatedAt })
      .from(s.tripContainers)
      .where(eq(s.tripContainers.id, tripContainerId));
    const missingVersion = await jsonRequest(`/api/driver/me/trips/${tripId}/containers/${tripContainerId}/seals`, {
      method: 'PUT',
      idempotencyKey: `q23-driver-seals-missing-version-${suffix}`,
      body: { seals: [{ sealNumber: 'SEAL-MUST-NOT-WRITE' }] },
    });
    assert.equal(missingVersion.status, 428);

    const key = `q23-driver-seals-${suffix}`;
    const first = await jsonRequest(`/api/driver/me/trips/${tripId}/containers/${tripContainerId}/seals`, {
      method: 'PUT',
      idempotencyKey: key,
      expectedUpdatedAt: containerBefore.updatedAt.toISOString(),
      body: { seals: [{ sealNumber: 'SEAL-001' }] },
    });
    const replay = await jsonRequest(`/api/driver/me/trips/${tripId}/containers/${tripContainerId}/seals`, {
      method: 'PUT',
      idempotencyKey: key,
      expectedUpdatedAt: containerBefore.updatedAt.toISOString(),
      body: { seals: [{ sealNumber: 'SEAL-001' }] },
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(replay, first);

    const stale = await jsonRequest(`/api/driver/me/trips/${tripId}/containers/${tripContainerId}/seals`, {
      method: 'PUT',
      idempotencyKey: `q23-driver-seals-stale-${suffix}`,
      expectedUpdatedAt: containerBefore.updatedAt.toISOString(),
      body: { seals: [{ sealNumber: 'SEAL-STALE' }] },
    });
    assert.equal(stale.status, 409);
  });

  it('replays driver photo deletion and rejects stale evidence deletes', async () => {
    const seeded = await seedDriverPhotos([
      `driver-photos/${suffix}-1.jpg`,
      `driver-photos/${suffix}-2.jpg`,
    ]);
    const latestUploadedAt = seeded[seeded.length - 1].uploadedAt.toISOString();
    const missingVersion = await jsonRequest(`/api/driver/me/trips/${tripId}/photos/container?container_id=${tripContainerId}`, {
      method: 'DELETE',
      idempotencyKey: `q23-driver-photo-missing-version-${suffix}`,
    });
    assert.equal(missingVersion.status, 428);

    const key = `q23-driver-photo-delete-${suffix}`;
    const first = await jsonRequest(`/api/driver/me/trips/${tripId}/photos/container?container_id=${tripContainerId}`, {
      method: 'DELETE',
      idempotencyKey: key,
      expectedUpdatedAt: latestUploadedAt,
    });
    const replay = await jsonRequest(`/api/driver/me/trips/${tripId}/photos/container?container_id=${tripContainerId}`, {
      method: 'DELETE',
      idempotencyKey: key,
      expectedUpdatedAt: latestUploadedAt,
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(replay, first);
    assert.equal(first.body.removed, 2);

    const stalePhoto = await seedDriverPhotos([`driver-photos/${suffix}-stale-a.jpg`]);
    const staleHeader = new Date(stalePhoto[0].uploadedAt.getTime() - 1).toISOString();
    await seedDriverPhotos([`driver-photos/${suffix}-stale-b.jpg`]);
    const stale = await jsonRequest(`/api/driver/me/trips/${tripId}/photos/container?container_id=${tripContainerId}`, {
      method: 'DELETE',
      idempotencyKey: `q23-driver-photo-stale-${suffix}`,
      expectedUpdatedAt: staleHeader,
    });
    assert.equal(stale.status, 409);
  });

  it('requires the current version on mutable and destructive field writes', async () => {
    const missingDriverVersion = await jsonRequest(`/api/driver/me/trips/${tripId}/containers/${tripContainerId}`, {
      method: 'PATCH',
      idempotencyKey: `q23-driver-missing-version-${suffix}`,
      body: { notes: 'missing-version' },
    });
    assert.equal(missingDriverVersion.status, 428);

    await seedDriverPhotos([`driver-photos/${suffix}-missing-version.jpg`]);
    const missingDriverPhotoVersion = await jsonRequest(`/api/driver/me/trips/${tripId}/photos/container?container_id=${tripContainerId}`, {
      method: 'DELETE',
      idempotencyKey: `q23-driver-photo-missing-version-${suffix}`,
    });
    assert.equal(missingDriverPhotoVersion.status, 428);
  });

  it('replays forwarder expense create/update/delete flows and rejects missing or stale versions', async () => {
    const createKey = `q23-forwarder-expense-create-${suffix}`;
    const createPayload = {
      tripId,
      expenseType: 'OTHER',
      buyAmount: 1500,
      sellAmount: 0,
      expenseDate: '2026-07-28',
      payeeName: 'Bến bãi SilverSea',
      note: 'route-created',
      noInvoiceEvidenceTypes: ['RECEIPT'],
    };
    const created = await jsonRequest('/api/forwarder/me/expenses', {
      method: 'POST',
      idempotencyKey: createKey,
      body: createPayload,
    });
    const createdReplay = await jsonRequest('/api/forwarder/me/expenses', {
      method: 'POST',
      idempotencyKey: createKey,
      body: createPayload,
    });
    const createConflict = await jsonRequest('/api/forwarder/me/expenses', {
      method: 'POST',
      idempotencyKey: createKey,
      body: { ...createPayload, buyAmount: 1600 },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(createdReplay, created);
    assert.equal(createConflict.status, 409);

    const createdExpenseId = Number(created.body.id);
    const [createdExpenseBefore] = await db.select({ updatedAt: s.tripExpenses.updatedAt })
      .from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, createdExpenseId));
    const patchPayload = { note: 'route-updated' };
    const missingPatchVersion = await jsonRequest(`/api/forwarder/me/expenses/${createdExpenseId}`, {
      method: 'PATCH',
      idempotencyKey: `q23-forwarder-expense-patch-missing-${suffix}`,
      body: patchPayload,
    });
    assert.equal(missingPatchVersion.status, 428);

    const patchKey = `q23-forwarder-expense-patch-${suffix}`;
    const patched = await jsonRequest(`/api/forwarder/me/expenses/${createdExpenseId}`, {
      method: 'PATCH',
      idempotencyKey: patchKey,
      expectedUpdatedAt: createdExpenseBefore.updatedAt.toISOString(),
      body: patchPayload,
    });
    const patchedReplay = await jsonRequest(`/api/forwarder/me/expenses/${createdExpenseId}`, {
      method: 'PATCH',
      idempotencyKey: patchKey,
      expectedUpdatedAt: createdExpenseBefore.updatedAt.toISOString(),
      body: patchPayload,
    });
    const patchedStale = await jsonRequest(`/api/forwarder/me/expenses/${createdExpenseId}`, {
      method: 'PATCH',
      idempotencyKey: `q23-forwarder-expense-patch-stale-${suffix}`,
      expectedUpdatedAt: createdExpenseBefore.updatedAt.toISOString(),
      body: { note: 'stale-update' },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.deepEqual(patchedReplay, patched);
    assert.equal(patchedStale.status, 409);

    const missingDeleteVersion = await jsonRequest(`/api/forwarder/me/expenses/${createdExpenseId}`, {
      method: 'DELETE',
      idempotencyKey: `q23-forwarder-expense-delete-missing-${suffix}`,
    });
    assert.equal(missingDeleteVersion.status, 428);

    const [patchedExpense] = await db.select({ updatedAt: s.tripExpenses.updatedAt })
      .from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, createdExpenseId));
    const deleteKey = `q23-forwarder-expense-delete-${suffix}`;
    const deleted = await jsonRequest(`/api/forwarder/me/expenses/${createdExpenseId}`, {
      method: 'DELETE',
      idempotencyKey: deleteKey,
      expectedUpdatedAt: patchedExpense.updatedAt.toISOString(),
    });
    const deletedReplay = await jsonRequest(`/api/forwarder/me/expenses/${createdExpenseId}`, {
      method: 'DELETE',
      idempotencyKey: deleteKey,
      expectedUpdatedAt: patchedExpense.updatedAt.toISOString(),
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.deepEqual(deletedReplay, deleted);

    const [staleExpense] = await db.insert(s.tripExpenses).values({
      tripId,
      forwarderId: forwarderUserId,
      createdBy: forwarderUserId,
      expenseType: 'OTHER',
      buyAmount: '1800',
      sellAmount: '0',
      note: 'stale-delete',
    }).returning({ id: s.tripExpenses.id, updatedAt: s.tripExpenses.updatedAt });
    await db.update(s.tripExpenses)
      .set({ updatedAt: new Date() })
      .where(eq(s.tripExpenses.id, staleExpense.id));
    const staleDelete = await jsonRequest(`/api/forwarder/me/expenses/${staleExpense.id}`, {
      method: 'DELETE',
      idempotencyKey: `q23-forwarder-expense-delete-stale-${suffix}`,
      expectedUpdatedAt: staleExpense.updatedAt.toISOString(),
    });
    assert.equal(staleDelete.status, 409);
  });

  it('replays forwarder expense completion and expense photo create/delete flows', async () => {
    const completionKey = `q23-forwarder-completion-${suffix}`;
    const completion = await jsonRequest(`/api/forwarder/me/trips/${tripId}/expense-completion`, {
      method: 'PUT',
      idempotencyKey: completionKey,
      body: { tripContainerId, completed: true },
    });
    const completionReplay = await jsonRequest(`/api/forwarder/me/trips/${tripId}/expense-completion`, {
      method: 'PUT',
      idempotencyKey: completionKey,
      body: { tripContainerId, completed: true },
    });
    assert.equal(completion.status, 200, JSON.stringify(completion.body));
    assert.deepEqual(completionReplay, completion);

    const photoKey = `q23-forwarder-photo-create-${suffix}`;
    const photoForm = new FormData();
    photoForm.set('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'receipt.jpg');
    const created = await multipartRequest(`/api/forwarder/me/expenses/${tripExpenseId}/photos`, photoForm, {
      idempotencyKey: photoKey,
    });
    const createdReplay = await multipartRequest(`/api/forwarder/me/expenses/${tripExpenseId}/photos`, photoForm, {
      idempotencyKey: photoKey,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(createdReplay, created);
    storageKeys.add(String(created.body.storageKey));

    const changedBuffer = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 10, b: 10 } },
    }).jpeg().toBuffer();
    const changedForm = new FormData();
    changedForm.set('file', new Blob([new Uint8Array(changedBuffer)], { type: 'image/jpeg' }), 'receipt.jpg');
    const createConflict = await multipartRequest(`/api/forwarder/me/expenses/${tripExpenseId}/photos`, changedForm, {
      idempotencyKey: photoKey,
    });
    assert.equal(createConflict.status, 409);

    const createdRow = await createForwarderExpensePhoto(`forwarder-photos/${suffix}-delete.jpg`);
    const missingDeleteVersion = await jsonRequest(`/api/forwarder/me/expense-photos/${createdRow.id}`, {
      method: 'DELETE',
      idempotencyKey: `q23-forwarder-photo-missing-version-${suffix}`,
    });
    assert.equal(missingDeleteVersion.status, 428);

    const deleteKey = `q23-forwarder-photo-delete-${suffix}`;
    const deleted = await jsonRequest(`/api/forwarder/me/expense-photos/${createdRow.id}`, {
      method: 'DELETE',
      idempotencyKey: deleteKey,
      expectedUpdatedAt: createdRow.uploadedAt.toISOString(),
    });
    const deletedReplay = await jsonRequest(`/api/forwarder/me/expense-photos/${createdRow.id}`, {
      method: 'DELETE',
      idempotencyKey: deleteKey,
      expectedUpdatedAt: createdRow.uploadedAt.toISOString(),
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.deepEqual(deletedReplay, deleted);
    const [deleteJob] = (await listStorageDeleteJobs()).filter((row) => {
      const payload = row.payload as Record<string, unknown>;
      return payload.storageKey === createdRow.storageKey
        && payload.mode === STORAGE_DELETE_MODE.FINAL_DELETE;
    });
    assert.ok(deleteJob);
    assert.equal(deleteJob.status, DURABLE_EFFECT_STATUS.PENDING);
    assert.equal(await storageService.exists(createdRow.storageKey), true);
    await db.update(s.durableEffectJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.durableEffectJobs.id, deleteJob.id));

    const deletePass = await processDueDurableEffectJobs(10, {
      now: () => new Date('2026-07-28T10:00:00.000Z'),
    });
    const processedDelete = deletePass.find((job) => job.id === deleteJob.id);
    assert.equal(processedDelete?.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    assert.equal(await storageService.exists(createdRow.storageKey), false);

    const staleRow = await createForwarderExpensePhoto(`forwarder-photos/${suffix}-stale-a.jpg`);
    const staleHeader = new Date(staleRow.uploadedAt.getTime() - 1).toISOString();
    const staleDelete = await jsonRequest(`/api/forwarder/me/expense-photos/${staleRow.id}`, {
      method: 'DELETE',
      idempotencyKey: `q23-forwarder-photo-stale-${suffix}`,
      expectedUpdatedAt: staleHeader,
    });
    assert.equal(staleDelete.status, 409);
  });

  it('cleans uploaded storage when forwarder photo persistence fails after upload', async () => {
    const photoKey = `q23-forwarder-photo-fail-${suffix}`;
    const expectedStorageKey = `expense-photos/${tripExpenseId}/${createHash('sha256')
      .update(`forwarder-expense-photo:${forwarderUserId}:${photoKey}`)
      .digest('hex')
      .slice(0, 32)}.jpg`;
    setForwarderExpensePhotoAfterUploadHookForTest(() => {
      throw new Error('injected expense photo persistence failure');
    });
    try {
      const photoForm = new FormData();
      photoForm.set('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'receipt.jpg');
      const failed = await multipartRequest(`/api/forwarder/me/expenses/${tripExpenseId}/photos`, photoForm, {
        idempotencyKey: photoKey,
      });
      assert.equal(failed.status, 500, JSON.stringify(failed.body));
      storageKeys.add(expectedStorageKey);
      assert.equal(await storageService.exists(expectedStorageKey), true);

      const [cleanupJob] = (await listStorageDeleteJobs()).filter((row) => row.dedupeKey.includes(photoKey));
      assert.ok(cleanupJob);
      assert.equal(cleanupJob.status, DURABLE_EFFECT_STATUS.RETRY);
      assert.equal((cleanupJob.payload as Record<string, unknown>).storageKey, expectedStorageKey);
      assert.equal((cleanupJob.payload as Record<string, unknown>).mode, STORAGE_DELETE_MODE.ORPHAN_GUARD);
      await db.update(s.durableEffectJobs)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(s.durableEffectJobs.id, cleanupJob.id));

      const cleanupPass = await processDueDurableEffectJobs(10, {
        now: () => new Date(Date.now() + 5 * 60_000),
      });
      const processedCleanup = cleanupPass.find((job) => job.id === cleanupJob.id);
      assert.equal(processedCleanup?.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
      assert.equal(await storageService.exists(expectedStorageKey), false);
    } finally {
      setForwarderExpensePhotoAfterUploadHookForTest(null);
      storageService.delete = originalStorageDelete;
    }
  });

  it('requires keys for OCR pump and replays exact bytes while rejecting drift', async () => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'pump.jpg');
    const missingKey = await multipartRequest('/api/ocr/pump', form);
    assert.equal(missingKey.status, 400);

    const key = `q23-ocr-pump-${suffix}`;
    const first = await multipartRequest('/api/ocr/pump', form, { idempotencyKey: key });
    const replay = await multipartRequest('/api/ocr/pump', form, { idempotencyKey: key });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(replay, first);

    const changed = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 3, g: 120, b: 180 } },
    }).jpeg().toBuffer();
    const changedForm = new FormData();
    changedForm.set('file', new Blob([new Uint8Array(changed)], { type: 'image/jpeg' }), 'pump.jpg');
    const conflict = await multipartRequest('/api/ocr/pump', changedForm, { idempotencyKey: key });
    assert.equal(conflict.status, 409);
  });
});
