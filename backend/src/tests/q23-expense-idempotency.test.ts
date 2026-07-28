import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import sharp from 'sharp';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import expenseRoutes from '../routes/expense';
import { storageService } from '../services/storage.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];
const expenseIds: number[] = [];
let actorId = 0;
let supplierId = 0;
let categoryId = 0;
let server: http.Server;
let baseUrl = '';
const uploadedStorageKeys: string[] = [];
const deletedStorageKeys: string[] = [];
const originalStorageUpload = storageService.upload.bind(storageService);
const originalStorageDelete = storageService.delete.bind(storageService);

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
  expectedUpdatedAt?: string,
) {
  if (idempotencyKey) idempotencyKeys.push(idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(expectedUpdatedAt ? { 'If-Unmodified-Since': expectedUpdatedAt } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function createPayload(amount = 100_000) {
  return {
    expenseDate: '2026-07-28',
    supplierId,
    categoryId,
    amount,
    paymentStatus: 'UNPAID',
    note: `Q23 expense ${suffix}`,
  };
}

async function uploadPhoto(
  expenseId: number,
  idempotencyKey: string,
  buffer: Buffer,
) {
  idempotencyKeys.push(idempotencyKey);
  const form = new FormData();
  const bytes = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  form.append('file', new Blob([bytes], { type: 'image/png' }), 'receipt.png');
  const response = await fetch(`${baseUrl}/api/expenses/${expenseId}/photos`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: form,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  storageService.upload = async (_buffer: Buffer, key: string) => {
    uploadedStorageKeys.push(key);
    return key;
  };
  storageService.delete = async (key: string) => {
    deletedStorageKeys.push(key);
  };

  const [actor] = await db.insert(s.users).values({
    username: `q23-expense-${suffix}`,
    passwordHash: 'x',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  actorId = actor.id;

  const [supplier] = await db.insert(s.suppliers).values({
    name: `Q23 supplier ${suffix}`,
    status: 'ACTIVE',
  }).returning({ id: s.suppliers.id });
  supplierId = supplier.id;

  const [category] = await db.insert(s.expenseCategories).values({
    name: `Q23 category ${suffix}`,
    status: 'ACTIVE',
  }).returning({ id: s.expenseCategories.id });
  categoryId = category.id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      userId: actorId,
      username: `q23-expense-${suffix}`,
      email: null,
      fullName: null,
      role: Role.ADMIN,
    };
    next();
  });
  app.use('/api/expenses', expenseRoutes);
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
  if (supplierId > 0) {
    await db.delete(s.ledger).where(and(
      eq(s.ledger.entityType, 'VENDOR'),
      eq(s.ledger.entityId, supplierId),
    ));
  }
  if (expenseIds.length > 0) {
    await db.delete(s.expensePhotos)
      .where(inArray(s.expensePhotos.expenseId, expenseIds));
    await db.delete(s.expenses).where(inArray(s.expenses.id, expenseIds));
  }
  if (categoryId > 0) {
    await db.delete(s.expenseCategories).where(eq(s.expenseCategories.id, categoryId));
  }
  if (supplierId > 0) {
    await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId));
  }
  if (actorId > 0) {
    await db.delete(s.users).where(eq(s.users.id, actorId));
  }
  storageService.upload = originalStorageUpload;
  storageService.delete = originalStorageDelete;
  await disconnectRedis();
  await client.end();
});

