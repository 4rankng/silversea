import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import geotagRoutes from '../routes/geotag';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const entityId = 900_000_000 + Math.floor(Math.random() * 10_000_000);
const idempotencyKeys: string[] = [];
let actorId = 0;
let server: http.Server;
let baseUrl = '';

async function submit(body: Record<string, unknown>, key?: string) {
  if (key) idempotencyKeys.push(key);
  const response = await fetch(`${baseUrl}/api/geotag`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  const [actor] = await db.insert(s.users).values({
    username: `q23-geotag-${suffix}`,
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
      username: `q23-geotag-${suffix}`,
      email: null,
      fullName: null,
      role: Role.ADMIN,
    };
    next();
  });
  app.use('/api/geotag', geotagRoutes);
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
  await db.delete(s.photoGeotags).where(and(
    eq(s.photoGeotags.entityType, 'expense_photo'),
    eq(s.photoGeotags.entityId, entityId),
  ));
  if (actorId > 0) {
    await db.delete(s.users).where(eq(s.users.id, actorId));
  }
  await disconnectRedis();
  await client.end();
});

describe('Q23 geotag immutable replay', () => {
  const payload = {
    entityType: 'expense_photo',
    entityId,
    lat: 10.7769,
    lng: 106.7009,
    accuracy: 8,
    source: 'phone',
  };

  it('requires a transaction key before mutating the geotag', async () => {
    const response = await submit(payload);
    assert.equal(response.status, 400);
    assert.match(String(response.body.error ?? ''), /Idempotency-Key/);
  });

  it('replays the original fix and rejects same-key payload changes', async () => {
    const key = `q23-geotag-${suffix}`;
    const first = await submit(payload, key);
    const replay = await submit(payload, key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual(replay, first);

    const rows = await db.select()
      .from(s.photoGeotags)
      .where(and(
        eq(s.photoGeotags.entityType, 'expense_photo'),
        eq(s.photoGeotags.entityId, entityId),
      ));
    assert.equal(rows.length, 1);

    const conflict = await submit({ ...payload, lat: 10.777 }, key);
    assert.equal(conflict.status, 409);

    const [unchanged] = await db.select()
      .from(s.photoGeotags)
      .where(eq(s.photoGeotags.id, Number(first.body.id)));
    assert.equal(unchanged.lat, payload.lat);
  });
});
