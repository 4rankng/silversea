// Card 20261005 — màn hình cấu hình giá Nâng/Hạ theo cảng (step 7b):
// POST /api/port-zone-surcharges tạo được dòng giá cho một cảng, và lô có
// container dùng cảng đó resolve được phí nâng/hạ từ CONFIG thay vì null.
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
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import catalogRouter from '../routes/config/catalog-crud.routes';
import { globalErrorHandler } from '../middleware/errorHandler';
import { resolveLotZoneSurcharge, ZONE_SURCHARGE_KIND } from '../services/zone-surcharge.service';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-pzsc-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const customerIds: number[] = [];
const shipmentIds: number[] = [];
const portIds: number[] = [];
const containerIds: number[] = [];
const surchargeIds: number[] = [];
let server: http.Server;
let baseUrl: string;
let adminToken: string;

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `user-${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

function request(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string }) {
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

/** Port fixture — same shape as debit-zone-surcharge.test.ts. */
async function mkPort(): Promise<number> {
  const [port] = await db.insert(s.ports).values({
    name: `PZSC port ${suffix} ${portIds.length}`,
    code: `PZ${portIds.length}-${Date.now().toString(36)}`,
    dispatchZone: 'LACH_HUYEN',
  }).returning();
  portIds.push(port.id);
  return port.id;
}

/** One-container lot with explicit pickup/dropoff port ends (card 20260922_63
 *  per-lift rule: each container end at a fee-configured port counts once). */
async function mkLotWithEnds(pickupPortId: number, dropoffPortId: number | null): Promise<number> {
  const [customer] = await db.insert(s.customers).values({ name: `PZSC customer ${suffix} ${customerIds.length}` }).returning();
  customerIds.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    shipmentCode: `PZSC-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    createdBy: 1,
  }).returning();
  shipmentIds.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerNumber: `PZ${shipmentIds.length}${suffix.slice(-4)}`.toUpperCase(),
    pickupPortId,
    dropoffPortId,
  }).returning();
  containerIds.push(container.id);
  return shipment.id;
}

before(async () => {
  await initEnforcer();
  const [admin] = await db.insert(s.users).values({
    username: `pzsc-admin-${suffix}`,
    passwordHash: await bcrypt.hash('Abc123', 10),
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(admin.id);
  adminToken = sign(admin);
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('config'), catalogRouter);
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
  try {
    await db.delete(s.portZoneSurcharges).where(inArray(s.portZoneSurcharges.id, surchargeIds));
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, containerIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.ports).where(inArray(s.ports.id, portIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } catch { /* best-effort */ }
  server?.close();
  await client.end();
  await disconnectRedis();
});

describe('port-zone-surcharges config (step 7b)', () => {
  test('POST /api/port-zone-surcharges creates the price row and the lot resolves CONFIG', async () => {
    const portId = await mkPort();
    const shipmentId = await mkLotWithEnds(portId, null);
    // Before the config row exists the ladder has nothing to read.
    assert.equal(await resolveLotZoneSurcharge(shipmentId), null);

    const response = await request('/api/port-zone-surcharges', {
      method: 'POST',
      idempotencyKey: `pzsc-${suffix}-create`,
      body: { portId, kindSlug: ZONE_SURCHARGE_KIND, label: 'Phí nâng/hạ Lạch Huyện', amount: 500000 },
    });
    assert.equal(response.status, 201);
    const row = await response.json() as { id: number; portId: number; kindSlug: string; label: string; amount: string };
    surchargeIds.push(row.id);
    assert.equal(row.portId, portId);
    assert.equal(row.kindSlug, ZONE_SURCHARGE_KIND);
    assert.equal(row.label, 'Phí nâng/hạ Lạch Huyện');

    // One pickup end at the configured port = 1 lift × 500.000.
    const resolved = await resolveLotZoneSurcharge(shipmentId);
    assert.deepEqual(resolved, { label: 'Phí nâng/hạ Lạch Huyện', amount: 500000, source: 'CONFIG' });
  });

  test('CONFIG rung counts every lift/drop at the configured port', async () => {
    const liftPortId = await mkPort();
    const dropPortId = await mkPort();
    const shipmentId = await mkLotWithEnds(liftPortId, dropPortId);

    for (const portId of [liftPortId, dropPortId]) {
      const response = await request('/api/port-zone-surcharges', {
        method: 'POST',
        idempotencyKey: `pzsc-${suffix}-${portId}`,
        body: { portId, kindSlug: ZONE_SURCHARGE_KIND, label: 'Phí nâng/hạ Lạch Huyện', amount: 500000 },
      });
      assert.equal(response.status, 201);
      const row = await response.json() as { id: number };
      surchargeIds.push(row.id);
    }

    // lift + drop both at fee-configured ports = 2 × 500.000.
    const resolved = await resolveLotZoneSurcharge(shipmentId);
    assert.deepEqual(resolved, { label: 'Phí nâng/hạ Lạch Huyện', amount: 1000000, source: 'CONFIG' });
  });

  test('kindSlug is structural — a hand-entered kind is rejected', async () => {
    const portId = await mkPort();
    const response = await request('/api/port-zone-surcharges', {
      method: 'POST',
      idempotencyKey: `pzsc-${suffix}-kind`,
      body: { portId, kindSlug: 'custom-kind', label: 'Sai loại phí', amount: 1000 },
    });
    assert.equal(response.status, 400);
  });
});
