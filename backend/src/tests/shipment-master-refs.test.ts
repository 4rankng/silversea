// Card 20260915_12 — shipment create/update must reject phantom master refs.
// POST /api/shipments and PUT /api/shipments/:id used to persist
// customerId/routeId/cargoTypeId values that exist nowhere (shipments has no
// FK constraints on master refs and the app layer never checked existence).
// Pre-existing orphan rows (94 found in the 2026-09-15 sweep) must stay
// updatable: an update validates only the refs its input actually changes.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import shipmentRoutes from '../routes/shipments';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-masterrefs`;
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
    name: `Master refs customer ${suffix}`,
    shortName: `MR ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  customerId = customer.id;

  const [user] = await db.insert(s.users).values({
    username: `master-refs-${suffix}`,
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
  if (shipmentIds.length > 0) {
    await db.delete(s.shipmentStatusHistory)
      .where(inArray(s.shipmentStatusHistory.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  }
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
  }
  await db.delete(s.users).where(eq(s.users.id, userId));
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await disconnectRedis();
  await client.end();
});

describe('shipment master reference integrity', () => {
  test('create rejects a phantom customerId', async () => {
    const key = `masterrefs-create-cust-${suffix}`;
    idempotencyKeys.push(key);
    const res = await request('/', {
      method: 'POST',
      body: { customerId: 999_999_999 },
      key,
    });
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /không tồn tại/u);
  });

  test('create rejects a phantom routeId', async () => {
    const key = `masterrefs-create-route-${suffix}`;
    idempotencyKeys.push(key);
    const res = await request('/', {
      method: 'POST',
      body: { customerId, routeId: 999_999_999 },
      key,
    });
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /không tồn tại/u);
  });

  test('create rejects a phantom cargoTypeId', async () => {
    const key = `masterrefs-create-cargo-${suffix}`;
    idempotencyKeys.push(key);
    const res = await request('/', {
      method: 'POST',
      body: { customerId, cargoTypeId: 999_999_999 },
      key,
    });
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /không tồn tại/u);
  });

  test('create still accepts a valid customer with no optional refs', async () => {
    const key = `masterrefs-create-valid-${suffix}`;
    idempotencyKeys.push(key);
    const res = await request('/', {
      method: 'POST',
      body: { customerId },
      key,
    });
    assert.equal(res.status, 201);
    shipmentIds.push(Number(res.body.id));
  });

  test('update rejects switching to a phantom routeId', async () => {
    const createKey = `masterrefs-update-seed-${suffix}`;
    idempotencyKeys.push(createKey);
    const created = await request('/', {
      method: 'POST',
      body: { customerId },
      key: createKey,
    });
    assert.equal(created.status, 201);
    const shipmentId = Number(created.body.id);
    shipmentIds.push(shipmentId);

    const key = `masterrefs-update-route-${suffix}`;
    idempotencyKeys.push(key);
    const res = await request(`/${shipmentId}`, {
      method: 'PUT',
      body: { routeId: 999_999_999, expectedVersion: Number(created.body.version) },
      key,
    });
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /không tồn tại/u);
  });

  test('update of a pre-existing orphan row that changes no refs still succeeds', async () => {
    const [orphan] = await db.insert(s.shipments).values({
      customerId: 999_999_998,
      cargoMode: 'FCL',
      shipmentCode: `MAST-${suffix}`,
      status: 'PENDING_DATE',
      createdBy: userId,
      version: 1,
    }).returning();
    shipmentIds.push(orphan.id);

    const key = `masterrefs-update-orphan-${suffix}`;
    idempotencyKeys.push(key);
    const res = await request(`/${orphan.id}`, {
      method: 'PUT',
      body: { operationalNotes: 'orphan vẫn sửa được', expectedVersion: 1 },
      key,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.operationalNotes, 'orphan vẫn sửa được');
  });

  test('update that resends the stored phantom routeId unchanged still succeeds', async () => {
    const [orphan] = await db.insert(s.shipments).values({
      customerId: 999_999_998,
      routeId: 999_999_997,
      cargoMode: 'LCL',
      shipmentCode: `MAST2-${suffix}`,
      status: 'PENDING_DATE',
      createdBy: userId,
      version: 1,
    }).returning();
    shipmentIds.push(orphan.id);

    // The clerk identity editor resends routeId with every save for non-FCL
    // rows. A stored phantom routeId must not block unrelated edits — only
    // refs the input actually CHANGES are validated.
    const key = `masterrefs-update-orphan-route-${suffix}`;
    idempotencyKeys.push(key);
    const res = await request(`/${orphan.id}`, {
      method: 'PUT',
      body: { routeId: 999_999_997, operationalNotes: 'route giữ nguyên', expectedVersion: 1 },
      key,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.operationalNotes, 'route giữ nguyên');
  });
});
