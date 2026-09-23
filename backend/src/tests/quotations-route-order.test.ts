/**
 * Card 20260922_66 regression — the quotations LIST route must resolve at its
 * config mount. QA found authed GET /api/quotations 400 "ID không hợp lệ" on
 * staging (f9d2ebaa): a param-matching route registered earlier at the /api
 * level swallowed the path before quotationsRouter saw it. This test mirrors
 * index.ts's mount order (catalogBootstrapRouter then configRoutes, both at
 * /api) and pins the list route resolving. Audit middleware ACTIVE per the
 * route-test rule.
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
import { initAuditService } from '../services/audit.service';
import configRoutes, { catalogBootstrapRouter } from '../routes/config';
import quotationsRouter from '../routes/config/quotations.routes';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `qshadow-${Date.now().toString(36)}`;
let server: http.Server;
let baseUrl = '';
let adminToken = '';
let adminUserId = 0;

before(async () => {
  await initAuditService();
  await initEnforcer();

  const [user] = await db.insert(s.users).values({
    username: `qshadow-admin-${suffix}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  adminUserId = user.id;
  adminToken = jwt.sign({
    userId: user.id,
    username: user.username ?? `user-${user.id}`,
    email: null,
    fullName: null,
    role: Role.ADMIN,
    customerId: null,
    customerIds: [],
  }, config.jwtSecret);

  // Mirror index.ts:223/229 — bootstrap at /api FIRST, then configRoutes.
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use(auditLogMiddleware);
  app.use('/api', catalogBootstrapRouter);
  app.use('/api', casbinAuthz('config'), configRoutes);
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
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await db.delete(s.users).where(eq(s.users.id, adminUserId));
  await client.end();
});

describe('quotations route order at the config mount (card 20260922_66 regression)', () => {
  test('GET /api/quotations resolves to the list handler, not a param-route 400', async () => {
    const res = await fetch(`${baseUrl}/api/quotations`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const bodyText = await res.text();
    assert.equal(res.status, 200, `GET /api/quotations → ${res.status}: ${bodyText.slice(0, 200)}`);
    assert.ok(Array.isArray(JSON.parse(bodyText)), 'list handler returns an array');
  });

  test('GET /api/quotations/:id with a numeric id resolves to the detail handler (404, not 400)', async () => {
    const res = await fetch(`${baseUrl}/api/quotations/999999`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 404, 'numeric :id must reach the detail handler (frame missing → 404)');
  });

  test('POST without Idempotency-Key → 400 (VN), never a raw 500', async () => {
    const res = await fetch(`${baseUrl}/api/quotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    });
    const body = await res.json() as { error?: string };
    assert.equal(res.status, 400, `key-less write must 400, got ${res.status}`);
    assert.match(body.error ?? '', /Idempotency-Key/);
  });

  test('POST with Idempotency-Key → 201 through the governed envelope', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `Qshadow customer ${suffix}` }).returning();
    const res = await fetch(`${baseUrl}/api/quotations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': `qshadow-${suffix}-create`,
      },
      body: JSON.stringify({
        customerId: customer.id,
        templateName: 'Mẫu báo giá 1',
        effectiveDate: '2026-09-15',
      }),
    });
    const body = await res.json() as { id?: number; error?: string };
    assert.equal(res.status, 201, `governed write must pass the envelope: ${JSON.stringify(body).slice(0, 200)}`);
    assert.ok(Number(body.id) > 0);
    await db.delete(s.quotations).where(eq(s.quotations.id, Number(body.id)));
    await db.delete(s.customers).where(eq(s.customers.id, customer.id));
  });
});
