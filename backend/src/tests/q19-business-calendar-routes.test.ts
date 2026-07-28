import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';

import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdCalendarIds: number[] = [];
const createdIdempotencyKeys = [
  `q19-invalid-date-${suffix}`,
  `q19-create-${suffix}`,
  `q19-update-${suffix}`,
  `q19-delete-${suffix}`,
];
let server: http.Server;
let baseUrl: string;
let adminToken: string;
let managerToken: string;

async function mkUser(username: string, role: Role) {
  const [user] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `user-${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function request(
  path: string,
  init: {
    method?: string;
    token?: string;
    body?: unknown;
    idempotencyKey?: string;
    ifUnmodifiedSince?: string;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  if (init.ifUnmodifiedSince) headers['If-Unmodified-Since'] = init.ifUnmodifiedSince;
  const response = await fetch(`${baseUrl}/api/business-calendar${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

before(async () => {
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
  adminToken = sign(await mkUser(`q19-admin-${suffix}`, Role.ADMIN));
  managerToken = sign(await mkUser(`q19-manager-${suffix}`, Role.MANAGER));
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  if (createdCalendarIds.length > 0) {
    await db.delete(s.businessCalendarDays)
      .where(inArray(s.businessCalendarDays.id, createdCalendarIds));
  }
  await db.delete(s.idempotencyKeys)
    .where(inArray(s.idempotencyKeys.idempotencyKey, createdIdempotencyKeys));
  if (createdUserIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await client.end();
  process.exit(0);
});

describe('Q19 business-calendar route authority and completeness', () => {
  test('non-admin roles cannot read or mutate the shared calendar', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const path = method === 'GET' || method === 'POST' ? '/' : '/999999';
      const response = await request(path, {
        method,
        token: managerToken,
        body: method === 'POST' || method === 'PUT'
          ? { calendarDate: '2097-01-01', name: 'Không được phép' }
          : undefined,
      });
      assert.equal(response.status, 403);
    }
  });

  test('admin CRUD rejects impossible dates', async () => {
    const response = await request('/', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: `q19-invalid-date-${suffix}`,
      body: { calendarDate: '2097-02-30', name: 'Ngày không tồn tại' },
    });
    assert.equal(response.status, 400);
  });

  test('admin CRUD and list return more than 50 rows in calendar order', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({
      calendarDate: `2096-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
      name: `Q19 ${suffix} ${index}`,
      isWorkingDay: index % 2 === 0,
    })).reverse();
    const inserted = await db.insert(s.businessCalendarDays).values(rows)
      .returning({ id: s.businessCalendarDays.id });
    createdCalendarIds.push(...inserted.map((row) => row.id));

    const created = await request('/', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: `q19-create-${suffix}`,
      body: { calendarDate: '2096-12-31', name: `Q19 API ${suffix}`, isWorkingDay: false },
    });
    assert.equal(created.status, 201);
    createdCalendarIds.push(created.body.id);

    const updated = await request(`/${created.body.id}`, {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: `q19-update-${suffix}`,
      ifUnmodifiedSince: created.body.updatedAt,
      body: { name: `Q19 API updated ${suffix}`, isWorkingDay: true },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.isWorkingDay, true);

    const listed = await request('/?limit=500', { token: adminToken });
    assert.equal(listed.status, 200);
    const ownRows = listed.body.items.filter((row: { name: string }) => row.name.includes(suffix));
    assert.equal(ownRows.length, 61);
    assert.deepEqual(
      ownRows.map((row: { calendarDate: string }) => row.calendarDate),
      [...ownRows]
        .map((row: { calendarDate: string }) => row.calendarDate)
        .sort(),
    );

    const deleted = await request(`/${created.body.id}`, {
      method: 'DELETE',
      token: adminToken,
      idempotencyKey: `q19-delete-${suffix}`,
      ifUnmodifiedSince: updated.body.updatedAt,
    });
    assert.equal(deleted.status, 200);
    createdCalendarIds.splice(createdCalendarIds.indexOf(created.body.id), 1);
  });
});
