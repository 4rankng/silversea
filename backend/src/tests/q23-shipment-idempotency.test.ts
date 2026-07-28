import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import shipmentRoutes from '../routes/shipments';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shipmentIds: number[] = [];
const idempotencyKeys: string[] = [];
let customerId: number;
let userId: number;
let server: http.Server;
let baseUrl: string;

async function request(
  path: string,
  options: {
    method: 'POST' | 'PUT';
    body: Record<string, unknown>;
    key?: string;
  },
) {
  const response = await fetch(`${baseUrl}/api/shipments${path}`, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.key ? { 'Idempotency-Key': options.key } : {}),
    },
    body: JSON.stringify(options.body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  const [customer] = await db.insert(s.customers).values({
    name: `Q23 shipment customer ${suffix}`,
  }).returning();
  customerId = customer.id;

  const [user] = await db.insert(s.users).values({
    username: `q23-shipment-${suffix}`,
    passwordHash: 'x',
    role: Role.MANAGER,
  }).returning();
  userId = user.id;

  const app = express();
  app.use(express.json());
  app.use('/api/shipments', (req, _res, next) => {
    req.user = {
      userId,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: Role.MANAGER,
    };
    next();
  }, shipmentRoutes);
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
      .where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
  }
  if (shipmentIds.length > 0) {
    await db.delete(s.shipmentStatusHistory)
      .where(inArray(s.shipmentStatusHistory.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  }
  await db.delete(s.users).where(eq(s.users.id, userId));
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await disconnectRedis();
  await client.end();
});

describe('Q23 shipment immutable write replay', () => {
  test('replays the exact original create response and rejects key payload mismatch', async () => {
    const key = `q23-shipment-create-${suffix}`;
    idempotencyKeys.push(key);
    const body = {
      customerId,
      bookingRef: `BOOK-${suffix}`,
      pickupLocation: 'Cảng Cát Lái',
    };

    const first = await request('/', { method: 'POST', body, key });
    const replay = await request('/', { method: 'POST', body, key });
    assert.equal(first.status, 201);
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, first.body);
    shipmentIds.push(Number(first.body.id));

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(s.shipments)
      .where(eq(s.shipments.bookingRef, body.bookingRef));
    assert.equal(Number(total), 1);

    const mismatch = await request('/', {
      method: 'POST',
      key,
      body: { ...body, pickupLocation: 'Cảng Hiệp Phước' },
    });
    assert.equal(mismatch.status, 409);
    assert.match(String(mismatch.body.error), /Khóa giao dịch trùng/);
  });

  test('replays the immutable update snapshot after later writes and checks payload before stale version', async () => {
    const created = await request('/', {
      method: 'POST',
      body: {
        customerId,
        bookingRef: `UPDATE-${suffix}`,
      },
    });
    assert.equal(created.status, 201);
    const shipmentId = Number(created.body.id);
    shipmentIds.push(shipmentId);

    const key = `q23-shipment-update-${suffix}`;
    idempotencyKeys.push(key);
    const keyedBody = {
      expectedVersion: Number(created.body.version),
      contactName: 'Bản ghi gốc',
    };
    const first = await request(`/${shipmentId}`, {
      method: 'PUT',
      body: keyedBody,
      key,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.version, 2);

    const later = await request(`/${shipmentId}`, {
      method: 'PUT',
      body: {
        expectedVersion: 2,
        contactName: 'Bản ghi mới hơn',
      },
    });
    assert.equal(later.status, 200);
    assert.equal(later.body.version, 3);

    const replay = await request(`/${shipmentId}`, {
      method: 'PUT',
      body: keyedBody,
      key,
    });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, first.body);

    const mismatch = await request(`/${shipmentId}`, {
      method: 'PUT',
      key,
      body: {
        expectedVersion: Number(created.body.version),
        contactName: 'Nội dung khác',
      },
    });
    assert.equal(mismatch.status, 409);
    assert.match(String(mismatch.body.error), /Khóa giao dịch trùng/);

    const [persisted] = await db.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), eq(s.shipments.version, 3)))
      .limit(1);
    assert.equal(persisted.contactName, 'Bản ghi mới hơn');
  });
});
