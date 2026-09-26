/**
 * External-plate management wave (card 20260926_18):
 * 1. Tombstone restore (R1): POST /trucks/:id/restore answers 200 + revives
 *    the soft-deleted row; second call 404s; dispatcher 403s.
 * 2. Free-text external plates auto-register into trucks (R3): assigning via
 *    resolveDispatchVehicleAssignment inserts a trucks row for the carrier
 *    when the plate is brand-new; an owned plate (tombstone or live, any
 *    owner) skips registration.
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
import { resolveDispatchVehicleAssignment } from '../services/dispatch-planning-detail-plan.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdTruckIds: number[] = [];
let server: http.Server;
let baseUrl = '';
let adminToken = '';
let dispatcherToken = '';

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

async function api<T>(path: string, options: { method?: string; body?: unknown; token?: string; extraHeaders?: Record<string, string> } = {}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.token ?? adminToken}`,
    ...options.extraHeaders,
  };
  if ((options.method ?? 'GET') !== 'GET') {
    headers['Idempotency-Key'] = `truck-restore-${suffix}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const response = await fetch(`${baseUrl}/api/trucks${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({})) as T;
  return { status: response.status, data };
}

async function createTruckViaApi(plate: string, token?: string): Promise<{ id: number; updatedAt: string }> {
  const created = await api<{ id: number; updatedAt: string }>('', {
    method: 'POST',
    token,
    body: { licensePlate: plate },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data as { id: number; updatedAt: string };
}

async function truckRow(id: number): Promise<{ deletedAt: Date | null } | undefined> {
  const [row] = await db.select({ deletedAt: s.trucks.deletedAt }).from(s.trucks).where(eq(s.trucks.id, id)).limit(1);
  return row;
}

before(async () => {
  await initEnforcer();
  const [admin] = await db.insert(s.users).values({
    username: `tr-restore-admin-${suffix}`,
    passwordHash: await bcrypt.hash('x', 10),
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(admin.id);
  adminToken = signToken({ id: admin.id, username: admin.username, role: Role.ADMIN });

  const [dispatcher] = await db.insert(s.users).values({
    username: `tr-restore-disp-${suffix}`,
    passwordHash: await bcrypt.hash('x', 10),
    role: Role.DISPATCHER,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(dispatcher.id);
  dispatcherToken = signToken({ id: dispatcher.id, username: dispatcher.username, role: Role.DISPATCHER });

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
  await db.delete(s.trucks).where(eq(s.trucks.id, createdTruckIds[0]!));
  await db.delete(s.trucks).where(eq(s.trucks.id, createdTruckIds[1]!));
  await db.delete(s.users).where(eq(s.users.id, createdUserIds[0]!));
  await db.delete(s.users).where(eq(s.users.id, createdUserIds[1]!));
  await client.end({ timeout: 5 });
});

describe('truck tombstone restore (card 20260926_18 R1)', () => {
  test('admin restores a tombstoned plate; repeat 404s; dispatcher 403s', async () => {
    const plate = `TR-${suffix}`.slice(0, 20);
    const created = await createTruckViaApi(plate);
    createdTruckIds.push(created.id);

    const retired = await api(`/${created.id}`, { method: 'DELETE', body: {}, extraHeaders: { 'If-Unmodified-Since': created.updatedAt } });
    assert.equal(retired.status, 200, JSON.stringify(retired.data));
    assert.ok((await truckRow(created.id))?.deletedAt, 'retire tombstones the row');

    const restored = await api(`/${created.id}/restore`, { method: 'POST', body: {} });
    assert.equal(restored.status, 200, JSON.stringify(restored.data));
    assert.equal((await truckRow(created.id))?.deletedAt, null, 'restore revives the row');

    const again = await api(`/${created.id}/restore`, { method: 'POST', body: {} });
    assert.equal(again.status, 404, 'restoring a LIVE truck 404s');
  });

  test('dispatcher is refused restore (symmetry with retire)', async () => {
    const plate = `TR2-${suffix}`.slice(0, 20);
    const created = await createTruckViaApi(plate);
    createdTruckIds.push(created.id);
    await api(`/${created.id}`, { method: 'DELETE', body: {}, extraHeaders: { 'If-Unmodified-Since': created.updatedAt } });
    const refused = await api(`/${created.id}/restore`, { method: 'POST', body: {}, token: dispatcherToken });
    assert.equal(refused.status, 403);
  });
});

describe('free-text external plate auto-registration (card 20260926_18 R3)', () => {
  test('brand-new plate inserts a trucks row owned by the carrier', async () => {
    const plate = `R3-${suffix}`.slice(0, 20);
    await resolveDispatchVehicleAssignment(db as never, {
      carrierType: 'EXTERNAL',
      plannedExternalCarrierId: 999999,
      truckId: null,
      externalCarrierVehicleId: null,
      plateNumber: plate,
      clear: false,
    });
    const key = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const rows = await db.select().from(s.trucks);
    const row = rows.find((r) => key(r.licensePlate || '') === key(plate));
    assert.ok(row, `trucks row registered for ${key(plate)}`);
    assert.equal(row.carrierId, 999999);
    createdTruckIds.push(row.id);
  });

  test('a plate already owned by any carrier skips registration', async () => {
    const plate = `R3B-${suffix}`.slice(0, 20);
    await resolveDispatchVehicleAssignment(db as never, {
      carrierType: 'EXTERNAL',
      plannedExternalCarrierId: 888888,
      truckId: null,
      externalCarrierVehicleId: null,
      plateNumber: plate,
      clear: false,
    });
    await resolveDispatchVehicleAssignment(db as never, {
      carrierType: 'EXTERNAL',
      plannedExternalCarrierId: 777777,
      truckId: null,
      externalCarrierVehicleId: null,
      plateNumber: plate,
      clear: false,
    });
    const key2 = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const rows = await db.select().from(s.trucks);
    const owned = rows.filter((r) => key2(r.licensePlate || '') === key2(plate));
    assert.equal(owned.length, 1, 'owned plate must not duplicate');
    createdTruckIds.push(owned[0]!.id);
  });
});
