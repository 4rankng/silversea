/**
 * Route-level OPS shipment-scope tests for private trip photos.
 *
 * The photo-serving branch (routes/upload.ts) verifies user_shipment_links
 * for OPS callers before sendFile. photo-authz.test.ts pins the
 * expense-receipt matrix at the service level; THIS file pins the trip-photo
 * branch through the authenticated HTTP route: assigned OPS retrieves,
 * unassigned and revoked OPS get the same 403 as the trip detail, absent
 * trips never oracle, and the DRIVER/office behaviors stay put.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import { client, db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { photosRouter } from '../routes/upload';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const shipmentIds: number[] = [];
const tripIds: number[] = [];
const linkIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let photoKey = '';
let opsAssignedToken = '';
let opsOutsideToken = '';
let driverToken = '';
let adminToken = '';

function tokenFor(userId: number, role: string) {
  return jwt.sign({ userId, role }, config.jwtSecret, { expiresIn: '1h' });
}

async function ensureUser(username: string, role: Role) {
  const [user] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('test-only', 4),
    role,
    status: 'ACTIVE',
  }).returning();
  userIds.push(user.id);
  return user;
}

before(async () => {
  await initEnforcer();

  // OPS pair: one assigned to the shipment, one that never was.
  const opsAssigned = await ensureUser(`qa127-ops-in-${suffix}`, Role.OPS);
  const opsOutside = await ensureUser(`qa127-ops-out-${suffix}`, Role.OPS);
  const driverUser = await ensureUser(`qa127-drv-${suffix}`, Role.DRIVER);
  const adminUser = await ensureUser(`qa127-adm-${suffix}`, Role.ADMIN);
  opsAssignedToken = tokenFor(opsAssigned.id, 'OPS');
  opsOutsideToken = tokenFor(opsOutside.id, 'OPS');
  driverToken = tokenFor(driverUser.id, 'DRIVER');
  adminToken = tokenFor(adminUser.id, 'ADMIN');

  const [customer] = await db.insert(s.customers).values({
    name: `QA127 customer ${suffix}`,
  }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({
    name: `QA127 route ${suffix}`,
  }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoMode: 'FCL',
    shipmentCode: `QA127-${suffix}`,
    status: 'READY_FOR_DISPATCH',
    createdBy: adminUser.id,
  }).returning();
  shipmentIds.push(shipment.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `QA127-${suffix}`,
    customerId: customer.id,
    routeId: route.id,
    shipmentId: shipment.id,
    departureDate: '2026-09-14',
    status: 'CREATED',
  }).returning();
  tripIds.push(trip.id);

  const [link] = await db.insert(s.userShipmentLinks).values({
    userId: opsAssigned.id,
    shipmentId: shipment.id,
  }).returning();
  linkIds.push(link.id);

  // A real file behind the key so the happy path can 200 (sendFile).
  const uploadDir = path.resolve(config.uploadDir || path.join(process.cwd(), 'uploads'));
  photoKey = `trips/${trip.id}/qa127-${suffix}.jpg`;
  const filePath = path.join(uploadDir, photoKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'qa127-test-photo');

  const app = express();
  app.use(express.json());
  app.use('/api/photos', authMiddleware, casbinAuthz('photos'), photosRouter);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  const uploadDir = path.resolve(config.uploadDir || path.join(process.cwd(), 'uploads'));
  fs.rmSync(path.join(uploadDir, `trips/${tripIds[0]}`), { recursive: true, force: true });
  if (linkIds.length) await db.delete(s.userShipmentLinks).where(eq(s.userShipmentLinks.id, linkIds[0]));
  if (tripIds.length) await db.delete(s.trips).where(eq(s.trips.id, tripIds[0]));
  if (shipmentIds.length) await db.delete(s.shipments).where(eq(s.shipments.id, shipmentIds[0]));
  if (routeIds.length) await db.delete(s.routes).where(eq(s.routes.id, routeIds[0]));
  if (customerIds.length) await db.delete(s.customers).where(eq(s.customers.id, customerIds[0]));
  for (const id of userIds) await db.delete(s.users).where(eq(s.users.id, id));
  await server.close();
  await client.end();
});

async function fetchPhoto(token: string, key: string) {
  const res = await fetch(`${baseUrl}/api/photos/${key}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.text() };
}

describe('trip photo OPS shipment scope (route level)', () => {
  test('AC1 — assigned OPS retrieves the trip photo', async () => {
    const r = await fetchPhoto(opsAssignedToken, photoKey);
    assert.equal(r.status, 200);
    assert.equal(r.body, 'qa127-test-photo');
  });

  test('AC2 — OPS never assigned to the shipment is denied the same key', async () => {
    const r = await fetchPhoto(opsOutsideToken, photoKey);
    assert.equal(r.status, 403);
    assert.match(r.body, /Không có quyền truy cập ảnh của chuyến đi này/);
  });

  test('AC2 — revoking the assignment denies the previously assigned OPS', async () => {
    await db.delete(s.userShipmentLinks).where(eq(s.userShipmentLinks.id, linkIds[0]));
    const r = await fetchPhoto(opsAssignedToken, photoKey);
    assert.equal(r.status, 403);
    assert.match(r.body, /Không có quyền truy cập ảnh của chuyến đi này/);
  });

  test('AC4 — absent trip id yields the same denial, no existence oracle', async () => {
    const r = await fetchPhoto(opsOutsideToken, 'trips/999999999/qa127-none.jpg');
    assert.equal(r.status, 403);
    assert.match(r.body, /Không có quyền truy cập ảnh của chuyến đi này/);
  });

  test('AC3 — DRIVER ownership behavior unchanged (out-of-profile driver denied)', async () => {
    const r = await fetchPhoto(driverToken, photoKey);
    assert.equal(r.status, 403);
  });

  test('AC3 — office ADMIN still retrieves without a shipment link', async () => {
    const r = await fetchPhoto(adminToken, photoKey);
    assert.equal(r.status, 200);
  });
});
