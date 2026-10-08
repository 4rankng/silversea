/**
 * Card 081026104400-511 — warm-cache shape + save-eviction pins.
 *
 * Live failure on staging: GET /api/vat-config 500'd ("row.createdAt.toISOString
 * is not a function") because cacheGet ends in `JSON.parse(cached) as T`, so a
 * cache HIT hands timestamps back as ISO strings while the serializer assumed
 * Date. Cold GETs looked healthy — the flapping 200/500 is the warm path.
 * Second behavior: a save that does not evict 'config:vat' serves the stale
 * row for the whole TTL.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { cacheInvalidate, disconnectRedis } from '../lib/redis';
import configRoutes from '../routes/config';
import { globalErrorHandler } from '../middleware/errorHandler';

let server: http.Server;
let baseUrl: string;
let actorId: number;
const suffix = Date.now().toString(36);

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, init);
  return { status: res.status, text: await res.text() };
}

before(async () => {
  const [actor] = await db.insert(s.users).values({
    username: `vatshape-admin-${suffix}`, passwordHash: 'x', role: Role.ADMIN, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  actorId = actor!.id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      userId: actorId,
      username: `vatshape-${actorId}`,
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

  await db.delete(s.vatConfig);
  await db.insert(s.vatConfig).values({ vatRate: '0.13' });
  await cacheInvalidate('config:vat');
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  await db.delete(s.vatConfig);
  await cacheInvalidate('config:vat');
  await db.delete(s.users).where(eq(s.users.id, actorId));
  await disconnectRedis();
});

describe('vat-config cache shape (card 081026104400-511)', () => {
  it('a warm cache hit serializes like the cold path — never 500', async () => {
    const cold = await call('/api/vat-config');
    assert.equal(cold.status, 200, `cold GET must 200, got ${cold.status}: ${cold.text}`);
    const warm = await call('/api/vat-config');
    assert.equal(warm.status, 200, `warm GET must 200, got ${warm.status}: ${warm.text}`);
    const body = JSON.parse(warm.text);
    assert.equal(body.vatRate, 0.13);
    assert.ok(!Number.isNaN(Date.parse(body.updatedAt)), 'updatedAt must be a parseable timestamp');
    assert.ok(!Number.isNaN(Date.parse(body.createdAt)), 'createdAt must be a parseable timestamp');
  });

  it('a save evicts the cache — the next read shows the new rate', async () => {
    const current = await call('/api/vat-config');
    const lock = JSON.parse(current.text).updatedAt as string;
    const put = await call('/api/vat-config', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': `vatshape-${suffix}`,
        'If-Unmodified-Since': lock,
      },
      body: JSON.stringify({ vatRate: 0.05 }),
    });
    assert.ok(put.status === 200 || put.status === 201, `save must succeed, got ${put.status}: ${put.text}`);
    const afterSave = await call('/api/vat-config');
    assert.equal(afterSave.status, 200);
    assert.equal(JSON.parse(afterSave.text).vatRate, 0.05, 'the read right after save must show the new rate, not the cached one');
  });
});
