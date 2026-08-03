import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import { eq, inArray, like } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];
const containerTypeIds: number[] = [];
const portIds: number[] = [];
let actorId = 0;
let server: http.Server;
let baseUrl = '';

async function api(
  method: string,
  path: string,
  body: Record<string, unknown> | undefined,
  key: string,
  expectedUpdatedAt?: string,
) {
  idempotencyKeys.push(key);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      ...(expectedUpdatedAt ? { 'If-Unmodified-Since': expectedUpdatedAt } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

before(async () => {
  const [actor] = await db.insert(s.users).values({
    username: `app-owned-config-${suffix}`,
    passwordHash: 'x',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  actorId = actor.id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      userId: actorId,
      username: `app-owned-config-${suffix}`,
      email: null,
      fullName: null,
      role: Role.ADMIN,
    };
    next();
  });
  app.use('/api', configRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
  }
  await db.delete(s.liftPricing).where(like(s.liftPricing.note, `app-owned-config-${suffix}%`));
  if (portIds.length > 0) await db.delete(s.ports).where(inArray(s.ports.id, portIds));
  if (containerTypeIds.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, containerTypeIds));
  if (actorId > 0) await db.delete(s.users).where(eq(s.users.id, actorId));
  await disconnectRedis();
  await client.end();
});

describe('application-owned config route constraints', () => {
  test('concurrent normalized container codes yield one row and one semantic conflict', async () => {
    const code = `AC${suffix}`.slice(0, 20);
    const responses = await Promise.all([
      api('POST', '/api/container-types', { code, name: `Container A ${suffix}` }, `app-owned-ct-a-${suffix}`),
      api('POST', '/api/container-types', { code, name: `Container B ${suffix}` }, `app-owned-ct-b-${suffix}`),
    ]);
    const rows = await db.select().from(s.containerTypes)
      .where(like(s.containerTypes.code, `%${code.slice(2)}%`));
    containerTypeIds.push(...rows.map((row) => row.id));
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    assert.equal(rows.filter((row) => row.deletedAt == null).length, 1);
  });

  test('a soft-deleted port cannot receive a new lift-pricing relationship', async () => {
    const portCode = `P${suffix}`.slice(0, 20);
    const createdPort = await api('POST', '/api/ports', {
      code: portCode,
      name: `Port ${suffix}`,
    }, `app-owned-port-create-${suffix}`);
    assert.equal(createdPort.status, 201, JSON.stringify(createdPort.body));
    const portId = Number(createdPort.body.id);
    portIds.push(portId);

    const deleted = await api(
      'DELETE',
      `/api/ports/${portId}`,
      {},
      `app-owned-port-delete-${suffix}`,
      String(createdPort.body.updatedAt),
    );
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

    const [containerType] = await db.insert(s.containerTypes).values({
      code: `LP${suffix}`.slice(0, 20),
      name: `Lift type ${suffix}`.slice(0, 50),
    }).returning();
    containerTypeIds.push(containerType.id);

    const response = await api('POST', '/api/lift-pricing', {
      portId,
      containerTypeId: containerType.id,
      direction: 'LIFT_UP',
      loadState: 'LOADED',
      unitPrice: 100000,
      effectiveDate: '2026-08-01',
      note: `app-owned-config-${suffix}-orphan-proof`,
    }, `app-owned-lift-create-${suffix}`);
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.match(String(response.body.error ?? ''), /Cảng không tồn tại|ngưng dùng/);
  });
});
