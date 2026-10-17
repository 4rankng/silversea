/**
 * FB-114 verify-fail (ticket 171026185348) — the Hãng tàu dialog on
 * `/shipments/new` must persist into the SHARED catalog on the server, not
 * only the lot's form field. `POST /api/shipments/shipping-lines` mints the
 * SHIPPING_LINE supplier the bootstrap `shippingLines` list derives from
 * (config.service.ts), so the name survives reload for every user.
 *
 * Boots a throwaway Express app on an ephemeral port (mirrors
 * `operational-site-admin-crud.test.ts` — Node `http` + `fetch`, no supertest),
 * mounts `/api/shipments` with the production `authMiddleware +
 * casbinAuthz('shipments')` chain, and drives the endpoint end to end so the
 * role matrix reflects the shipped requireRoles guard exactly.
 *
 * Coverage (case 2026-10-17-card-fb114-shipping-line-server-persist):
 *   - create → 201, supplier row typed SHIPPING_LINE, bootstrap lists the name;
 *   - re-POST the same display name (exact, case/whitespace variant, or a
 *     DEFAULT_SHIPPING_LINES entry) → 200 idempotent, never a second row;
 *   - empty / whitespace / non-string / >255 names → 400, nothing created;
 *   - a name already held by a non-shipping-line supplier → 409, nothing created;
 *   - role matrix: intake roles pass, ACCOUNTANT/OPS/DRIVER 403, no token 401.
 *
 * Hits the real Postgres DB, the real Casbin enforcer and the redis-backed
 * bootstrap cache. All seeded rows are cleaned up in `after`.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { inArray, and, eq, isNull, sql } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import { getBootstrapData } from '../services/config.service';
import { cacheInvalidate } from '../lib/redis';
import shipmentRoutes from '../routes/shipments';
import { authMiddleware } from '../middleware/auth';
import { auditLogMiddleware } from '../middleware/audit';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdSupplierIds: number[] = [];

let adminToken: string;
let managerToken: string;
let cusToken: string;
let dispatcherToken: string;
let accountantToken: string;
let opsToken: string;
let driverToken: string;

let server: http.Server;
let baseUrl: string;

/** Fixture name the QA sweeper also recognizes (`name ILIKE 'QA%'`). */
const newLineName = `QA Shipping Line ${suffix}`;
/** Case/whitespace variant of `newLineName` used for the dedupe probe. */
const variantName = `  qa shipping line ${suffix.toUpperCase()}  `;
const defaultName = 'MSC';
const collidingServiceSupplierName = `QA Service Vendor ${suffix}`;

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

/** Rows holding the display name (shortName || name, trimmed + lowered — the
 *  same identity the endpoint dedupes on). This is the real "never a second
 *  row" pin: counting by the STORED display name, not by id. */
async function countByDisplayName(name: string) {
  const displayName = sql<string>`lower(coalesce(nullif(btrim(${s.suppliers.shortName}), ''), btrim(${s.suppliers.name})))`;
  const rows = await db.select({ id: s.suppliers.id }).from(s.suppliers)
    .where(and(isNull(s.suppliers.deletedAt), eq(displayName, name.trim().toLowerCase())));
  return rows.length;
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

  adminToken = sign(await mkUser(`sli-admin-${suffix}`, Role.ADMIN));
  managerToken = sign(await mkUser(`sli-manager-${suffix}`, Role.MANAGER));
  cusToken = sign(await mkUser(`sli-cus-${suffix}`, Role.CUS));
  dispatcherToken = sign(await mkUser(`sli-dispatcher-${suffix}`, Role.DISPATCHER));
  accountantToken = sign(await mkUser(`sli-accountant-${suffix}`, Role.ACCOUNTANT));
  opsToken = sign(await mkUser(`sli-ops-${suffix}`, Role.OPS));
  driverToken = sign(await mkUser(`sli-driver-${suffix}`, Role.DRIVER));

  // A live supplier that is NOT a shipping line: its display name must be
  // refused (409) instead of duplicated into the directory.
  const [serviceSupplier] = await db.insert(s.suppliers)
    .values({ name: collidingServiceSupplierName, shortName: collidingServiceSupplierName, types: ['SERVICE'], primaryType: 'SERVICE' })
    .returning({ id: s.suppliers.id });
  createdSupplierIds.push(serviceSupplier.id);

  // Drop any cached bootstrap blob so the absence/presence assertions below
  // read the live catalog.
  await cacheInvalidate('catalogs:bootstrap');
});

