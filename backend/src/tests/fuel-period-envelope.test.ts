/**
 * QA follow-up on the material-write envelope (card _61 rung): the
 * fuel-price-period CREATE write must pass the governed envelope —
 * 400 (VN) without an Idempotency-Key — never a masked 500. Mirrors the
 * real mount (bootstrap at /api, then configRoutes) with the audit
 * middleware ACTIVE.
 *
 * The keyed-201 arm lives in q61-fuel-period-guard.test.ts ("ketoan can
 * POST a fuel period"): in THIS harness variant the keyed POST returns 201
 * but the process then hangs post-response (kept from the original probe,
 * lead-owned test-infra note), so the arm is asserted where it runs green.
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
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `qfp-${Date.now().toString(36)}`;
let server: http.Server;
let baseUrl = '';
let accountantToken = '';
let accountantUserId = 0;

before(async () => {
  await initAuditService();
  await initEnforcer();

  const [user] = await db.insert(s.users).values({
    username: `qfp-ketoan-${suffix}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role: Role.ACCOUNTANT,
    status: 'ACTIVE',
  }).returning();
  accountantUserId = user.id;
  accountantToken = jwt.sign({
    userId: user.id,
    username: user.username ?? `user-${user.id}`,
    email: null,
    fullName: null,
    role: Role.ACCOUNTANT,
    customerId: null,
    customerIds: [],
  }, config.jwtSecret);

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
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await db.delete(s.users).where(eq(s.users.id, accountantUserId));
  await client.end();
});

describe('fuel-price-period create envelopefuel-price-period create envelope (card _61 rung)', () => {
  test('POST without Idempotency-Key → 400 (VN), never a masked 500', async () => {
    const res = await fetch(`${baseUrl}/api/fuel-price-periods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'close', Authorization: `Bearer ${accountantToken}` },
      body: JSON.stringify({ unitPrice: '29940.00', effectiveFrom: '2026-10-01' }),
    });
    const body = await res.json() as { error?: string };
    assert.equal(res.status, 400, `key-less write must 400, got ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    assert.match(body.error ?? '', /Idempotency-Key/);
  });
});
