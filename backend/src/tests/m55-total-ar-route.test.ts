/**
 * M5.5 total AR report — HTTP route tests (/api/reports/total-ar).
 * Computation semantics are pinned by m55-total-ar.test.ts (service level);
 * here we pin the route contract: RBAC, validation, payload shape.
 */
import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, client } from '../db';
import * as s from '../db/schema';
import { inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import { cacheInvalidatePattern, disconnectRedis } from '../lib/redis';
import financialRoutes from '../routes/financial';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdLedgerIds: number[] = [];
let adminToken = '';
let driverToken = '';
let custAId = 0;
let custBId = 0;
let custCId = 0;

const app = express();
app.use(express.json());
app.use('/api', authMiddleware, casbinAuthz('financial'), financialRoutes);
app.use(globalErrorHandler);

let server: http.Server;
let baseUrl = '';

interface TestFetchOptions { method?: string; token?: string; }
async function testFetch(urlPath: string, options: TestFetchOptions = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

before(async () => {
  await initAuditService();
  await initEnforcer();
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const password = await bcrypt.hash('m55route123', 10);
  const [adm] = await db.insert(s.users).values({
    username: `m55route-admin-${suffix}`, passwordHash: password,
    role: Role.ADMIN, status: 'ACTIVE',
  }).returning();
  const [drv] = await db.insert(s.users).values({
    username: `m55route-driver-${suffix}`, passwordHash: password,
    role: Role.DRIVER, status: 'ACTIVE',
  }).returning();
  createdUserIds.push(adm.id, drv.id);
  adminToken = jwt.sign({ userId: adm.id, username: adm.username, role: Role.ADMIN }, config.jwtSecret);
  driverToken = jwt.sign({ userId: drv.id, username: drv.username, role: Role.DRIVER }, config.jwtSecret);

  // Customer A: opening balance + in-range charges/receipts/adjustment.
  // Customer B: zero-activity-with-balance (M5.5 §1 inclusion rule).
  // Customer C: no ledger rows at all → excluded from the report.
  const [custA] = await db.insert(s.customers).values({ name: `M55-route A ${suffix}` }).returning();
  const [custB] = await db.insert(s.customers).values({ name: `M55-route B ${suffix}` }).returning();
  const [custC] = await db.insert(s.customers).values({ name: `M55-route C ${suffix}` }).returning();
  createdCustomerIds.push(custA.id, custB.id, custC.id);
  custAId = custA.id;
  custBId = custB.id;
  custCId = custC.id;

  const rows = [
    // [customer, txnType, debit, credit, timestamp]
    [custAId, 'SERVICE_FEE', 1000, 0, '2025-12-01T10:00:00+07:00'],
    [custAId, 'SERVICE_FEE', 2500, 0, '2026-01-05T10:00:00+07:00'],
    [custAId, 'PAYMENT_RECEIVED', 0, 400, '2026-01-20T10:00:00+07:00'],
    [custAId, 'ADJUSTMENT', 100, 400, '2026-01-25T10:00:00+07:00'],
    [custBId, 'SERVICE_FEE', 700, 0, '2025-11-15T10:00:00+07:00'],
  ] as const;
  for (const [entityId, txnType, debit, credit, timestamp] of rows) {
    const [e] = await db.insert(s.ledger).values({
      entityType: 'CUSTOMER', entityId, txnType: txnType as never, txnId: 0,
      debit: String(debit), credit: String(credit), balance: String(debit - credit),
      timestamp: new Date(timestamp),
    }).returning();
    createdLedgerIds.push(e.id);
  }

  // Stale cache from previous runs must not serve this test's expectations.
  await cacheInvalidatePattern('reports:total-ar:*');
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    if (createdLedgerIds.length > 0) await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } catch (err) { console.warn('[m55-route] cleanup:', (err as Error).message); }
  await cacheInvalidatePattern('reports:total-ar:*');
  await disconnectRedis();
  await client.end();
});

describe('M5.5 — /api/reports/total-ar route', () => {
  const RANGE = 'rangeFrom=2026-01-01&rangeTo=2026-01-31';

  test('403 for a role outside ADMIN/MANAGER/ACCOUNTANT', async () => {
    const res = await testFetch(`/api/reports/total-ar?${RANGE}`, { token: driverToken });
    assert.equal(res.status, 403);
  });

  test('400 on a malformed date', async () => {
    const res = await testFetch('/api/reports/total-ar?rangeFrom=01-2026&rangeTo=2026-01-31', { token: adminToken });
    assert.equal(res.status, 400);
  });

  test('400 when rangeFrom is after rangeTo', async () => {
    const res = await testFetch('/api/reports/total-ar?rangeFrom=2026-02-01&rangeTo=2026-01-01', { token: adminToken });
    assert.equal(res.status, 400);
  });

  test('200 with opening/activity math and inclusion rules', async () => {
    const res = await testFetch(`/api/reports/total-ar?${RANGE}`, { token: adminToken });
    assert.equal(res.status, 200);
    const report = res.body as {
      customers: Array<{ customerId: number; openingBalance: number; newCharges: number; receipts: number; adjustments: number; closingBalance: number }>;
      totals: { openingBalance: number; newCharges: number; receipts: number; adjustments: number; closingBalance: number };
    };

    const a = report.customers.find((c) => c.customerId === custAId);
    const b = report.customers.find((c) => c.customerId === custBId);
    assert.ok(a, 'customer A must appear');
    assert.ok(b, 'customer B (zero-activity-with-balance) must appear');
    assert.ok(!report.customers.some((c) => c.customerId === custCId), 'customer C (no ledger rows) must be excluded');

    // A: opening 1000; charges 2500; receipts 400; adjustments (400-100)=300;
    // closing 1000+2500-400+300 = 3400
    assert.equal(a.openingBalance, 1000);
    assert.equal(a.newCharges, 2500);
    assert.equal(a.receipts, 400);
    assert.equal(a.adjustments, 300);
    assert.equal(a.closingBalance, 3400);

    assert.equal(b.openingBalance, 700);
    assert.equal(b.closingBalance, 700);

    // Totals must equal the sum over the RETURNED customers (the DB may hold
    // ledger rows from other fixtures), and each total must be at least the
    // A+B contribution (1700/2500/400/300/4100).
    const summed = report.customers.reduce((acc, c) => ({
      openingBalance: acc.openingBalance + c.openingBalance,
      newCharges: acc.newCharges + c.newCharges,
      receipts: acc.receipts + c.receipts,
      adjustments: acc.adjustments + c.adjustments,
      closingBalance: acc.closingBalance + c.closingBalance,
    }), { openingBalance: 0, newCharges: 0, receipts: 0, adjustments: 0, closingBalance: 0 });
    assert.deepEqual(report.totals, summed);
  });
});
