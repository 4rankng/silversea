/**
 * truck-carrier-link matrix (pinned contract, 2026-09-12): trucks.carrierId
 * assign/change/unassign through the catalog CRUD, carrier validation at
 * write time, and the list-by-carrier filter (items AND total).
 *
 * 8 rows: (1) assign ACTIVE carrier + filter; (2) empty filter result;
 * (3) non-carrier customer 409; (4) LOCKED/soft-deleted carrier 409;
 * (5) unassign null + filter exclusion; (6) garbage + unknown filter 400;
 * (7) create-with-carrierId validated like update; (8) reverse-lock
 * semantics pinned (soft-deleted carrier blocks assigns; linked trucks
 * keep their id — see the assertActiveCarrier doc comment in
 * catalog-crud.routes.ts).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import configRoutes from '../routes/config';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdTruckIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let adminToken = '';

function signToken(user: { id: number; username: string | null; role: Role }) {
  return jwt.sign({
    userId: user.id,
    username: user.username ?? `user-${user.id}`,
    email: null,
    fullName: null,
    role: user.role,
    customerId: null,
    customerIds: undefined,
  }, config.jwtSecret);
}

async function api<T>(path: string, options: {
  method?: string;
  body?: unknown;
  ifUnmodifiedSince?: string;
} = {}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  };
  if ((options.method ?? 'GET') !== 'GET') {
    headers['Idempotency-Key'] = `truck-link-${suffix}-${Math.random().toString(36).slice(2, 10)}`;
  }
  if (options.ifUnmodifiedSince) headers['If-Unmodified-Since'] = options.ifUnmodifiedSince;
  const response = await fetch(`${baseUrl}/api/trucks${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({})) as T;
  return { status: response.status, data };
}

async function mkCustomer(args: { isCarrier?: boolean; status?: string } = {}) {
  const [row] = await db.insert(s.customers).values({
    name: `TruckLink ${suffix}-${createdCustomerIds.length}`,
    ...(args.isCarrier === true ? { isCarrier: true } : {}),
    ...(args.status ? { status: args.status as 'ACTIVE' | 'LOCKED' } : {}),
  }).returning();
  createdCustomerIds.push(row.id);
  return row;
}

async function mkTruck(n: number) {
  const [row] = await db.insert(s.trucks).values({
    licensePlate: `31T${suffix.slice(-4)}${String(n).padStart(3, '0')}`.slice(0, 20),
    status: 'ACTIVE',
  }).returning();
  createdTruckIds.push(row.id);
  return row;
}

before(async () => {
  await initEnforcer();
  const [user] = await db.insert(s.users).values({
    username: `truck-link-admin-${suffix}`,
    passwordHash: await bcrypt.hash('x', 10),
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  adminToken = signToken({ id: user.id, username: user.username, role: Role.ADMIN });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: unknown }).user = undefined; next(); });
  app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

describe('truck-carrier-link — pinned contract matrix', () => {
  test('(1)+(2) assign an ACTIVE carrier; the carrierId filter drives items AND total; other carriers filter empty', async () => {
    const carrier = await mkCustomer({ isCarrier: true });
    const other = await mkCustomer({ isCarrier: true });
    const truckA = await mkTruck(1);
    const truckB = await mkTruck(2);

    const assign = await api<{ carrierId: number | null }>(`/${truckA.id}`, {
      method: 'PUT',
      ifUnmodifiedSince: truckA.updatedAt.toISOString(),
      body: { carrierId: carrier.id },
    });
    assert.equal(assign.status, 200, JSON.stringify(assign.data));
    assert.equal(assign.data.carrierId, carrier.id);

    const filtered = await api<{ items: Array<{ id: number; carrierId: number | null }>; total: number }>(`?carrierId=${carrier.id}`);
    assert.equal(filtered.status, 200);
    const ids = filtered.data.items.map((t) => t.id);
    assert.ok(ids.includes(truckA.id), 'assigned truck is in the filtered list');
    assert.ok(!ids.includes(truckB.id), 'unassigned truck is excluded');
    assert.equal(filtered.data.total, filtered.data.items.length, 'total shares the filter');
    assert.equal(filtered.data.items.find((t) => t.id === truckA.id)?.carrierId, carrier.id);

    const empty = await api<{ items: unknown[]; total: number }>(`?carrierId=${other.id}`);
    assert.deepEqual(empty.data.items, []);
    assert.equal(empty.data.total, 0);
  });

  test('(3) a non-carrier customer cannot be assigned', async () => {
    const plain = await mkCustomer();
    const truck = await mkTruck(3);
    const res = await api<{ error?: string }>(`/${truck.id}`, {
      method: 'PUT',
      ifUnmodifiedSince: truck.updatedAt.toISOString(),
      body: { carrierId: plain.id },
    });
    assert.equal(res.status, 409);
    assert.match(String(res.data.error ?? ''), /nhà xe/i);
  });

  test('(4) LOCKED and soft-deleted carriers are rejected on assign (write-time guard)', async () => {
    const locked = await mkCustomer({ isCarrier: true, status: 'LOCKED' });
    const dead = await mkCustomer({ isCarrier: true });
    await db.update(s.customers).set({ deletedAt: new Date() }).where(eq(s.customers.id, dead.id));

    const truck = await mkTruck(4);
    const resLocked = await api(`/${truck.id}`, {
      method: 'PUT',
      ifUnmodifiedSince: (await db.select({ updatedAt: s.trucks.updatedAt }).from(s.trucks).where(eq(s.trucks.id, truck.id)).limit(1))[0]!.updatedAt.toISOString(),
      body: { carrierId: locked.id },
    });
    assert.equal(resLocked.status, 409);

    const resDead = await api(`/${truck.id}`, {
      method: 'PUT',
      ifUnmodifiedSince: (await db.select({ updatedAt: s.trucks.updatedAt }).from(s.trucks).where(eq(s.trucks.id, truck.id)).limit(1))[0]!.updatedAt.toISOString(),
      body: { carrierId: dead.id },
    });
    assert.equal(resDead.status, 409);
  });

  test('(5) unassign with null frees the truck and the filter excludes it', async () => {
    const carrier = await mkCustomer({ isCarrier: true });
    const truck = await mkTruck(5);
    await db.update(s.trucks).set({ carrierId: carrier.id }).where(eq(s.trucks.id, truck.id));
    const stamp = (await db.select({ updatedAt: s.trucks.updatedAt }).from(s.trucks).where(eq(s.trucks.id, truck.id)).limit(1))[0]!.updatedAt.toISOString();

    const unassign = await api<{ carrierId: number | null }>(`/${truck.id}`, {
      method: 'PUT',
      ifUnmodifiedSince: stamp,
      body: { carrierId: null },
    });
    assert.equal(unassign.status, 200, JSON.stringify(unassign.data));
    assert.equal(unassign.data.carrierId, null);

    const filtered = await api<{ items: Array<{ id: number }>; total: number }>(`?carrierId=${carrier.id}`);
    assert.ok(!filtered.data.items.some((t) => t.id === truck.id), 'unassigned truck left the filter');
  });

  test('(6) garbage and unknown filter params 400', async () => {
    const garbage = await api<{ error?: string }>(`?carrierId=abc`);
    assert.equal(garbage.status, 400);
    const unknown = await api<{ error?: string }>(`?driverId=5`);
    assert.equal(unknown.status, 400);
    // Empty param skips the filter (still 200, unfiltered).
    const skipped = await api<{ items: unknown[] }>(`?carrierId=`);
    assert.equal(skipped.status, 200);
  });

  test('(7) create-with-carrierId runs the same validation as update', async () => {
    const carrier = await mkCustomer({ isCarrier: true });
    const plain = await mkCustomer();
    const plate = `31C${suffix.slice(-4)}7`.slice(0, 20);

    const bad = await api<{ error?: string }>('/', {
      method: 'POST',
      body: { licensePlate: plate, carrierId: plain.id },
    });
    assert.equal(bad.status, 409);

    const good = await api<{ id: number; carrierId: number | null }>('/', {
      method: 'POST',
      body: { licensePlate: plate, carrierId: carrier.id },
    });
    assert.equal(good.status, 201, JSON.stringify(good.data));
    assert.equal(good.data.carrierId, carrier.id);
    createdTruckIds.push(good.data.id);
  });

  test('(8) reverse-lock: a soft-deleted carrier blocks new assigns while existing links keep their id', async () => {
    const carrier = await mkCustomer({ isCarrier: true });
    const truck = await mkTruck(8);
    await db.update(s.trucks).set({ carrierId: carrier.id }).where(eq(s.trucks.id, truck.id));
    await db.update(s.customers).set({ deletedAt: new Date() }).where(eq(s.customers.id, carrier.id));

    // The tombstoned carrier's link survives (soft-delete semantics), and the
    // truck still shows in its filter…
    const filtered = await api<{ items: Array<{ id: number }>; total: number }>(`?carrierId=${carrier.id}`);
    assert.ok(filtered.data.items.some((t) => t.id === truck.id));

    // …but no NEW truck may join it.
    const plate = `31D${suffix.slice(-4)}8`.slice(0, 20);
    const res = await api<{ error?: string }>('/', {
      method: 'POST',
      body: { licensePlate: plate, carrierId: carrier.id },
    });
    assert.equal(res.status, 409);
  });
});

after(async () => {
  try {
    if (createdTruckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await client.end();
    process.exit(0);
  }
});