describe('Q23 company expense replay and concurrency', () => {
  it('requires a transaction key before creating an expense', async () => {
    const response = await api('POST', '/api/expenses', createPayload());
    assert.equal(response.status, 400);
    assert.match(String(response.body.error ?? ''), /Idempotency-Key/);
  });

  it('replays create, update, and delete exactly while rejecting stale writers', async () => {
    const createKey = `q23-expense-create-${suffix}`;
    const created = await api('POST', '/api/expenses', createPayload(), createKey);
    const createReplay = await api('POST', '/api/expenses', createPayload(), createKey);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(createReplay, created);
    const expenseId = Number(created.body.id);
    expenseIds.push(expenseId);

    const createdRows = await db.select()
      .from(s.expenses)
      .where(eq(s.expenses.id, expenseId));
    assert.equal(createdRows.length, 1);

    const originalVersion = String(created.body.updatedAt);
    const missingVersion = await api(
      'PUT',
      `/api/expenses/${expenseId}`,
      { amount: 110_000 },
      `q23-expense-missing-version-${suffix}`,
    );
    assert.equal(missingVersion.status, 428);

    const [left, right] = await Promise.all([
      api(
        'PUT',
        `/api/expenses/${expenseId}`,
        { amount: 120_000 },
        `q23-expense-update-left-${suffix}`,
        originalVersion,
      ),
      api(
        'PUT',
        `/api/expenses/${expenseId}`,
        { amount: 130_000 },
        `q23-expense-update-right-${suffix}`,
        originalVersion,
      ),
    ]);
    assert.deepEqual(
      [left.status, right.status].sort(),
      [200, 409],
      JSON.stringify({ left, right }),
    );
    const winner = left.status === 200 ? left : right;
    const winnerKey = left.status === 200
      ? `q23-expense-update-left-${suffix}`
      : `q23-expense-update-right-${suffix}`;
    const winnerAmount = Number(winner.body.amount);
    const updateReplay = await api(
      'PUT',
      `/api/expenses/${expenseId}`,
      { amount: winnerAmount },
      winnerKey,
      originalVersion,
    );
    assert.deepEqual(updateReplay, winner);

    const ledgerAfterUpdate = await db.select()
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'VENDOR'),
        eq(s.ledger.entityId, supplierId),
        inArray(s.ledger.txnType, [TxnType.VENDOR_EXPENSE, TxnType.ADJUSTMENT]),
      ));
    assert.equal(ledgerAfterUpdate.length, 3);

    const staleDelete = await api(
      'DELETE',
      `/api/expenses/${expenseId}`,
      undefined,
      `q23-expense-stale-delete-${suffix}`,
      originalVersion,
    );
    assert.equal(staleDelete.status, 409);

    const deleteKey = `q23-expense-delete-${suffix}`;
    const currentVersion = String(winner.body.updatedAt);
    const deleted = await api(
      'DELETE',
      `/api/expenses/${expenseId}`,
      undefined,
      deleteKey,
      currentVersion,
    );
    const deleteReplay = await api(
      'DELETE',
      `/api/expenses/${expenseId}`,
      undefined,
      deleteKey,
      currentVersion,
    );
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleteReplay, deleted);

    const ledgerAfterDelete = await db.select()
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'VENDOR'),
        eq(s.ledger.entityId, supplierId),
        inArray(s.ledger.txnType, [TxnType.VENDOR_EXPENSE, TxnType.ADJUSTMENT]),
      ));
    assert.equal(ledgerAfterDelete.length, 4);
  });

  it('uses a deterministic photo object key and replays upload/delete without duplicate effects', async () => {
    const created = await api(
      'POST',
      '/api/expenses',
      createPayload(140_000),
      `q23-expense-photo-parent-${suffix}`,
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const expenseId = Number(created.body.id);
    expenseIds.push(expenseId);

    const redPng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    }).png().toBuffer();
    const bluePng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    }).png().toBuffer();

    const uploadKey = `q23-expense-photo-upload-${suffix}`;
    const uploaded = await uploadPhoto(expenseId, uploadKey, redPng);
    const uploadReplay = await uploadPhoto(expenseId, uploadKey, redPng);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    assert.deepEqual(uploadReplay, uploaded);
    assert.equal(uploadedStorageKeys.length, 1);

    const conflictingUpload = await uploadPhoto(expenseId, uploadKey, bluePng);
    assert.equal(conflictingUpload.status, 409);
    assert.equal(uploadedStorageKeys.length, 1);

    const photoId = Number(uploaded.body.id);
    const photoRows = await db.select()
      .from(s.expensePhotos)
      .where(eq(s.expensePhotos.id, photoId));
    assert.equal(photoRows.length, 1);
    assert.equal(photoRows[0].storageKey, uploadedStorageKeys[0]);

    const deleteKey = `q23-expense-photo-delete-${suffix}`;
    const deleted = await api(
      'DELETE',
      `/api/expenses/${expenseId}/photos/${photoId}`,
      undefined,
      deleteKey,
    );
    const deleteReplay = await api(
      'DELETE',
      `/api/expenses/${expenseId}/photos/${photoId}`,
      undefined,
      deleteKey,
    );
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleteReplay, deleted);
    assert.deepEqual(deletedStorageKeys, uploadedStorageKeys);

    const remaining = await db.select()
      .from(s.expensePhotos)
      .where(eq(s.expensePhotos.id, photoId));
    assert.equal(remaining.length, 0);
  });
});
