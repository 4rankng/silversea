import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import sharp from 'sharp';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis, getRedis } from '../lib/redis';
import { OCR_RATE_LIMIT_KEY } from '../services/ocr-rate-limiter';
import { OCR_SETTING_KEYS, invalidateOcrSettings } from '../services/ocr-settings.service';
import { encryptSecret } from '../services/crypto';
import driverRoutes, { setDriverFuelEvidenceAfterUploadHookForTest } from '../routes/driver';
import forwarderRoutes, { setForwarderExpensePhotoAfterUploadHookForTest } from '../routes/forwarder';
import ocrRoutes, { setExtractPumpReadingHandlerForTest } from '../routes/ocr';
import { photosRouter } from '../routes/upload';
import { globalErrorHandler } from '../middleware/errorHandler';
import {
  DURABLE_EFFECT_KIND,
  DURABLE_EFFECT_STATUS,
  processDueDurableEffectJobs,
  STORAGE_DELETE_MODE,
} from '../services/durable-effect.service';
import { createTripContainer } from '../services/forwarder-container.service';
import { setFuelEvidencePumpReadingHandlerForTest } from '../services/fuel-evidence-review.service';
import { storageService } from '../services/storage.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];
const storageKeys = new Set<string>();

let adminUserId = 0;
let previousOcrKeyRowRef: typeof s.appSettings.$inferSelect | null = null;
let driverUserId = 0;
let driverId = 0;
let otherDriverUserId = 0;
let otherDriverId = 0;
let forwarderUserId = 0;
let managerUserId = 0;
let tripId = 0;
let tripContainerId = 0;
let tripExpenseId = 0;
let customerId = 0;
let shipmentId = 0;
let routeId = 0;
let cargoTypeId = 0;
let liftPortId = 0;
let liftContainerTypeId = 0;
let truckId = 0;
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
    actor?: 'driver-owner' | 'driver-other' | 'forwarder' | 'accountant' | 'admin' | 'manager';
  } = {},
) {
  if (options.idempotencyKey) idempotencyKeys.push(options.idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      ...(options.expectedUpdatedAt ? { 'If-Unmodified-Since': options.expectedUpdatedAt } : {}),
      ...(options.actor ? { 'X-Test-Actor': options.actor } : {}),
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
    actor?: 'driver-owner' | 'driver-other' | 'forwarder' | 'accountant' | 'admin' | 'manager';
  } = {},
) {
  if (options.idempotencyKey) idempotencyKeys.push(options.idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      ...(options.expectedUpdatedAt ? { 'If-Unmodified-Since': options.expectedUpdatedAt } : {}),
      ...(options.actor ? { 'X-Test-Actor': options.actor } : {}),
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

async function createForwarderExpensePhoto(storageKey: string, expenseId = tripExpenseId) {
  storageKeys.add(storageKey);
  await storageService.upload(Buffer.from('forwarder-photo'), storageKey);
  const [row] = await db.insert(s.tripExpensePhotos).values({
    tripExpenseId: expenseId,
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
  // The dev DB may hold an `ocr.openrouter_api_key` row encrypted with a
  // rotated/legacy key — re-write it with the CURRENT key so the pump test
  // exercises replay, not decryption drift. Restored in `after`.
  const [previousOcrKeyRow] = await db.select()
    .from(s.appSettings)
    .where(eq(s.appSettings.key, OCR_SETTING_KEYS.openrouterApiKey))
    .limit(1);
  previousOcrKeyRowRef = previousOcrKeyRow ?? null;
  await db.insert(s.appSettings).values({
    key: OCR_SETTING_KEYS.openrouterApiKey,
    value: encryptSecret('test-openrouter-key'),
  }).onConflictDoUpdate({
    target: s.appSettings.key,
    set: { value: encryptSecret('test-openrouter-key') },
  });
  await db.insert(s.appSettings).values({
    key: OCR_SETTING_KEYS.enabled,
    value: 'true',
  }).onConflictDoUpdate({
    target: s.appSettings.key,
    set: { value: 'true' },
  });
  invalidateOcrSettings();

  const [admin, driverUser, otherDriverUser, forwarderUser, managerUser] = await db.insert(s.users).values([
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
      username: `q23-field-driver-other-${suffix}`,
      passwordHash: 'x',
      role: Role.DRIVER,
      status: 'ACTIVE',
    },
    {
      username: `q23-field-forwarder-${suffix}`,
      passwordHash: 'x',
      role: Role.OPS,
      status: 'ACTIVE',
    },
    {
      username: `q23-field-manager-${suffix}`,
      passwordHash: 'x',
      role: Role.MANAGER,
      status: 'ACTIVE',
    },
  ]).returning({ id: s.users.id });
  adminUserId = admin.id;
  driverUserId = driverUser.id;
  otherDriverUserId = otherDriverUser.id;
  forwarderUserId = forwarderUser.id;
  managerUserId = managerUser.id;

  const [driver, otherDriver] = await db.insert(s.drivers).values([
    {
      userId: driverUserId,
      name: `Q23 Driver ${suffix}`,
    },
    {
      userId: otherDriverUserId,
      name: `Q23 Driver Other ${suffix}`,
    },
  ]).returning({ id: s.drivers.id });
  driverId = driver.id;
  otherDriverId = otherDriver.id;

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
  const [liftContainerType] = await db.insert(s.containerTypes).values({
    code: `Q23-${suffix}`.slice(0, 20),
    name: `Q23 Lift ${suffix}`.slice(0, 50),
  }).returning({ id: s.containerTypes.id });
  liftContainerTypeId = liftContainerType.id;
  const [liftPort] = await db.insert(s.ports).values({
    name: `Q23 Lift Port ${suffix}`,
    code: `Q23P${Date.now()}`.slice(0, 20),
  }).returning({ id: s.ports.id });
  liftPortId = liftPort.id;
  await db.insert(s.liftPricing).values([
    {
      portId: liftPortId,
      containerTypeId: liftContainerTypeId,
      direction: 'LIFT_UP',
      loadState: 'LOADED',
      unitPrice: '120000',
      effectiveDate: '2026-01-01',
    },
    {
      portId: liftPortId,
      containerTypeId: liftContainerTypeId,
      direction: 'LIFT_DOWN',
      loadState: 'LOADED',
      unitPrice: '140000',
      effectiveDate: '2026-01-01',
    },
  ]);
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `Q23-FIELD-SHP-${suffix}`.slice(0, 50),
    customerId,
    cargoTypeId,
    status: 'READY_FOR_DISPATCH',
  }).returning({ id: s.shipments.id });
  shipmentId = shipment.id;
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `Q23-${Date.now()}`.slice(0, 20),
  }).returning({ id: s.trucks.id });
  truckId = truck.id;
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q23-FIELD-${suffix}`,
    shipmentId,
    customerId,
    routeId,
    cargoTypeId,
    driverId,
    truckId,
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
    containerTypeId: liftContainerTypeId,
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
    outcome: 'ACCEPTED',
    litres: 50,
    unitPrice: 25000,
    total: 1250000,
    mismatch: false,
    computedTotal: 1250000,
    provider: null,
    model: 'test-model',
    error: null,
  }));
  setFuelEvidencePumpReadingHandlerForTest(async () => ({
    success: true,
    outcome: 'ACCEPTED',
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
    const actor = req.header('X-Test-Actor');
    if (actor === 'driver-owner') {
      req.user = {
        userId: driverUserId,
        username: `q23-field-driver-${suffix}`,
        email: null,
        fullName: null,
        role: Role.DRIVER,
      };
    } else if (actor === 'driver-other') {
      req.user = {
        userId: otherDriverUserId,
        username: `q23-field-driver-other-${suffix}`,
        email: null,
        fullName: null,
        role: Role.DRIVER,
      };
    } else if (actor === 'accountant') {
      req.user = {
        userId: adminUserId,
        username: `q23-field-accountant-${suffix}`,
        email: null,
        fullName: null,
        role: Role.ACCOUNTANT,
      };
    } else if (actor === 'manager') {
      req.user = {
        userId: managerUserId,
        username: `q23-field-manager-${suffix}`,
        email: null,
        fullName: null,
        role: Role.MANAGER,
      };
    } else if (req.path.startsWith('/api/driver/me')) {
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
        role: Role.OPS,
      };
    } else if (req.path.startsWith('/api/ocr')) {
      req.user = {
        userId: adminUserId,
        username: `q23-field-accountant-${suffix}`,
        email: null,
        fullName: null,
        role: Role.ACCOUNTANT,
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
  app.use('/api/photos', photosRouter);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  setExtractPumpReadingHandlerForTest(null);
  setFuelEvidencePumpReadingHandlerForTest(null);
  setDriverFuelEvidenceAfterUploadHookForTest(null);
  // Restore whatever OCR key row the dev DB held before this test.
  if (previousOcrKeyRowRef) {
    await db.insert(s.appSettings).values(previousOcrKeyRowRef).onConflictDoUpdate({
      target: s.appSettings.key,
      set: { value: previousOcrKeyRowRef.value },
    });
  } else {
    await db.delete(s.appSettings).where(eq(s.appSettings.key, OCR_SETTING_KEYS.openrouterApiKey));
  }
  invalidateOcrSettings();
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
    .where(inArray(s.auditLogs.userId, [adminUserId, driverUserId, otherDriverUserId, forwarderUserId, managerUserId]));
  setForwarderExpensePhotoAfterUploadHookForTest(null);
  await db.delete(s.fuelEvidenceReviews).where(eq(s.fuelEvidenceReviews.tripId, tripId));
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
  await db.delete(s.liftPricing).where(eq(s.liftPricing.portId, liftPortId));
  await db.delete(s.trips).where(eq(s.trips.id, tripId));
  await db.delete(s.trucks).where(eq(s.trucks.id, truckId));
  await db.delete(s.userShipmentLinks).where(eq(s.userShipmentLinks.shipmentId, shipmentId));
  await db.delete(s.shipments).where(eq(s.shipments.id, shipmentId));
  await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
  await db.delete(s.ports).where(eq(s.ports.id, liftPortId));
  await db.delete(s.containerTypes).where(eq(s.containerTypes.id, liftContainerTypeId));
  await db.delete(s.routes).where(eq(s.routes.id, routeId));
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await db.delete(s.drivers).where(inArray(s.drivers.id, [driverId, otherDriverId]));
  await db.delete(s.users).where(inArray(s.users.id, [adminUserId, driverUserId, otherDriverUserId, forwarderUserId, managerUserId]));
  for (const key of storageKeys) {
    await storageService.delete(key).catch(() => undefined);
  }
  await disconnectRedis();
  await client.end();
});

describe('Q23 field operations replay boundary', () => {
  it('persists the parallel order-exchange workflow and gates original-order handoff', async () => {
    const [initial] = await db.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, shipmentId));
    const startKey = `q23-order-exchange-start-${suffix}`;
    const started = await jsonRequest(`/api/forwarder/me/shipments/${shipmentId}/order-exchange/start`, {
      method: 'POST', idempotencyKey: startKey, body: { expectedVersion: initial.version },
    });
    const startedReplay = await jsonRequest(`/api/forwarder/me/shipments/${shipmentId}/order-exchange/start`, {
      method: 'POST', idempotencyKey: startKey, body: { expectedVersion: initial.version },
    });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.deepEqual(startedReplay, started);

    const [tripBefore] = await db.select({ version: s.trips.version }).from(s.trips).where(eq(s.trips.id, tripId));
    const earlyHandoff = await jsonRequest(`/api/forwarder/me/trips/${tripId}/paper-order-collection`, {
      method: 'POST',
      idempotencyKey: `q23-paper-order-early-${suffix}`,
      body: { expectedVersion: tripBefore.version },
    });
    assert.equal(earlyHandoff.status, 409);

    const completeKey = `q23-order-exchange-complete-${suffix}`;
    const completed = await jsonRequest(`/api/forwarder/me/shipments/${shipmentId}/order-exchange/complete`, {
      method: 'POST', idempotencyKey: completeKey, body: { expectedVersion: Number(started.body.version) },
    });
    const completedReplay = await jsonRequest(`/api/forwarder/me/shipments/${shipmentId}/order-exchange/complete`, {
      method: 'POST', idempotencyKey: completeKey, body: { expectedVersion: Number(started.body.version) },
    });
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    assert.deepEqual(completedReplay, completed);

    const handoffKey = `q23-paper-order-after-exchange-${suffix}`;
    const handoff = await jsonRequest(`/api/forwarder/me/trips/${tripId}/paper-order-collection`, {
      method: 'POST', idempotencyKey: handoffKey, body: { expectedVersion: tripBefore.version },
    });
    const handoffReplay = await jsonRequest(`/api/forwarder/me/trips/${tripId}/paper-order-collection`, {
      method: 'POST', idempotencyKey: handoffKey, body: { expectedVersion: tripBefore.version },
    });
    assert.equal(handoff.status, 200, JSON.stringify(handoff.body));
    assert.deepEqual(handoffReplay, handoff);

    const [shipmentBeforeLock] = await db.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, shipmentId));
    const [billingDocument] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customerId,
      entityName: `Q23 Customer ${suffix}`,
      rangeFrom: '2026-08-01',
      rangeTo: '2026-08-31',
      totalInclVat: '0',
      debitNoteStatus: 'SENT',
      issuedAt: new Date(),
      createdBy: adminUserId,
    }).returning();
    await db.insert(s.shipmentAccountingLocks).values({
      shipmentId,
      billingDocumentId: billingDocument.id,
      billingDocumentVersion: billingDocument.version,
      billingPeriodSnapshot: {
        rangeFrom: billingDocument.rangeFrom,
        rangeTo: billingDocument.rangeTo,
        issuedAt: billingDocument.issuedAt!.toISOString(),
      },
      shipmentVersionAtLock: shipmentBeforeLock.version,
      reason: 'Q23 verifies the aggregate write guard.',
      activatedBy: adminUserId,
    });
    try {
      const lockedExchange = await jsonRequest(`/api/forwarder/me/shipments/${shipmentId}/order-exchange/start`, {
        method: 'POST',
        idempotencyKey: `q23-order-exchange-locked-${suffix}`,
        body: { expectedVersion: shipmentBeforeLock.version },
      });
      assert.equal(lockedExchange.status, 409);
      assert.match(String(lockedExchange.body.error), /CUS khóa sau khi Kế toán xác nhận/);
    } finally {
      await db.delete(s.shipmentAccountingLocks).where(eq(s.shipmentAccountingLocks.shipmentId, shipmentId));
      await db.delete(s.billingDocuments).where(eq(s.billingDocuments.id, billingDocument.id));
    }
  });

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

  it('derives lift prices from the trip container tariff and rejects amount or type tampering', async () => {
    const liftingPayload = {
      tripId,
      expenseType: 'LIFTING',
      buyAmount: 121000,
      sellAmount: 0,
      expenseDate: '2026-07-28',
      invoiceNumber: `LIFT-${suffix}`.slice(0, 50),
      tripContainerId,
      portId: liftPortId,
      containerTypeId: liftContainerTypeId,
      loadState: 'LOADED',
    };
    const tamperedCreate = await jsonRequest('/api/forwarder/me/expenses', {
      method: 'POST',
      idempotencyKey: `q23-lift-create-tampered-${suffix}`,
      body: liftingPayload,
    });
    assert.equal(tamperedCreate.status, 422, JSON.stringify(tamperedCreate.body));
    const forgedContainerType = await jsonRequest('/api/forwarder/me/expenses', {
      method: 'POST',
      idempotencyKey: `q23-lift-create-type-tampered-${suffix}`,
      body: {
        ...liftingPayload,
        buyAmount: 120000,
        containerTypeId: liftContainerTypeId + 1_000_000,
      },
    });
    assert.equal(forgedContainerType.status, 422, JSON.stringify(forgedContainerType.body));

    const created = await jsonRequest('/api/forwarder/me/expenses', {
      method: 'POST',
      idempotencyKey: `q23-lift-create-${suffix}`,
      body: { ...liftingPayload, buyAmount: 120000 },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const expenseId = Number(created.body.id);
    const [storedCreate] = await db.select({
      buyAmount: s.tripExpenses.buyAmount,
      liftPricingId: s.tripExpenses.liftPricingId,
      liftPricingSnapshot: s.tripExpenses.liftPricingSnapshot,
      updatedAt: s.tripExpenses.updatedAt,
    }).from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
    assert.equal(Number(storedCreate.buyAmount), 120000);
    assert.ok(storedCreate.liftPricingId);
    assert.deepEqual(storedCreate.liftPricingSnapshot, {
      portId: liftPortId,
      containerTypeId: liftContainerTypeId,
      direction: 'LIFT_UP',
      loadState: 'LOADED',
      expenseDate: '2026-07-28',
      effectiveDate: '2026-01-01',
      unitPrice: 120000,
    });

    const tamperedPatch = await jsonRequest(`/api/forwarder/me/expenses/${expenseId}`, {
      method: 'PATCH',
      idempotencyKey: `q23-lift-patch-tampered-${suffix}`,
      expectedUpdatedAt: storedCreate.updatedAt.toISOString(),
      body: { ...liftingPayload, tripId: undefined, buyAmount: 130000 },
    });
    assert.equal(tamperedPatch.status, 422, JSON.stringify(tamperedPatch.body));

    const lowered = await jsonRequest(`/api/forwarder/me/expenses/${expenseId}`, {
      method: 'PATCH',
      idempotencyKey: `q23-lift-patch-${suffix}`,
      expectedUpdatedAt: storedCreate.updatedAt.toISOString(),
      body: {
        expenseType: 'LOWERING',
        buyAmount: 140000,
        expenseDate: '2026-07-28',
        tripContainerId,
        portId: liftPortId,
        containerTypeId: liftContainerTypeId,
        loadState: 'LOADED',
      },
    });
    assert.equal(lowered.status, 200, JSON.stringify(lowered.body));
    const [storedPatch] = await db.select({
      expenseType: s.tripExpenses.expenseType,
      buyAmount: s.tripExpenses.buyAmount,
      liftPricingSnapshot: s.tripExpenses.liftPricingSnapshot,
    }).from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
    assert.equal(storedPatch.expenseType, 'LOWERING');
    assert.equal(Number(storedPatch.buyAmount), 140000);
    assert.equal(storedPatch.liftPricingSnapshot?.direction, 'LIFT_DOWN');
    assert.equal(storedPatch.liftPricingSnapshot?.unitPrice, 140000);

    await db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId));
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
    // Pump-OCR shares the global 2 rps limiter with the fuel-evidence tests
    // that run earlier in this file — clear the window before every request
    // so the assertions exercise idempotency/validation, not the limiter.
    const clearOcrWindow = () => getRedis()?.del(OCR_RATE_LIMIT_KEY);
    await clearOcrWindow();
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'pump.jpg');
    const missingKey = await multipartRequest('/api/ocr/pump', form);
    assert.equal(missingKey.status, 400);

    const key = `q23-ocr-pump-${suffix}`;
    await clearOcrWindow();
    const first = await multipartRequest('/api/ocr/pump', form, { idempotencyKey: key });
    await clearOcrWindow();
    const replay = await multipartRequest('/api/ocr/pump', form, { idempotencyKey: key });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(replay, first);

    const changed = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 3, g: 120, b: 180 } },
    }).jpeg().toBuffer();
    await clearOcrWindow();
    const changedForm = new FormData();
    changedForm.set('file', new Blob([new Uint8Array(changed)], { type: 'image/jpeg' }), 'pump.jpg');
    const conflict = await multipartRequest('/api/ocr/pump', changedForm, { idempotencyKey: key });
    assert.equal(conflict.status, 409);
  });

  it('durably cleans a driver fuel image when processing fails after upload', async () => {
    const idempotencyKey = `q23-fuel-evidence-fail-${suffix}`;
    const storageHash = createHash('sha256').update(imageBuffer).digest('hex');
    const requestHash = createHash('sha256')
      .update(`driver-fuel-evidence:${driverId}:${idempotencyKey}`)
      .digest('hex')
      .slice(0, 32);
    const expectedStorageKey = `fuel-evidence/${tripId}/${driverId}/${storageHash}-${requestHash}.jpg`;
    storageKeys.add(expectedStorageKey);
    setDriverFuelEvidenceAfterUploadHookForTest(() => {
      throw new Error('injected driver fuel evidence processing failure');
    });
    try {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'pump.jpg');
      const failed = await multipartRequest(`/api/driver/me/trips/${tripId}/fuel-evidence`, form, {
        idempotencyKey,
        actor: 'driver-owner',
      });
      assert.equal(failed.status, 500, JSON.stringify(failed.body));
      assert.equal(await storageService.exists(expectedStorageKey), true);

      const [cleanupJob] = (await listStorageDeleteJobs()).filter((row) =>
        (row.payload as Record<string, unknown>).storageKey === expectedStorageKey,
      );
      assert.ok(cleanupJob);
      assert.equal(cleanupJob.status, DURABLE_EFFECT_STATUS.RETRY);
      assert.equal((cleanupJob.payload as Record<string, unknown>).mode, STORAGE_DELETE_MODE.ORPHAN_GUARD);
      await db.update(s.durableEffectJobs)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(s.durableEffectJobs.id, cleanupJob.id));
      const cleanupPass = await processDueDurableEffectJobs(100, {
        now: () => new Date(Date.now() + 5 * 60_000),
      });
      assert.equal(cleanupPass.find((job) => job.id === cleanupJob.id)?.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
      assert.equal(await storageService.exists(expectedStorageKey), false);
    } finally {
      setDriverFuelEvidenceAfterUploadHookForTest(null);
    }
  });

  it('serializes driver fuel evidence creation, enforces owner-only upload, and validates office filters', async () => {
    // Fuel-evidence + review-decision requests share the global 2 rps OCR
    // limiter; clear the window before each clustered request below so the
    // assertions exercise replay/validation semantics, not the limiter.
    const clearOcrWindow = () => getRedis()?.del(OCR_RATE_LIMIT_KEY);
    await clearOcrWindow();
    const fuelHash = createHash('sha256').update(imageBuffer).digest('hex');
    const makeFuelForm = () => {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'pump.jpg');
      form.set('lat', '10.77');
      form.set('lng', '106.69');
      form.set('accuracy', '12');
      form.set('gpsAt', String(Date.now()));
      form.set('source', 'phone');
      return form;
    };
    const firstKey = `q23-fuel-evidence-create-a-${suffix}`;
    const secondKey = `q23-fuel-evidence-create-b-${suffix}`;
    const fuelStorageKeys: string[] = [];
    for (const key of [firstKey, secondKey]) {
      const requestHash = createHash('sha256')
        .update(`driver-fuel-evidence:${driverId}:${key}`)
        .digest('hex')
        .slice(0, 32);
      const keyForRequest = `fuel-evidence/${tripId}/${driverId}/${fuelHash}-${requestHash}.jpg`;
      fuelStorageKeys.push(keyForRequest);
      storageKeys.add(keyForRequest);
    }
    const [first, second] = await Promise.all([
      multipartRequest(`/api/driver/me/trips/${tripId}/fuel-evidence`, makeFuelForm(), {
        idempotencyKey: firstKey,
        actor: 'driver-owner',
      }),
      multipartRequest(`/api/driver/me/trips/${tripId}/fuel-evidence`, makeFuelForm(), {
        idempotencyKey: secondKey,
        actor: 'driver-owner',
      }),
    ]);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(first.body.id, second.body.id);
    const photoUrl = String(first.body.photoUrl);
    const ownerPhoto = await fetch(`${baseUrl}${photoUrl}`, { headers: { 'X-Test-Actor': 'driver-owner' } });
    assert.equal(ownerPhoto.status, 200);
    const accountantPhoto = await fetch(`${baseUrl}${photoUrl}`, { headers: { 'X-Test-Actor': 'accountant' } });
    assert.equal(accountantPhoto.status, 200);
    const otherDriverPhoto = await fetch(`${baseUrl}${photoUrl}`, { headers: { 'X-Test-Actor': 'driver-other' } });
    assert.equal(otherDriverPhoto.status, 403);
    const winningStorageKey = decodeURIComponent(photoUrl.replace('/api/photos/', ''));
    const losingStorageKey = fuelStorageKeys.find((key) => key !== winningStorageKey);
    assert.ok(losingStorageKey);
    const losingCleanupJob = (await listStorageDeleteJobs()).find((row) =>
      (row.payload as Record<string, unknown>).storageKey === losingStorageKey,
    );
    assert.ok(losingCleanupJob);
    assert.equal(losingCleanupJob.status, DURABLE_EFFECT_STATUS.RETRY);
    await db.update(s.durableEffectJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.durableEffectJobs.id, losingCleanupJob.id));
    const cleanupPass = await processDueDurableEffectJobs(100, {
      now: () => new Date(Date.now() + 5 * 60_000),
    });
    assert.equal(cleanupPass.find((job) => job.id === losingCleanupJob.id)?.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    assert.equal(await storageService.exists(losingStorageKey), false);

    const [storedReviewCount] = await db.select({ total: sql<number>`count(*)::int` })
      .from(s.fuelEvidenceReviews)
      .where(and(
        eq(s.fuelEvidenceReviews.tripId, tripId),
        eq(s.fuelEvidenceReviews.ownerDriverId, driverId),
        eq(s.fuelEvidenceReviews.storageHash, fuelHash),
      ));
    assert.equal(Number(storedReviewCount?.total ?? 0), 1);

    const otherDriverDenied = await multipartRequest(`/api/driver/me/trips/${tripId}/fuel-evidence`, makeFuelForm(), {
      idempotencyKey: `q23-fuel-evidence-other-driver-${suffix}`,
      actor: 'driver-other',
    });
    assert.equal(otherDriverDenied.status, 403);

    const managerDenied = await multipartRequest(`/api/driver/me/trips/${tripId}/fuel-evidence`, makeFuelForm(), {
      idempotencyKey: `q23-fuel-evidence-manager-${suffix}`,
      actor: 'manager',
    });
    assert.equal(managerDenied.status, 404);

    // The OCR endpoints share a global 2 rps limiter backed by Redis; the
    // earlier pump-OCR block above can leave the window exhausted by the
    // time this filter probe runs. Reset it so the assertion tests
    // validation (400), not the limiter (429).
    await getRedis()?.del(OCR_RATE_LIMIT_KEY);

    const invalidFilter = await jsonRequest('/api/ocr/fuel-evidence-reviews?status=INVALID', {
      method: 'GET',
    });
    assert.equal(invalidFilter.status, 400);

    const listed = await jsonRequest('/api/ocr/fuel-evidence-reviews?status=PENDING', {
      method: 'GET',
    });
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    const review = ((listed.body.items as Array<Record<string, unknown>>) ?? [])
      .find((item) => Number(item.tripId) === tripId && Number(item.ownerDriverId) === driverId);
    assert.ok(review);

    await clearOcrWindow();
    const decided = await jsonRequest(`/api/ocr/fuel-evidence-reviews/${review!.id}/decision`, {
      method: 'POST',
      idempotencyKey: `q23-fuel-evidence-decision-${suffix}`,
      body: {
        expectedVersion: Number(review!.version),
        decision: 'CONFIRMED',
      },
    });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.reviewStatus, 'CONFIRMED');

    const replayedDecision = await jsonRequest(`/api/ocr/fuel-evidence-reviews/${review!.id}/decision`, {
      method: 'POST',
      idempotencyKey: `q23-fuel-evidence-decision-${suffix}`,
      body: {
        expectedVersion: Number(review!.version),
        decision: 'CONFIRMED',
      },
    });
    assert.deepEqual(replayedDecision, decided);

    await clearOcrWindow();
    const changedDecision = await jsonRequest(`/api/ocr/fuel-evidence-reviews/${review!.id}/decision`, {
      method: 'POST',
      idempotencyKey: `q23-fuel-evidence-decision-${suffix}`,
      body: {
        expectedVersion: Number(review!.version),
        decision: 'REJECTED',
      },
    });
    assert.equal(changedDecision.status, 409);
  });
});
