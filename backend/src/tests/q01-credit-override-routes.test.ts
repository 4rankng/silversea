import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq, inArray, sql } from 'drizzle-orm';

import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import financialRoutes from '../routes/financial';
import { getAppSettings, saveAppSettings } from '../services/app-settings.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdCreditOverrideIds: number[] = [];

let server: http.Server;
let baseUrl: string;
let originalSettings: Awaited<ReturnType<typeof getAppSettings>>;
let adminToken: string;
let managerToken: string;
let accountantToken: string;

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `q01-${role.toLowerCase()}-${suffix}-${createdUserIds.length}`,
    passwordHash: 'test',
    role,
  }).returning();
  createdUserIds.push(user.id);
  return { ...user, role: user.role as Role };
}

async function mkCustomer(creditLimit: string) {
  const [row] = await db.execute<{ id: number }>(sql`
    insert into customers (name, credit_limit)
    values (${`Q01 route customer ${suffix}-${createdCustomerIds.length}`}, ${creditLimit})
    returning id
  `);
  createdCustomerIds.push(row.id);
  return { id: row.id };
}

async function mkLedger(customerId: number, debit: number) {
  const [entry] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER',
    entityId: customerId,
    txnType: 'TRIP_REVENUE',
    txnId: 0,
    debit: String(debit),
    credit: '0',
    balance: String(debit),
  }).returning();
  createdLedgerIds.push(entry.id);
  return entry;
}

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function request(path: string, init: { method?: string; token: string; body?: unknown } ) {
  const headers: Record<string, string> = { Authorization: `Bearer ${init.token}` };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (body?.id && typeof body.id === 'number' && !createdCreditOverrideIds.includes(body.id)) {
    createdCreditOverrideIds.push(body.id);
  }
  return { status: response.status, body };
}

before(async () => {
  await initEnforcer();
  originalSettings = await getAppSettings();
  await saveAppSettings({
    ...originalSettings,
    creditWarningThresholdDefault: 0.8,
    creditTierOneAmountCap: 1_000_000,
  });

  const admin = await mkUser(Role.ADMIN);
  const manager = await mkUser(Role.MANAGER);
  const accountant = await mkUser(Role.ACCOUNTANT);
  adminToken = sign(admin);
  managerToken = sign(manager);
  accountantToken = sign(accountant);

  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('financial'), financialRoutes);
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
    await saveAppSettings(originalSettings);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (createdCreditOverrideIds.length > 0) {
      await db.delete(s.creditOverrideRequests).where(inArray(s.creditOverrideRequests.id, createdCreditOverrideIds));
    }
    if (createdLedgerIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } finally {
    await client.end();
  }
});

describe('Q01/Q02 credit override routes', () => {
  test('manager can create a tier-1 request but cannot self-approve it', async () => {
    const customer = await mkCustomer('10000000');
    await mkLedger(customer.id, 10_500_000);

    const created = await request('/api/finance/credit-overrides', {
      method: 'POST',
      token: managerToken,
      body: {
        customerId: customer.id,
        proposedAmount: 100_000,
        expiresAt: '2026-07-29T12:00:00.000Z',
        reason: 'Xin chạy tiếp cho đơn hàng đang gấp',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.requiredTier, 'FINANCE_TIER_1');

    const selfApprove = await request(`/api/finance/credit-overrides/${created.body.id}/approve`, {
      method: 'POST',
      token: managerToken,
      body: { expectedVersion: created.body.version },
    });
    assert.equal(selfApprove.status, 403);
  });

  test('approval is first-winner under concurrency', async () => {
    const customer = await mkCustomer('10000000');
    await mkLedger(customer.id, 10_300_000);

    const created = await request('/api/finance/credit-overrides', {
      method: 'POST',
      token: managerToken,
      body: {
        customerId: customer.id,
        proposedAmount: 200_000,
        expiresAt: '2026-07-29T12:00:00.000Z',
        reason: 'Đề nghị ngoại lệ cạnh tranh',
      },
    });
    assert.equal(created.status, 201);

    const [first, second] = await Promise.all([
      request(`/api/finance/credit-overrides/${created.body.id}/approve`, {
        method: 'POST',
        token: accountantToken,
        body: { expectedVersion: created.body.version },
      }),
      request(`/api/finance/credit-overrides/${created.body.id}/approve`, {
        method: 'POST',
        token: adminToken,
        body: { expectedVersion: created.body.version },
      }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);

    const [stored] = await db.select()
      .from(s.creditOverrideRequests)
      .where(eq(s.creditOverrideRequests.id, created.body.id))
      .limit(1);
    assert.equal(stored?.status, 'APPROVED');
    assert.ok(stored?.approvedBy != null);
    assert.equal(stored?.version, created.body.version + 1);
  });

  test('director account can reject a large exception and stale decisions lose', async () => {
    const customer = await mkCustomer('10000000');
    await mkLedger(customer.id, 11_100_000);

    const created = await request('/api/finance/credit-overrides', {
      method: 'POST',
      token: accountantToken,
      body: {
        customerId: customer.id,
        proposedAmount: 100_000,
        expiresAt: '2026-07-29T12:00:00.000Z',
        reason: 'Ngoại lệ lớn cần giám đốc xem xét',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.requiredTier, 'DIRECTOR');

    const listed = await request('/api/finance/credit-overrides?status=PENDING', {
      token: managerToken,
    });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((row: { id: number }) => row.id === created.body.id));

    const rejected = await request(`/api/finance/credit-overrides/${created.body.id}/reject`, {
      method: 'POST',
      token: managerToken,
      body: {
        expectedVersion: created.body.version,
        reason: 'Chưa đủ cơ sở để vượt hạn mức',
      },
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'REJECTED');
    assert.equal(rejected.body.version, created.body.version + 1);

    const staleApprove = await request(`/api/finance/credit-overrides/${created.body.id}/approve`, {
      method: 'POST',
      token: adminToken,
      body: { expectedVersion: created.body.version },
    });
    assert.equal(staleApprove.status, 409);
  });
});
