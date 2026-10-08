/**
 * Card 20261003_306 — expense list date-range guards (card 20261001_256's
 * class, instance 2 found by the mandatory sweep).
 *
 * /api/expenses fed the raw fromDate/toDate query strings into gte/lte on
 * the DATE column expenses.expense_date (expense.service.ts filter block),
 * so an impossible calendar day made Postgres throw and the route answered
 * 500 — exactly the invoice-tracking defect card 20261001_256 fixed. This
 * suite pins the same contract here: strict real-calendar bounds, a
 * Vietnamese business 400 naming the bad value, valid ranges untouched.
 *
 * Boots a throwaway Express app (mirrors invoice-tracking.test.ts) with the
 * production mount chain; the real Casbin enforcer reads the shipped
 * policy.csv so ACCOUNTANT passes the financial family gate exactly as in
 * the live app. No fixtures needed — the list renders empty sets fine.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';

import { inArray } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';
import bcrypt from 'bcryptjs';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import expenseRoutes from '../routes/expense';

const suffix = `exp-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
let accountantToken = '';
let server: http.Server;
let baseUrl = '';

function tokenFor(role: Role, id: number, username: string): string {
  return jwt.sign({
    userId: id, username, email: null, fullName: 'QA Test',
    role, customerId: null, customerIds: [],
  }, config.jwtSecret);
}

async function get(query: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/expenses${query}`, {
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

before(async () => {
  await initEnforcer();

  // authMiddleware loads the user row and validates the role claim against
  // it, so the suite signs with a REAL account row (mirrors
  // invoice-tracking.test.ts's mkUser) — a synthetic id 401s.
  const [accountant] = await db.insert(s.users).values({
    username: `exp-acc-${suffix.slice(0, 10)}`,
    passwordHash: await bcrypt.hash('x', 10),
    role: Role.ACCOUNTANT,
    status: 'ACTIVE',
  }).returning();
  userIds.push(accountant.id);
  accountantToken = tokenFor(Role.ACCOUNTANT, accountant.id, accountant.username ?? `u-${accountant.id}`);
  const app = express();
  app.use(express.json());
  app.use('/api/expenses', authMiddleware, casbinAuthz('financial'), expenseRoutes);
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
  server.closeAllConnections();
  server.close();
  try { await disconnectRedis(); } catch { /* ignore */ }
  try {
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch { /* partial cleanup is fine — throwaway DB or suffixed rows */ }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});

describe('expense list date-range bounds (card 20261003_306)', () => {
  test('an impossible calendar day answers the business 400, not a 500', async () => {
    // RED at HEAD before the fix: the raw string reaches the date column and
    // Postgres throws — this assertion is OBSERVED failing as 500 first.
    const leap = await get('?fromDate=2026-02-30&toDate=2026-03-31&page=1');
    assert.equal(leap.status, 400, `expected 400 for impossible day, got ${leap.status}: ${JSON.stringify(leap.body).slice(0, 160)}`);
    assert.match(String(leap.body.error ?? ''), /2026-02-30/);

    const thirteenth = await get('?fromDate=2026-13-01&toDate=2026-13-31&page=1');
    assert.equal(thirteenth.status, 400);

    const shaped = await get('?fromDate=30-02-2026&page=1');
    assert.equal(shaped.status, 400);
  });

  test('a real range and an open range still answer 200', async () => {
    const valid = await get('?fromDate=2026-02-01&toDate=2026-03-31&page=1');
    assert.equal(valid.status, 200);

    const open = await get('?page=1');
    assert.equal(open.status, 200);
  });
});