after(async () => {
  try {
    if (createdSupplierIds.length > 0) {
      await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (err) {
    console.warn('[shipping-line-intake-catalog.test] cleanup partial:', (err as Error).message);
  }
  // Mirrors operational-site-admin-crud.test.ts: the ephemeral server and the
  // pg pool keep the event loop alive after tests pass — close them and exit
  // hard (the isolated runner discards this throwaway DB clone anyway).
  try { await client.end(); } catch { /* ignore */ }
  server.closeAllConnections();
  server.close();
  process.exit(0);
});

describe('POST /api/shipments/shipping-lines — shared catalog persistence (FB-114 171026185348)', () => {
  test('create mints a SHIPPING_LINE supplier the bootstrap dropdown lists', async () => {
    const before = await getBootstrapData();
    assert.equal(before.shippingLines.some((line: { name: string }) => line.name === newLineName), false);

    const created = await testFetch('/shipping-lines', {
      method: 'POST',
      token: cusToken,
      body: { name: `  ${newLineName}  ` },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.data, { id: created.data.id, name: newLineName, created: true });
    assert.ok(Number.isInteger(created.data.id));

    const [row] = await db.select().from(s.suppliers)
      .where(inArray(s.suppliers.id, [created.data.id]));
    assert.ok(row, 'supplier row must exist after the POST');
    createdSupplierIds.push(row.id);
    assert.equal(row.name, newLineName);
    assert.equal(row.shortName, newLineName);
    assert.equal(row.status, 'ACTIVE');
    assert.deepEqual([...(row.types ?? [])], ['SHIPPING_LINE']);
    assert.equal(row.primaryType, 'SHIPPING_LINE');
    assert.equal(row.isFuelSupplier, false);

    // The dropdown source: bootstrap derivation must list the name after the
    // create busted the cached blob.
    const afterCreate = await getBootstrapData();
    assert.equal(afterCreate.shippingLines.some((line: { name: string }) => line.name === newLineName), true);
  });

  test('re-posting the same name is idempotent — 200 and never a second row', async () => {
    const replay = await testFetch('/shipping-lines', {
      method: 'POST',
      token: managerToken,
      body: { name: newLineName },
    });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.data, { id: replay.data.id, name: newLineName, created: false });
    // Real DB pin: exactly ONE live supplier row holds this display name.
    assert.equal(await countByDisplayName(newLineName), 1);
  });

  test('case/whitespace variants dedupe to the same catalog entry (200)', async () => {
    const variant = await testFetch('/shipping-lines', {
      method: 'POST',
      token: dispatcherToken,
      body: { name: variantName },
    });
    assert.equal(variant.status, 200);
    assert.deepEqual(variant.data, { id: variant.data.id, name: newLineName, created: false });
    assert.equal(await countByDisplayName(newLineName), 1);
  });

  test('a DEFAULT_SHIPPING_LINES name returns 200 and creates no row', async () => {
    const beforeCount = (await db.select({ id: s.suppliers.id }).from(s.suppliers)
      .where(inArray(s.suppliers.id, createdSupplierIds))).length;

    const hit = await testFetch('/shipping-lines', {
      method: 'POST',
      token: cusToken,
      body: { name: `  ${defaultName.toLowerCase()}  ` },
    });
    assert.equal(hit.status, 200);
    // Canonical catalog casing comes back — not the typed variant.
    assert.deepEqual(hit.data, { id: null, name: defaultName, created: false });

    const afterCount = (await db.select({ id: s.suppliers.id }).from(s.suppliers)
      .where(inArray(s.suppliers.id, createdSupplierIds))).length;
    assert.equal(afterCount, beforeCount);
  });

  test('empty, whitespace, non-string and >255 names are rejected 400 without rows', async () => {
    for (const body of [{ name: '' }, { name: '   ' }, { name: 42 }, { name: 'x'.repeat(256) }, {}]) {
      const res = await testFetch('/shipping-lines', { method: 'POST', token: cusToken, body });
      assert.equal(res.status, 400, `body ${JSON.stringify(body)} must be rejected`);
    }
    const rows = await db.select({ id: s.suppliers.id }).from(s.suppliers)
      .where(inArray(s.suppliers.id, createdSupplierIds));
    assert.equal(rows.length, createdSupplierIds.length);
  });

  test('a name held by a non-shipping-line supplier is refused 409, no duplicate row', async () => {
    const clash = await testFetch('/shipping-lines', {
      method: 'POST',
      token: cusToken,
      body: { name: collidingServiceSupplierName },
    });
    assert.equal(clash.status, 409);

    const rows = await db.select({ id: s.suppliers.id }).from(s.suppliers)
      .where(inArray(s.suppliers.id, createdSupplierIds));
    assert.equal(rows.length, createdSupplierIds.length);
  });

  test('role matrix: intake roles create; ACCOUNTANT/OPS/DRIVER are 403; no token is 401', async () => {
    for (const token of [adminToken, managerToken, cusToken, dispatcherToken]) {
      const res = await testFetch('/shipping-lines', {
        method: 'POST',
        token,
        body: { name: `QA Role Probe ${suffix}-${token === adminToken ? 'a' : token === managerToken ? 'm' : token === cusToken ? 'c' : 'd'}` },
      });
      assert.equal(res.status, 201);
      createdSupplierIds.push(res.data.id);
    }
    for (const token of [accountantToken, opsToken, driverToken]) {
      const res = await testFetch('/shipping-lines', {
        method: 'POST',
        token,
        body: { name: `QA Denied Probe ${suffix}` },
      });
      assert.equal(res.status, 403);
    }
    const anonymous = await testFetch('/shipping-lines', {
      method: 'POST',
      body: { name: `QA Anonymous Probe ${suffix}` },
    });
    assert.equal(anonymous.status, 401);
  });
});
