/**
 * Tombstone plate re-add contract (card 20260926_14, Director ruling (ii)):
 * retiring a truck soft-deletes the row and the tombstone keeps the plate.
 * Re-adding the same plate must answer 409 with a BUSINESS message naming
 * the plate and the trash ("thùng rác") + remedy — never the raw column
 * name, never a 500.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

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

async function api<T>(path: string, options: { method?: string; body?: unknown; extraHeaders?: Record<string, string> } = {}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
    ...options.extraHeaders,
  };
  if ((options.method ?? 'GET') !== 'GET') {
    headers['Idempotency-Key'] = `tombstone-${suffix}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const response = await fetch(`${baseUrl}/api/trucks${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({})) as T;
  return { status: response.status, data };
}

before(async () => {
  await initEnforcer();
  const [user] = await db.insert(s.users).values({
    username: `tombstone-admin-${suffix}`,
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

after(async () => {
  await db.delete(s.trucks).where(eq(s.trucks.licensePlate, `TEST-TOMB-${suffix}`));
  await db.delete(s.users).where(eq(s.users.id, createdUserIds[0]!));
  await client.end({ timeout: 5 });
});

describe('truck tombstone plate re-add (card 20260926_14)', () => {
  test('re-adding a retired plate answers 409 with the plate name and the trash remedy', async () => {
    const plate = `TEST-TOMB-${suffix}`.slice(0, 20);

    const created = await api<{ id: number; licensePlate: string; updatedAt: string }>('', {
      method: 'POST',
      body: { licensePlate: plate },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    createdTruckIds.push((created.data as unknown as { id: number }).id);
    const createdUpdatedAt = (created.data as unknown as { updatedAt: string }).updatedAt;
    assert.ok(createdUpdatedAt, 'create response carries updatedAt');

    const retired = await api<{ ok: boolean }>(`/${(created.data as unknown as { id: number }).id}`, {
      method: 'DELETE',
      body: {},
      extraHeaders: { 'If-Unmodified-Since': createdUpdatedAt },
    });
    assert.equal(retired.status, 200, JSON.stringify(retired.data));

    const reAdded = await api<{ id: number; licensePlate: string; error?: string }>('', {
      method: 'POST',
      body: { licensePlate: plate },
    });
    assert.equal(reAdded.status, 409, JSON.stringify(reAdded.data));
    const message = String((reAdded.data as { error?: string }).error ?? '');
    assert.match(message, new RegExp(plate), 'message names the plate');
    assert.match(message, /thùng rác/, 'message names the trash + remedy');
    assert.doesNotMatch(message, /license_plate/, 'raw column name never leaks');
  });
});
