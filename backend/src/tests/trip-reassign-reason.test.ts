/**
 * Card 20260922_79 — reassignment reason contract (Q11 closure).
 *
 * PATCH /trips/:id/reassign must reject a missing/blank reason with 400 and,
 * on success, persist actor + timestamp + reason TOGETHER in audit_logs (the
 * operational record per ruling 11). The audit middleware stays ACTIVE in
 * this app (route-tests-need-audit-middleware: runIdempotent audit no-ops
 * without the request context — here the middleware itself is the recorder).
 * Persistence is proven by DB transcript, not handler signature.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { desc, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import tripRoutes from '../routes/trips';
import { authMiddleware } from '../middleware/auth';
import { tripRouteAuthz } from '../middleware/casbin';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `q79-${Date.now().toString(36)}`;
const created = {
  userIds: [] as number[],
  customerIds: [] as number[],
  routeIds: [] as number[],
  truckIds: [] as number[],
  driverIds: [] as number[],
  tripIds: [] as number[],
};

let server: http.Server;
let baseUrl = '';
let dispatcherToken = '';
let dispatcherUserId = 0;
let adminToken = '';
let adminUserId = 0;

function signToken(userId: number, role: Role, username: string): string {
  return jwt.sign({
    userId,
    username,
    email: null,
    fullName: 'Người test',
    role,
    customerId: null,
    customerIds: [],
  }, config.jwtSecret);
}

async function mkUser(role: Role, tag: string): Promise<void> {
  const [user] = await db.insert(s.users).values({
    username: `q79-${tag}-${suffix}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
    status: 'ACTIVE',
  }).returning();
  created.userIds.push(user.id);
  if (role === Role.DISPATCHER) {
    dispatcherUserId = user.id;
    dispatcherToken = signToken(user.id, role, user.username ?? `disp-${user.id}`);
  } else {
    adminUserId = user.id;
    adminToken = signToken(user.id, role, user.username ?? `admin-${user.id}`);
  }
}

async function apiFetch(path: string, options: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `q79-${suffix}-${Math.random().toString(36).slice(2, 10)}`,
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

before(async () => {
  await initAuditService();
  await initEnforcer();
  await mkUser(Role.DISPATCHER, 'disp');
  await mkUser(Role.ADMIN, 'admin');

  const app = express();
  app.use(express.json());
  app.use('/api/trips', authMiddleware, auditLogMiddleware, tripRouteAuthz(), tripRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

async function mkReassignableTrip(): Promise<{ tripId: number; truckId: number; driverId: number }> {
  const n = created.tripIds.length + 1;
  const [customer] = await db.insert(s.customers).values({ name: `Q79 customer ${suffix} #${n}` }).returning();
  created.customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Q79 route ${suffix} #${n}` }).returning();
  created.routeIds.push(route.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `Q79-${suffix.slice(-6)}-${created.truckIds.length}`,
    status: 'ACTIVE',
  }).returning();
  created.truckIds.push(truck.id);
  const [driver] = await db.insert(s.drivers).values({
    name: `Q79 driver ${suffix}`,
    status: 'ACTIVE',
    baseSalary: '12000000',
  }).returning();
  created.driverIds.push(driver.id);
  const [trip] = await db.insert(s.trips).values({
    customerId: customer.id,
    routeId: route.id,
    truckId: truck.id,
    driverId: driver.id,
    status: 'CREATED',
    departureDate: '2026-09-20',
  }).returning();
  created.tripIds.push(trip.id);
  return { tripId: trip.id, truckId: truck.id, driverId: driver.id };
}

describe('reassign reason contract (card 20260922_79)', () => {
  test('missing reason → 400 with a clear message (A1)', async () => {
    const tripId = await mkReassignableTrip();
    const res = await apiFetch(`/api/trips/${tripId}/reassign`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { carrierType: 'OWN', truckId: 999999, driverId: 999999 },
    });
    assert.equal(res.status, 400);
    assert.equal((res.data as { error?: string }).error, 'Lý do điều chuyển là bắt buộc');
  });

  test('blank reason → 400 (A1)', async () => {
    const tripId = await mkReassignableTrip();
    const res = await apiFetch(`/api/trips/${tripId}/reassign`, {
      method: 'PATCH',
      token: dispatcherToken,
      body: { carrierType: 'OWN', truckId: 999999, driverId: 999999, reason: '   ' },
    });
    assert.equal(res.status, 400);
    assert.equal((res.data as { error?: string }).error, 'Lý do điều chuyển là bắt buộc');
  });

  test('success persists actor + timestamp + reason together in audit_logs (A3)', async () => {
    const { tripId, truckId, driverId } = await mkReassignableTrip();
    const reason = `Tai xe xin nghi ${suffix}`;
    const res = await apiFetch(`/api/trips/${tripId}/reassign`, {
      method: 'PATCH',
      token: adminToken,
      body: { carrierType: 'OWN', truckId, driverId, reason },
    });
    assert.equal(res.status, 200);
    const rows = await db.select().from(s.auditLogs)
      .where(eq(s.auditLogs.entityType, 'trips'))
      .orderBy(desc(s.auditLogs.id)).limit(5);
    const hit = rows.find((r) => JSON.stringify(r.payload ?? {}).includes(reason));
    assert.ok(hit, 'audit row carrying the reason must exist');
    assert.equal(hit.userId, adminUserId);
    assert.ok(hit.timestamp, 'audit timestamp present');
    const payload = (hit.payload ?? {}) as Record<string, unknown>;
    const body = (payload.body ?? payload) as Record<string, unknown>;
    assert.equal(body.reason, reason);
  });
});

after(async () => {
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (created.tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, created.tripIds));
  if (created.driverIds.length) await db.delete(s.drivers).where(inArray(s.drivers.id, created.driverIds));
  if (created.truckIds.length) {
    await db.delete(s.trucks).where(inArray(s.trucks.id, created.truckIds));
  }
  if (created.routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, created.routeIds));
  if (created.customerIds.length) {
    await db.delete(s.customers).where(inArray(s.customers.id, created.customerIds));
  }
  if (created.userIds.length) await db.delete(s.users).where(inArray(s.users.id, created.userIds));
  await client.end();
});