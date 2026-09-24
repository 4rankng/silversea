/**
 * QA follow-up on the material-write envelope (card _61 rung): the
 * fuel-price-period CREATE write must pass the governed envelope —
 * 400 (VN) without an Idempotency-Key — never a masked 500. Mirrors the
 * real mount (bootstrap at /api, then configRoutes) with the audit
 * middleware ACTIVE.
 *
 * The keyed-201 arm lives HERE again (card 20260924_4 root-cause): the
 * original "hang post-response" was the harness, not the app. The keyed arm
 * is the only one that reaches the service layer, whose write path calls
 * cacheInvalidate('config:fuel') (config.service.ts) -> getRedis() lazily
 * opens the process-wide ioredis client, and the old teardown (postgres +
 * server only) never released it — the node:test child's event loop never
 * drained, so the runner waited forever AFTER the green 201. Teardown now
 * releases Redis (disconnectRedis) alongside postgres and the server.
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
import { disconnectRedis } from '../lib/redis';
import { fuelPricePeriods } from '../db/schema/pricing';
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
let createdPeriodId = 0;

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
    // The in-process server must never hold the test child's event loop: the
    // fetch client's pooled keep-alive socket can race server.close() and pin
    // the loop forever (the residual-handle finding, card 20260924_4).
    server.unref();
  });
});

after(async () => {
  // The keyed arm's write spawns quotation_fuel_approvals rows referencing
  // the period (spawnQuotationFuelApprovals: every ACTIVE-quotation customer
  // gets a PENDING row) and lazily opens the process-wide ioredis client
  // (cacheInvalidate in config.service) — clear the approvals first, then
  // release Redis and postgres, or the node:test child never exits
  // (the original "keyed POST hangs post-response" root cause, card 20260924_4).
  // The fetch client's pooled keep-alive socket must also go: undici's global
  // dispatcher holds it against this process's own in-process server, whose
  // close() then never resolves.
  try {
    if (createdPeriodId) {
      await db.delete(s.quotationFuelApprovals).where(eq(s.quotationFuelApprovals.fuelPricePeriodId, createdPeriodId));
      await db.delete(fuelPricePeriods).where(eq(fuelPricePeriods.id, createdPeriodId));
    }
    await db.delete(s.users).where(eq(s.users.id, accountantUserId));
  } catch (error) {
    console.error('teardown cleanup error (releases still run):', error);
  }
  await disconnectRedis();
  await client.end();
});

describe('fuel-price-period create envelope (card _61 rung)', () => {
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

  test('ketoan can POST a fuel period with an Idempotency-Key → 201', async () => {
    const res = await fetch(`${baseUrl}/api/fuel-price-periods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accountantToken}`, 'Idempotency-Key': `qfp-keyed-${suffix}` },
      body: JSON.stringify({ unitPrice: '29940.00', effectiveFrom: '2026-10-01' }),
    });
    const body = await res.json() as { id?: number; error?: string };
    assert.equal(res.status, 201, `keyed write must 201, got ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    assert.ok(body.id, 'created fuel-price-period id returned');
    createdPeriodId = body.id!;
  });
});
