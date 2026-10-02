/**
 * Card 20260927_66 — /fleet/external management page (dieuvan + admin).
 *
 * Contract under test:
 * - GET  /carrier-fleet-vehicles/all  → union read { catalog, linkedTrucks }
 *   for ADMIN/MANAGER/DISPATCHER (the page's read).
 * - POST/PATCH /carrier-fleet-vehicles widened to DISPATCHER so the
 *   dispatcher can register and toggle external plates (Chief ruling:
 *   "dieuvan and admin right?"). CUS stays denied; MANAGER unaffected.
 * - Deactivation is a PATCH isActive=false — no hard delete exists.
 *
 * In-process server, same assembly as dispatch-fulfillment.test.ts.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import shipmentRoutes from '../routes/shipments';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdVehicleIds: number[] = [];
const createdTruckIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let dispatcherToken = '';
let adminToken = '';
let managerToken = '';
let cusToken = '';
let carrierId = 0;

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `extfleet-${tag}-${suffix}-${createdUserIds.length}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

function signToken(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign({
    userId: user.id,
    username: user.username ?? `user-${user.id}`,
    email: null,
    fullName: null,
    role: user.role as Role,
    customerId: null,
    customerIds: [] as number[],
  }, config.jwtSecret);
}

async function apiFetch<T>(path: string, options: {
  method?: string;
  token?: string;
  body?: unknown;
} = {}): Promise<{ status: number; data: T }> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Idempotency-Key'] = `extfleet-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const response = await fetch(`${baseUrl}/api/shipments${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({})) as T;
  return { status: response.status, data };
}

type FleetRow = { id: number; licensePlate: string; isActive: boolean };

before(async () => {
  await initEnforcer();
  await initAuditService();
  const app = express();
  app.use(express.json());
  app.use('/api/shipments', authMiddleware, auditLogMiddleware, casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const dispatcher = await mkUser(Role.DISPATCHER, 'dv');
  const admin = await mkUser(Role.ADMIN, 'ad');
  const manager = await mkUser(Role.MANAGER, 'mg');
  const cus = await mkUser(Role.CUS, 'cus');
  dispatcherToken = signToken(dispatcher);
  adminToken = signToken(admin);
  managerToken = signToken(manager);
  cusToken = signToken(cus);

  const [carrier] = await db.insert(s.customers).values({
    name: `Ext fleet carrier ${suffix}`,
    isCarrier: true,
    status: 'ACTIVE',
  }).returning();
  createdCustomerIds.push(carrier.id);
  carrierId = carrier.id;
});

after(async () => {
  if (createdVehicleIds.length > 0) {
    await db.delete(s.carrierFleetVehicles).where(inArray(s.carrierFleetVehicles.id, createdVehicleIds));
  }
  if (createdTruckIds.length > 0) {
    await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
  }
  await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  server?.close();
  await disconnectRedis();
  await client.end();
});

describe('GET /carrier-fleet-vehicles/all (union read)', () => {
  test('dispatcher reads the union with both sections present', async () => {
    const res = await apiFetch<{ catalog: FleetRow[]; linkedTrucks: unknown[] }>('/carrier-fleet-vehicles/all', { token: dispatcherToken });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.catalog));
    assert.ok(Array.isArray(res.data.linkedTrucks));
  });

  test('CUS is denied the union read', async () => {
    const res = await apiFetch('/carrier-fleet-vehicles/all', { token: cusToken });
    assert.equal(res.status, 403);
  });
});

describe('DISPATCHER can manage external plates (RBAC widened)', () => {
  test('dispatcher registers a plate → 201, visible in the union', async () => {
    const plate = `29A-${suffix.slice(-4, -1)}.${suffix.slice(-1)}`;
    const created = await apiFetch<FleetRow>('/carrier-fleet-vehicles', {
      method: 'POST',
      token: dispatcherToken,
      body: { carrierId, licensePlate: plate, isActive: true },
    });
    assert.equal(created.status, 201);
    createdVehicleIds.push(created.data.id);

    const union = await apiFetch<{ catalog: FleetRow[] }>('/carrier-fleet-vehicles/all', { token: dispatcherToken });
    const row = union.data.catalog.find((r) => r.id === created.data.id);
    assert.ok(row, 'created plate must appear in the union read');
    assert.equal(row.isActive, true);
  });

  test('dispatcher toggles isActive → resolve-carrier returns nulls (no hard delete)', async () => {
    const plate = `30B-${suffix.slice(-4, -1)}.${suffix.slice(-1)}`;
    const created = await apiFetch<FleetRow>('/carrier-fleet-vehicles', {
      method: 'POST',
      token: dispatcherToken,
      body: { carrierId, licensePlate: plate, isActive: true },
    });
    assert.equal(created.status, 201);
    createdVehicleIds.push(created.data.id);

    const toggled = await apiFetch<FleetRow>(`/carrier-fleet-vehicles/${created.data.id}`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { isActive: false },
    });
    assert.equal(toggled.status, 200);
    assert.equal(toggled.data.isActive, false);

    const resolve = await apiFetch<{ carrierId: number | null }>(
      `/carrier-fleet-vehicles/resolve-carrier?plate=${encodeURIComponent(plate)}`,
      { token: dispatcherToken },
    );
    assert.equal(resolve.status, 200);
    assert.equal(resolve.data.carrierId, null, 'inactive plate must not resolve to its carrier');
  });

  test('CUS is still denied the writes (403)', async () => {
    const res = await apiFetch('/carrier-fleet-vehicles', {
      method: 'POST',
      token: cusToken,
      body: { carrierId, licensePlate: '99Z-99.999', isActive: true },
    });
    assert.equal(res.status, 403);
  });

  test('MANAGER unaffected by the widening (regression guard)', async () => {
    const res = await apiFetch<FleetRow>('/carrier-fleet-vehicles', {
      method: 'POST',
      token: managerToken,
      body: { carrierId, licensePlate: `31C-${suffix.slice(-4, -1)}.${suffix.slice(-1)}`, isActive: true },
    });
    assert.equal(res.status, 201);
    createdVehicleIds.push(res.data.id);
    assert.equal((await apiFetch('/carrier-fleet-vehicles/all', { token: adminToken })).status, 200);
  });
});
