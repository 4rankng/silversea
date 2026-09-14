// Transfer semantics for the truck↔trailer coupling: when truck B saves
// currentTrailerId=T, any OTHER truck's link to T clears in the same
// transaction — both views stay truthful (the old truck never keeps
// displaying a trailer that moved). Locked at the schema-service level via
// the catalog route hooks (HTTP harness, same pattern as the config tests).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { inArray, eq } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import configRoutes from '../routes/config';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const truckIds: number[] = [];
const trailerIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let token = '';

function signToken(user: { id: number; username: string | null }) {
  return jwt.sign({
    userId: user.id, username: user.username ?? `u${user.id}`, email: null,
    fullName: null, role: Role.ADMIN, customerId: null, customerIds: [],
  }, config.jwtSecret);
}

async function api(method: string, path: string, body?: unknown) {
  // Catalog updates are optimistic-locked via If-Unmodified-Since — fetch the
  // row's current updatedAt for the header.
  let versionHeader: Record<string, string> = {};
  if (method !== 'GET') {
    const match = /\/trucks\/(\d+)/.exec(path);
    if (match) {
      const [row] = await db.select({ updatedAt: s.trucks.updatedAt }).from(s.trucks)
        .where(eq(s.trucks.id, Number(match[1]))).limit(1);
      if (row) versionHeader = { 'If-Unmodified-Since': row.updatedAt.toISOString() };
    }
  }
  const response = await fetch(`${baseUrl}/api/config${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...versionHeader,
      ...(method !== 'GET' ? { 'Idempotency-Key': `tt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function truckLink(truckId: number): Promise<number | null> {
  const [row] = await db.select({ currentTrailerId: s.trucks.currentTrailerId })
    .from(s.trucks).where(eq(s.trucks.id, truckId)).limit(1);
  return row?.currentTrailerId ?? null;
}

before(async () => {
  await initEnforcer();
  const [user] = await db.insert(s.users).values({
    username: `tt-admin-${suffix}`, passwordHash: 'x', role: Role.ADMIN, status: 'ACTIVE',
  }).returning();
  userIds.push(user.id);
  token = signToken(user);

  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `TT-RM-${suffix.slice(-6)}`.slice(0, 20), type: '40FT', status: 'ACTIVE',
  }).returning();
  trailerIds.push(trailer.id);

  const [truckA] = await db.insert(s.trucks).values({
    licensePlate: `TT-A-${suffix.slice(-6)}`.slice(0, 20), status: 'ACTIVE',
    currentTrailerId: trailer.id,
  }).returning();
  truckIds.push(truckA.id);
  const [truckB] = await db.insert(s.trucks).values({
    licensePlate: `TT-B-${suffix.slice(-6)}`.slice(0, 20), status: 'ACTIVE',
  }).returning();
  truckIds.push(truckB.id);

  const app = express();
  app.use(express.json());
  app.use('/api/config', authMiddleware, casbinAuthz('config'), configRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

describe('truck→trailer transfer semantics', () => {
  test('A→T then B→T ⇒ A null, B T (both views truthful, no double claim)', async () => {
    // Precondition: A holds T.
    assert.equal(await truckLink(truckIds[0]), trailerIds[0]);

    const saved = await api('PUT', `/trucks/${truckIds[1]}`, { currentTrailerId: trailerIds[0] });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));

    assert.equal(await truckLink(truckIds[1]), trailerIds[0], 'B holds T');
    assert.equal(await truckLink(truckIds[0]), null, 'A auto-cleared');
  });

  test('create-path transfer: a NEW truck claiming a held trailer clears the holder', async () => {
    // Truck C is created claiming T (held by B from test 1).
    const created = await api('POST', '/trucks', {
      licensePlate: `TT-C-${suffix.slice(-6)}`.slice(0, 20),
      currentTrailerId: trailerIds[0],
      status: 'ACTIVE',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const truckCId = created.data.id;
    truckIds.push(truckCId);

    assert.equal(await truckLink(truckCId), trailerIds[0], 'C holds T');
    assert.equal(await truckLink(truckIds[1]), null, 'B auto-cleared');
  });

  test('clearing B leaves T uncoupled everywhere', async () => {
    const cleared = await api('PUT', `/trucks/${truckIds[1]}`, { currentTrailerId: null });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
    assert.equal(await truckLink(truckIds[1]), null);
    assert.equal(await truckLink(truckIds[0]), null);
  });

  test('an inactive trailer is rejected with the actionable message', async () => {
    const [inactive] = await db.insert(s.trailers).values({
      licensePlate: `TT-IX-${suffix.slice(-6)}`.slice(0, 20), type: '20FT', status: 'MAINTENANCE',
    }).returning();
    trailerIds.push(inactive.id);
    const rejected = await api('PUT', `/trucks/${truckIds[1]}`, { currentTrailerId: inactive.id });
    assert.equal(rejected.status, 400);
    assert.ok(JSON.stringify(rejected.data).includes('Rơ-moóc liên kết'));
    assert.equal(await truckLink(truckIds[1]), null);
  });
});

after(async () => {
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  }
  try {
    if (truckIds.length) await db.update(s.trucks).set({ currentTrailerId: null }).where(inArray(s.trucks.id, truckIds));
    if (truckIds.length) await db.delete(s.trucks).where(inArray(s.trucks.id, truckIds));
    if (trailerIds.length) await db.delete(s.trailers).where(inArray(s.trailers.id, trailerIds));
    if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch (err) {
    console.warn('[truck-trailer-transfer.test] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
