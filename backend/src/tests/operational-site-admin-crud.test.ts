/**
 * Card 20261002_263 (R29) — factory/warehouse master-data CRUD for
 * Chứng từ (CUS) and Điều vận (DISPATCHER), through the REAL app mount.
 *
 * Boots a throwaway Express app on an ephemeral port (mirrors
 * `shipment-routes.test.ts` — Node `http` + `fetch`, no supertest), mounts
 * `/api/shipments` with the production `authMiddleware + casbinAuthz('shipments')`
 * chain, and drives the `/operational-sites` family end to end so the role
 * matrix below reflects the shipped requireRoles guards exactly.
 *
 * Coverage (R29 acceptance criteria):
 *   - Read + edit already served to CUS/DISPATCHER (regression guard for the
 *     existing grants — GET /operational-sites/admin, PATCH /:id).
 *   - NEW DELETE /operational-sites/:id: allowed for ADMIN/MANAGER/CUS/
 *     DISPATCHER, 403 for ACCOUNTANT/OPS/DRIVER, 404 on unknown or already-
 *     deleted id (replay-safe), 409 with a Vietnamese business message when a
 *     live shipment still references the site.
 *   - A deleted site's (customerId, code) is re-creable — the partial unique
 *     index only covers live rows.
 *   - The deleted site disappears from the admin list.
 *
 * Hits the real Postgres DB and the real Casbin enforcer (initEnforcer). All
 * seeded rows are cleaned up in `after` in reverse-FK order.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import shipmentRoutes from '../routes/shipments';
import { authMiddleware } from '../middleware/auth';
import { auditLogMiddleware } from '../middleware/audit';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdSiteIds: number[] = [];
const createdShipmentIds: number[] = [];

let adminToken: string;
let managerToken: string;
let cusToken: string;
let dispatcherToken: string;
let accountantToken: string;
let opsToken: string;
let driverToken: string;

let customerId: number;
let routeId: number;
let freeSiteId: number;
let referencedSiteId: number;
let warehouseSiteId: number;

let server: http.Server;
let baseUrl: string;

async function mkUser(username: string, role: Role) {
  const [u] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
  }).returning();
  createdUserIds.push(u.id);
  return u;
}

function sign(u: { id: number; username: string | null; role: Role | string }) {
  // Token shape must match `AuthUser` in middleware/auth.ts.
  return jwt.sign(
    {
      userId: u.id,
      username: u.username ?? u.id.toString(),
      role: u.role as Role,
      customerId: null,
      customerIds: undefined,
    },
    config.jwtSecret,
  );
}

interface TestFetchOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

async function testFetch(urlPath: string, options: TestFetchOptions = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(`${baseUrl}/api/shipments${urlPath}`, {
    method: options.method ?? 'GET',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

before(async () => {
  await initAuditService();
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use('/api/shipments', authMiddleware, auditLogMiddleware, casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const admin = await mkUser(`osa-admin-${suffix}`, Role.ADMIN);
  const manager = await mkUser(`osa-manager-${suffix}`, Role.MANAGER);
  const cus = await mkUser(`osa-cus-${suffix}`, Role.CUS);
  const dispatcher = await mkUser(`osa-dispatcher-${suffix}`, Role.DISPATCHER);
  const accountant = await mkUser(`osa-accountant-${suffix}`, Role.ACCOUNTANT);
  const ops = await mkUser(`osa-ops-${suffix}`, Role.OPS);
  const driver = await mkUser(`osa-driver-${suffix}`, Role.DRIVER);

  adminToken = sign(admin);
  managerToken = sign(manager);
  cusToken = sign(cus);
  dispatcherToken = sign(dispatcher);
  accountantToken = sign(accountant);
  opsToken = sign(ops);
  driverToken = sign(driver);

  const [customer] = await db.insert(s.customers)
    .values({ name: `OpSiteAdmin customer ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  customerId = customer.id;

  const [route] = await db.insert(s.routes)
    .values({ name: `OpSiteAdmin route ${suffix}` }).returning();
  createdRouteIds.push(route.id);
  routeId = route.id;

  // A FACTORY free of any shipment reference (happy-path delete) and a
  // WAREHOUSE for the re-create test, plus a FACTORY a live shipment points
  // at (the 409 guard).
  const [freeSite] = await db.insert(s.operationalSites).values({
    customerId, code: `OSAF-${suffix}`, name: `Nhà máy trống ${suffix}`,
    siteType: 'FACTORY', routeId, address: `Địa chỉ ${suffix}`,
  }).returning();
  createdSiteIds.push(freeSite.id);
  freeSiteId = freeSite.id;

  const [warehouseSite] = await db.insert(s.operationalSites).values({
    customerId, code: `OSAW-${suffix}`, name: `Kho xóa ${suffix}`,
    siteType: 'WAREHOUSE', address: `Địa chỉ ${suffix}`,
  }).returning();
  createdSiteIds.push(warehouseSite.id);
  warehouseSiteId = warehouseSite.id;

  const [referencedSite] = await db.insert(s.operationalSites).values({
    customerId, code: `OSAR-${suffix}`, name: `Nhà máy đang chạy ${suffix}`,
    siteType: 'FACTORY', routeId, address: `Địa chỉ ${suffix}`,
  }).returning();
  createdSiteIds.push(referencedSite.id);
  referencedSiteId = referencedSite.id;

  const [shipment] = await db.insert(s.shipments).values({
    customerId, operationalSiteId: referencedSiteId,
  }).returning();
  createdShipmentIds.push(shipment.id);
});

after(async () => {
  try {
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdSiteIds.length > 0) {
      await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdSiteIds));
    }
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } catch (err) {
    console.warn('[operational-site-admin-crud.test] cleanup partial:', (err as Error).message);
  }
  // Mirrors shipment-routes.test.ts: the ephemeral server and the pg pool keep
  // the event loop alive after tests pass — close them and exit hard (the
  // isolated runner discards this throwaway DB clone anyway).
  try { await client.end(); } catch { /* ignore */ }
  server.closeAllConnections();
  server.close();
  process.exit(0);
});

