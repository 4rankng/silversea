/**
 * Customer intake-create contract (shipment-create screen).
 *
 * Boots a throwaway Express app mirroring the production `/api` config mount
 * (authMiddleware + casbinAuthz('config') + configRoutes) and asserts the
 * CUS/Dispatcher inline-customer flow end to end against the real DB:
 *
 *   - CUS may POST /customers (route-scoped allowance) and the response is a
 *     selectable row, not a pending governance action;
 *   - financially material payload fields (credit terms) are dropped — the
 *     row keeps its database defaults even when the request tries to set them;
 *   - the create does NOT touch the clerk's customer links (user_customer_links
 *     stays admin-managed) — an intake create must never invalidate the
 *     creator's own session;
 *   - the row stamps created_by with the acting CUS/Dispatcher (provenance
 *     only — staff roles are not customer-scoped, so every staff user can
 *     create shipments for any customer);
 *   - the allowance is create-only: PUT on the new row stays 403 (Casbin, not
 *     an auth failure);
 *   - the ADMIN path is untouched — material fields still apply directly.
 *
 * Mirrors shipment-routes.test.ts scaffolding; all rows cleaned up in `after`.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import configRoutes from '../routes/config';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Tax codes are globally unique across customers (application-owned lock) —
// derive a per-run one so the test never collides with seeded data.
const uniqueTaxCode = () => `0310${String(Date.now()).slice(-6)}`;

const createdCustomerIds: number[] = [];
const createdUserIds: number[] = [];

let server: http.Server;
let baseUrl: string;
let clerkToken: string;
let clerkUserId: number;
let adminToken: string;

async function mkUser(username: string, role: Role) {
  const [u] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
  }).returning();
  createdUserIds.push(u.id);
  return u;
}

function sign(u: { id: number; username: string | null; role: Role | string }, customerIds: number[] = []) {
  return jwt.sign(
    {
      userId: u.id,
      username: u.username ?? u.id.toString(),
      role: u.role as Role,
      customerId: null,
      customerIds,
    },
    config.jwtSecret,
  );
}

before(async () => {
  await initEnforcer();
  await initAuditService();
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const clerk = await mkUser(`ci-clerk-${suffix}`, Role.CUS);
  clerkUserId = clerk.id;
  clerkToken = sign(clerk);
  const admin = await mkUser(`ci-admin-${suffix}`, Role.ADMIN);
  adminToken = sign(admin);
});

after(async () => {
  if (createdCustomerIds.length > 0) {
    await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.customerId, createdCustomerIds));
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.userId, createdUserIds));
    await db.delete(s.userBusinessUnitLinks).where(inArray(s.userBusinessUnitLinks.userId, createdUserIds));
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  // Force-exit — the shared ioredis + postgres.js clients block graceful
  // shutdown on this Node 25 / postgres-js combination (same guard and
  // rationale as shipment-routes.test.ts). Assertions are all recorded.
  server.closeAllConnections();
  server.close();
  process.exit(0);
});

function postCustomer(token: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/customers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `ci-${suffix}-${Math.random().toString(36).slice(2)}`,
    },
    body: JSON.stringify(body),
  });
}

describe('customer intake create (shipment-create screen)', () => {
  test('CUS creates a selectable row with credit fields dropped and no scope side effects', async () => {
    const res = await postCustomer(clerkToken, {
      name: `Clerk intake customer ${suffix}`,
      taxCode: uniqueTaxCode(),
      contactPerson: 'Anh Test',
      phone: '0900000001',
      // Must be ignored for a CUS maker — clerk intake is identity-only.
      creditLimit: 999999999,
      paymentTermDays: 45,
    });
    const body = await res.text();
    assert.equal(res.status, 201, body);
    const row = JSON.parse(body) as Record<string, unknown>;
    createdCustomerIds.push(row.id as number);

    // A real customer row came back (not a pending governance action).
    assert.ok(typeof row.id === 'number');
    assert.ok(!('status' in row && row.status === 'PENDING_CHECK'));
    assert.equal(row.creditLimit, null);
    assert.equal(row.paymentTermDays, null);
    assert.equal(row.name, `Clerk intake customer ${suffix}`);

    // Intake provenance: the acting clerk is stamped on the row (audit
    // only — staff visibility is never scoped).
    assert.equal(row.createdBy, clerkUserId);

    // Clerk scoping is admin-managed: an intake create must not link the
    // creator (scope changes invalidate their token mid-form otherwise).
    const links = await db.select()
      .from(s.userCustomerLinks)
      .where(and(
        eq(s.userCustomerLinks.userId, clerkUserId),
        eq(s.userCustomerLinks.customerId, row.id as number),
      ));
    assert.equal(links.length, 0);
  });

  test('a CUS with zero assignments creates customers without any scope gate', async () => {
    const zeroLink = await mkUser(`ci-zero-link-${suffix}`, Role.CUS);
    const zeroToken = sign(zeroLink);
    const res = await postCustomer(zeroToken, { name: `Zero-link intake customer ${suffix}` });
    const body = await res.text();
    assert.equal(res.status, 201, body);
    const row = JSON.parse(body) as { id: number; createdBy: number | null };
    createdCustomerIds.push(row.id);
    assert.equal(row.createdBy, zeroLink.id);
  });

  test('clerk may edit the customer row they just created — session stays alive', async () => {
    const created = await postCustomer(clerkToken, { name: `Clerk update target ${suffix}` });
    const createBody = await created.text();
    assert.equal(created.status, 201, createBody);
    const row = JSON.parse(createBody) as { id: number; updatedAt: string };
    createdCustomerIds.push(row.id);

    // The route-scoped allowance (casbin.ts) extends CUS/DISPATCHER writes to
    // PUT/DELETE identity fields on customers/routes — so this is a 200, and
    // crucially never 401: a scope-delta logout here would kill the clerk's
    // form mid-work. The If-Unmodified-Since precondition uses the row's own
    // updatedAt (second-precision HTTP date vs millisecond column would
    // otherwise 409).
    const res = await fetch(`${baseUrl}/customers/${row.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clerkToken}`,
        'Idempotency-Key': `ci-put-${suffix}-${Math.random().toString(36).slice(2)}`,
        'If-Unmodified-Since': row.updatedAt,
      },
      body: JSON.stringify({ name: `Clerk update target ${suffix} — đã sửa` }),
    });
    const putBody = await res.text();
    assert.equal(res.status, 200, putBody);
    const updated = JSON.parse(putBody) as { name: string };
    assert.equal(updated.name, `Clerk update target ${suffix} — đã sửa`);
  });

  test('ADMIN creates keep applying material config directly', async () => {
    const res = await postCustomer(adminToken, {
      name: `Admin intake customer ${suffix}`,
      creditLimit: 123456,
    });
    const body = await res.text();
    assert.equal(res.status, 201, body);
    const row = JSON.parse(body) as Record<string, unknown>;
    createdCustomerIds.push(row.id as number);
    assert.equal(Number(row.creditLimit), 123456);
    // Admin creates stay unstamped — visibility is governed by
    // user_customer_links alone, never by a creator stamp.
    assert.equal(row.createdBy ?? null, null);
  });
});
