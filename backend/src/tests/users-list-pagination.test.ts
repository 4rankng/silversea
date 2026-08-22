import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { createUser, listUsers } from '../services/user.service';
import { authMiddleware } from '../middleware/auth';
import authRoutes from '../routes/auth';
import { config } from '../config';
import { globalErrorHandler } from '../middleware/errorHandler';
import { initEnforcer } from '../casbin/enforcer';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
let adminToken: string;
let server: http.Server;
let baseUrl: string;

function authedHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createListTestUser(data: Parameters<typeof createUser>[0]) {
  const user = await createUser(data);
  createdUserIds.push(user.id);
  return user;
}

before(async () => {
  await initEnforcer();

  // Three staff-visible users with distinct sort names: An < Bình < Cường
  // under any collation (distinct ASCII first letters after lower()).
  await createListTestUser({
    username: `ulp-an-${suffix}`,
    fullName: `An ${suffix}`,
    email: `ulp-an-${suffix}@test.local`,
    password: 'admin123',
    role: Role.DRIVER,
  });
  await createListTestUser({
    username: `ulp-binh-${suffix}`,
    fullName: `Bình ${suffix}`,
    password: 'admin123',
    role: Role.ACCOUNTANT,
  });
  await createListTestUser({
    username: `ulp-cuong-${suffix}`,
    fullName: `Cường ${suffix}`,
    password: 'admin123',
    role: Role.DRIVER,
    status: 'INACTIVE',
  });
  const admin = await createListTestUser({
    username: `ulp-admin-${suffix}`,
    fullName: `Admin ${suffix}`,
    password: 'admin123',
    role: Role.ADMIN,
  });
  adminToken = jwt.sign(
    { userId: admin.id, username: admin.username, role: Role.ADMIN },
    config.jwtSecret,
  );

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.get('/protected', authMiddleware, (_req, res) => res.json({ ok: true }));
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  if (createdUserIds.length > 0) {
    await db.delete(s.drivers).where(inArray(s.drivers.userId, createdUserIds));
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await disconnectRedis();
  await client.end();
});

describe('listUsers server-side search/filter/sort/pagination', () => {
  test('search narrows by username across the visible set and reports filtered total', async () => {
    const result = await listUsers(Role.ADMIN, { search: suffix });
    const usernames = result.items.map((row) => row.username);
    assert.equal(result.total, 4);
    assert.equal(usernames.filter((name) => name?.includes(suffix)).length, 4);
    assert.ok(result.items.every((row) => row.customerIds !== undefined));
  });

  test('search matches email as well as username', async () => {
    const result = await listUsers(Role.ADMIN, { search: `ulp-an-${suffix}@test.local` });
    assert.equal(result.total, 1);
    assert.equal(result.items[0]?.username, `ulp-an-${suffix}`);
  });

  test('role filter composes with search', async () => {
    const result = await listUsers(Role.ADMIN, { search: suffix, role: Role.DRIVER });
    assert.equal(result.total, 2);
    assert.ok(result.items.every((row) => row.role === Role.DRIVER));
  });

  test('sort by name asc orders by lower(coalesce(fullName, username))', async () => {
    const result = await listUsers(Role.ADMIN, {
      search: suffix,
      sortBy: 'name',
      sortOrder: 'asc',
    });
    const usernames = result.items.map((row) => row.username);
    assert.deepEqual(usernames, [
      `ulp-admin-${suffix}`,
      `ulp-an-${suffix}`,
      `ulp-binh-${suffix}`,
      `ulp-cuong-${suffix}`,
    ]);
  });

  test('page and limit slice the filtered set without changing total', async () => {
    const full = await listUsers(Role.ADMIN, { search: suffix, sortBy: 'name' });
    const page2 = await listUsers(Role.ADMIN, {
      search: suffix,
      sortBy: 'name',
      page: 2,
      limit: 1,
    });
    assert.equal(full.total, 4);
    assert.equal(page2.items.length, 1);
    assert.equal(page2.total, 4);
    assert.equal(page2.items[0]?.username, full.items[1]?.username);
  });

  test('counts aggregate the full visible set regardless of filters', async () => {
    const result = await listUsers(Role.ADMIN, { search: suffix, role: Role.ACCOUNTANT });
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 1);
    assert.ok((result.counts.byRole[Role.DRIVER] ?? 0) >= 2);
    assert.ok((result.counts.byRole[Role.ACCOUNTANT] ?? 0) >= 1);
    assert.ok(result.counts.staffCount >= 1);
    assert.ok(result.counts.driverCount >= 2);
    assert.ok(result.counts.inactiveCount >= 1);
    const byRoleSum = Object.values(result.counts.byRole).reduce((sum, n) => sum + n, 0);
    assert.equal(byRoleSum, result.counts.total);
  });

  test('non-admin requesters never see ADMIN accounts in items or counts', async () => {
    const result = await listUsers(Role.MANAGER, { search: suffix });
    assert.ok(result.items.every((row) => row.role !== Role.ADMIN));
    assert.equal(result.counts.byRole[Role.ADMIN], undefined);
  });

  test('GET /api/auth/users parses query params end-to-end', async () => {
    const query = new URLSearchParams({
      search: suffix,
      role: Role.DRIVER,
      sortBy: 'name',
      sortOrder: 'asc',
      page: '1',
      limit: '10',
    });
    const response = await fetch(`${baseUrl}/api/auth/users?${query}`, {
      headers: authedHeaders(adminToken),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      items: Array<{ username: string | null; role: string }>;
      total: number;
      counts: { byRole: Record<string, number> };
    };
    assert.equal(body.total, 2);
    assert.deepEqual(
      body.items.map((row) => row.username),
      [`ulp-an-${suffix}`, `ulp-cuong-${suffix}`],
    );
    assert.ok((body.counts.byRole[Role.DRIVER] ?? 0) >= 2);
  });
});