describe('operational-sites admin family — R29 role matrix through the real mount', () => {
  test('read + edit stay served to Chứng từ and Điều vận (existing grants regression)', async () => {
    const cusRead = await testFetch('/operational-sites/admin', { token: cusToken });
    assert.equal(cusRead.status, 200);
    assert.ok(cusRead.data.items.some((row: { id: number }) => row.id === freeSiteId));

    const dispatcherRead = await testFetch('/operational-sites/admin', { token: dispatcherToken });
    assert.equal(dispatcherRead.status, 200);

    const accountantRead = await testFetch('/operational-sites/admin', { token: accountantToken });
    assert.equal(accountantRead.status, 403);

    const [site] = await db.select().from(s.operationalSites).where(eq(s.operationalSites.id, freeSiteId));
    const cusPatch = await testFetch(`/operational-sites/${freeSiteId}`, {
      method: 'PATCH', token: cusToken,
      body: { expectedVersion: site.version, name: `Nhà máy trống sửa ${suffix}` },
    });
    assert.equal(cusPatch.status, 200);
  });

  test('DELETE works for Chứng từ and Điều vận', async () => {
    const cusDelete = await testFetch(`/operational-sites/${warehouseSiteId}`, { method: 'DELETE', token: cusToken });
    assert.equal(cusDelete.status, 200, `CUS delete expected 200, got ${cusDelete.status}: ${JSON.stringify(cusDelete.data)}`);
    assert.equal(cusDelete.data.ok, true);

    const dispatcherDelete = await testFetch(`/operational-sites/${freeSiteId}`, { method: 'DELETE', token: dispatcherToken });
    assert.equal(dispatcherDelete.status, 200, `DISPATCHER delete expected 200, got ${dispatcherDelete.status}: ${JSON.stringify(dispatcherDelete.data)}`);

    const [deletedRow] = await db.select().from(s.operationalSites).where(eq(s.operationalSites.id, warehouseSiteId));
    assert.ok(deletedRow.deletedAt, 'soft-delete stamps deleted_at');
  });

  test('DELETE stays blocked for ACCOUNTANT, OPS and DRIVER', async () => {
    for (const [label, token] of [['ACCOUNTANT', accountantToken], ['OPS', opsToken], ['DRIVER', driverToken]] as const) {
      const res = await testFetch('/operational-sites/999999999', { method: 'DELETE', token });
      assert.equal(res.status, 403, `${label} delete expected 403, got ${res.status}`);
    }
  });

  test('DELETE is replay-safe and the code is re-creable', async () => {
    // warehouseSiteId was deleted in the earlier test; the replay lands on
    // the deterministic 404 (row already gone), not a duplication.
    const replay = await testFetch(`/operational-sites/${warehouseSiteId}`, { method: 'DELETE', token: cusToken });
    assert.equal(replay.status, 404);

    const recreate = await testFetch('/operational-sites', {
      method: 'POST', token: cusToken,
      body: {
        customerId, code: `OSAW-${suffix}`, name: `Kho xóa tái tạo ${suffix}`,
        siteType: 'WAREHOUSE', address: `Địa chỉ ${suffix}`,
      },
    });
    assert.equal(recreate.status, 201, `re-create expected 201, got ${recreate.status}: ${JSON.stringify(recreate.data)}`);
    createdSiteIds.push(recreate.data.id);

    const adminList = await testFetch('/operational-sites/admin', { token: adminToken });
    assert.equal(adminList.status, 200);
    assert.ok(!adminList.data.items.some((row: { id: number }) => row.id === warehouseSiteId), 'deleted site leaves the admin list');

    // MANAGER already held the delete action at the mount level; the re-created
    // row gives that cell a live assertion too.
    const managerDelete = await testFetch(`/operational-sites/${recreate.data.id}`, { method: 'DELETE', token: managerToken });
    assert.equal(managerDelete.status, 200, `MANAGER delete expected 200, got ${managerDelete.status}`);
  });

  test('a live shipment reference refuses deletion with a business message', async () => {
    const res = await testFetch(`/operational-sites/${referencedSiteId}`, { method: 'DELETE', token: adminToken });
    assert.equal(res.status, 409, `referenced delete expected 409, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.match(String(res.data.error), /lô hàng/);

    const [stillLive] = await db.select().from(s.operationalSites).where(eq(s.operationalSites.id, referencedSiteId));
    assert.equal(stillLive.deletedAt, null, 'referenced site is NOT soft-deleted');
  });
});
