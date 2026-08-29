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
 *   - the creating clerk is auto-linked (user_customer_links) so their scoped
 *     bootstrap keeps showing the customer they just created;
 *   - the allowance is create-only: PUT on the new row stays 403;
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

const createdCustomerIds: number[] = [];
const createdUserIds: number[] = [];
const createdLinkIds: number[] = [];

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

function sign(u: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    {
      userId: u.id,
      username: u.username ?? u.id.toString(),
      role: u.role as Role,
      customerId: null,
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
  if (createdLinkIds.length > 0) {
    await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.id, createdLinkIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.customerId, createdCustomerIds));
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.userId, createdUserIds));
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
  test('CUS creates a selectable row with credit fields dropped and is auto-scoped to it', async () => {
    const res = await postCustomer(clerkToken, {
      name: `Clerk intake customer ${suffix}`,
      taxCode: '0310001111',
      contactPerson: 'Anh Test',
      phone: '0900000001',
      // Must be ignored for a CUS maker — clerk intake is identity-only.
      creditLimit: 999999999,
      paymentTermDays: 45,
    });
    assert.equal(res.status, 201);
    const row = await res.json() as Record<string, unknown>;
    createdCustomerIds.push(row.id as number);

    // A real customer row came back (not a pending governance action).
    assert.ok(typeof row.id === 'number');
    assert.ok(!('status' in row && row.status === 'PENDING_CHECK'));
    assert.equal(row.creditLimit, null);
    assert.equal(row.paymentTermDays, null);
    assert.equal(row.name, `Clerk intake customer ${suffix}`);

    // The clerk's scoped bootstrap now includes the customer they created.
    const [link] = await db.select()
      .from(s.userCustomerLinks)
      .where(and(
        eq(s.userCustomerLinks.userId, clerkUserId),
        eq(s.userCustomerLinks.customerId, row.id as number),
      ))
      .limit(1);
    assert.ok(link, 'user_customer_links row must exist for the creating clerk');
    createdLinkIds.push(link.id);
  });

  test('the CUS allowance is create-only — updates stay denied', async () => {
    const created = await postCustomer(clerkToken, { name: `Clerk update target ${suffix}` });
    const row = await created.json() as { id: number };
    createdCustomerIds.push(row.id);

    const res = await fetch(`${baseUrl}/customers/${row.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clerkToken}`,
        'Idempotency-Key': `ci-put-${suffix}-${Math.random().toString(36).slice(2)}`,
        'If-Unmodified-Since': new Date().toISOString(),
      },
      body: JSON.stringify({ name: 'Sửa tên không được phép' }),
    });
    assert.equal(res.status, 403);
  });

  test('ADMIN creates keep applying material config directly', async () => {
    const res = await postCustomer(adminToken, {
      name: `Admin intake customer ${suffix}`,
      creditLimit: 123456,
    });
    assert.equal(res.status, 201);
    const row = await res.json() as Record<string, unknown>;
    createdCustomerIds.push(row.id as number);
    assert.equal(Number(row.creditLimit), 123456);
  });
});
