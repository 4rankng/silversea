import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { and, eq, inArray, sql } from 'drizzle-orm';

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
const futureExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000).toISOString();
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdCreditOverrideIds: number[] = [];
const createdGovernanceActionIds: number[] = [];
const idempotencyKeys: string[] = [];
let failpointCounter = 0;

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
  const name = `Q01 route customer ${suffix}-${createdCustomerIds.length}`;
  const [row] = await db.execute<{ id: number }>(sql`
    insert into customers (name, credit_limit)
    values (${name}, ${creditLimit})
    returning id
  `);
  createdCustomerIds.push(row.id);
  return { id: row.id, name };
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

async function request(path: string, init: { method?: string; token: string; body?: unknown; idempotencyKey?: string | null } ) {
  const headers: Record<string, string> = { Authorization: `Bearer ${init.token}` };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const method = init.method ?? 'GET';
  const idempotencyKey = method !== 'GET'
    ? (init.idempotencyKey === null ? null : (init.idempotencyKey ?? `q01-${method}-${idempotencyKeys.length + 1}`))
    : null;
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
    if (!idempotencyKeys.includes(idempotencyKey)) {
      idempotencyKeys.push(idempotencyKey);
    }
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (body?.id && typeof body.id === 'number' && !createdCreditOverrideIds.includes(body.id)) {
    createdCreditOverrideIds.push(body.id);
  }
  if (
    body?.governanceActionId
    && typeof body.governanceActionId === 'number'
    && !createdGovernanceActionIds.includes(body.governanceActionId)
  ) {
    createdGovernanceActionIds.push(body.governanceActionId);
  }
  return { status: response.status, body };
}

async function withIdempotencyInsertFailure(endpoint: string, idempotencyKey: string, run: () => Promise<void>) {
  failpointCounter += 1;
  const identSuffix = suffix.replace(/[^a-z0-9]+/gi, '_');
  const functionName = `q01_fail_idempotency_insert_${identSuffix}_${failpointCounter}`;
  const triggerName = `q01_fail_idempotency_insert_trg_${identSuffix}_${failpointCounter}`;
  await db.execute(sql.raw(`
    create function "${functionName}"() returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'q01 simulated idempotency insert failure';
    end;
    $$;
  `));
  await db.execute(sql.raw(`
    create trigger "${triggerName}"
    before insert on idempotency_keys
    for each row
    when (new.endpoint = '${endpoint}' and new.idempotency_key = '${idempotencyKey}')
    execute function "${functionName}"();
  `));
  try {
    await run();
  } finally {
    await db.execute(sql.raw(`drop trigger if exists "${triggerName}" on idempotency_keys;`));
    await db.execute(sql.raw(`drop function if exists "${functionName}"();`));
  }
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
    if (idempotencyKeys.length > 0) {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
    }
    if (createdGovernanceActionIds.length > 0) {
      await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, createdGovernanceActionIds));
    }
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
  test('create requires a command key, replays exactly once, and blocks same-key payload drift', async () => {
    const customer = await mkCustomer('10000000');
    await mkLedger(customer.id, 10_500_000);

    const missingKey = await request('/api/finance/credit-overrides', {
      method: 'POST',
      token: managerToken,
      idempotencyKey: null,
      body: {
        customerId: customer.id,
        proposedAmount: 100_000,
        expiresAt: futureExpiry,
        reason: 'Thiếu khóa giao dịch',
      },
    });
    assert.equal(missingKey.status, 400);
    assert.match(String(missingKey.body.error), /Idempotency-Key/i);

    const createKey = `q23-credit-create-${customer.id}`;
    const created = await request('/api/finance/credit-overrides', {
      method: 'POST',
      token: managerToken,
      idempotencyKey: createKey,
      body: {
        customerId: customer.id,
        proposedAmount: 100_000,
        expiresAt: futureExpiry,
        reason: 'Xin chạy tiếp cho đơn hàng đang gấp',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.requiredTier, 'FINANCE_TIER_1');
    assert.equal(created.body.workflowStatus, 'PENDING_CHECK');
    assert.equal(created.body.replayed, undefined);

    const replayed = await request('/api/finance/credit-overrides', {
      method: 'POST',
      token: managerToken,
      idempotencyKey: createKey,
      body: {
        customerId: customer.id,
        proposedAmount: 100_000,
        expiresAt: futureExpiry,
        reason: 'Xin chạy tiếp cho đơn hàng đang gấp',
      },
    });
    assert.equal(replayed.status, 201);
    assert.equal(replayed.body.replayed, true);
    assert.equal(replayed.body.id, created.body.id);

    const drift = await request('/api/finance/credit-overrides', {
      method: 'POST',
      token: managerToken,
      idempotencyKey: createKey,
      body: {
        customerId: customer.id,
        proposedAmount: 100_000,
        expiresAt: futureExpiry,
        reason: 'Đã đổi lý do',
      },
    });
    assert.equal(drift.status, 409);
    assert.match(String(drift.body.error), /Khóa giao dịch trùng/i);

    const directApprove = await request(`/api/finance/credit-overrides/${created.body.id}/approve`, {
      method: 'POST',
      token: managerToken,
      idempotencyKey: `q23-credit-self-approve-${created.body.id}`,
      body: { expectedVersion: created.body.version },
    });
    assert.equal(directApprove.status, 409);

    // 2026-09-10 (phê duyệt removed): the maker may check their own request.

    const checked = await request(`/api/finance/credit-overrides/${created.body.id}/check`, {
      method: 'POST',
      token: accountantToken,
      body: { expectedVersion: created.body.version },
    });
    assert.equal(checked.status, 200);
    assert.equal(checked.body.workflowStatus, 'PENDING_APPROVAL');
    const [checkedBusinessRecord] = await db.select()
      .from(s.creditOverrideRequests)
      .where(eq(s.creditOverrideRequests.id, created.body.id))
      .limit(1);
    assert.equal(checkedBusinessRecord?.status, 'PENDING');
    assert.equal(checkedBusinessRecord?.approvedBy, null);
    assert.equal(checkedBusinessRecord?.approvedAt, null);

    // 2026-09-10 (phê duyệt removed): the checker may approve too.

    const approved = await request(`/api/finance/credit-overrides/${created.body.id}/approve`, {
      method: 'POST',
      token: adminToken,
      body: { expectedVersion: checked.body.version },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'APPROVED');
    assert.equal(approved.body.workflowStatus, 'APPROVED');
    const [approvedAction] = await db.select()
      .from(s.governanceActions)
      .where(eq(s.governanceActions.id, created.body.governanceActionId))
      .limit(1);
    assert.equal(new Set([
      approvedAction?.makerId,
      approvedAction?.checkerId,
      approvedAction?.approverId,
    ]).size, 3);
  });

  test('concurrent approve-vs-reject keeps the first valid decision', async () => {
    const customer = await mkCustomer('10000000');
    await mkLedger(customer.id, 10_300_000);

    const created = await request('/api/finance/credit-overrides', {
      method: 'POST',
      token: managerToken,
      idempotencyKey: `q23-credit-race-create-${customer.id}`,
      body: {
        customerId: customer.id,
        proposedAmount: 200_000,
        expiresAt: futureExpiry,
        reason: 'Đề nghị ngoại lệ cạnh tranh',
      },
    });
    assert.equal(created.status, 201);
    const checked = await request(`/api/finance/credit-overrides/${created.body.id}/check`, {
      method: 'POST',
      token: adminToken,
      body: { expectedVersion: created.body.version },
    });
    assert.equal(checked.status, 200);

    const [first, second] = await Promise.all([
      request(`/api/finance/credit-overrides/${created.body.id}/approve`, {
        method: 'POST',
        token: accountantToken,
        idempotencyKey: `q23-credit-race-approve-${created.body.id}`,
        body: { expectedVersion: checked.body.version },
      }),
      request(`/api/finance/credit-overrides/${created.body.id}/reject`, {
        method: 'POST',
        token: accountantToken,
        idempotencyKey: `q23-credit-race-reject-${created.body.id}`,
        body: {
          expectedVersion: checked.body.version,
          reason: 'Người duyệt còn lại đến muộn hơn',
        },
      }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);

    const [stored] = await db.select()
      .from(s.creditOverrideRequests)
      .where(eq(s.creditOverrideRequests.id, created.body.id))
      .limit(1);
    assert.ok(stored?.status === 'APPROVED' || stored?.status === 'REJECTED');
    assert.equal(stored?.version, created.body.requestVersion + 1);
  });

  test('decision replay is exact and stale versions lose after the first outcome', async () => {
    const customer = await mkCustomer('10000000');
    await mkLedger(customer.id, 11_100_000);

    const created = await request('/api/finance/credit-overrides', {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: `q23-credit-director-create-${customer.id}`,
      body: {
        customerId: customer.id,
        proposedAmount: 100_000,
        expiresAt: futureExpiry,
        reason: 'Ngoại lệ lớn cần giám đốc xem xét',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.requiredTier, 'DIRECTOR');

    const directReject = await request(`/api/finance/credit-overrides/${created.body.id}/reject`, {
      method: 'POST',
      token: managerToken,
      body: {
        expectedVersion: created.body.version,
        reason: 'Không được từ chối trước bước kiểm tra',
      },
    });
    assert.equal(directReject.status, 409);

    const checked = await request(`/api/finance/credit-overrides/${created.body.id}/check`, {
      method: 'POST',
      token: adminToken,
      body: { expectedVersion: created.body.version },
    });
    assert.equal(checked.status, 200);

    const listed = await request('/api/finance/credit-overrides?status=PENDING', {
      token: managerToken,
    });
    assert.equal(listed.status, 200);
    const listedRequest = listed.body.items.find((row: { id: number }) => row.id === created.body.id);
    assert.ok(listedRequest);
    assert.equal(listedRequest.customerName, customer.name);
    assert.equal(listedRequest.requestedByName, 'Kế toán');
    assert.equal(listedRequest.checkedByName, 'Quản trị viên');

    const detailed = await request(`/api/finance/credit-overrides/${created.body.id}`, {
      token: managerToken,
    });
    assert.equal(detailed.status, 200);
    assert.equal(detailed.body.customerName, customer.name);
    assert.equal(detailed.body.requestedByName, 'Kế toán');
    assert.equal(detailed.body.checkedByName, 'Quản trị viên');

    const rejectKey = `q23-credit-reject-${created.body.id}`;
    const rejected = await request(`/api/finance/credit-overrides/${created.body.id}/reject`, {
      method: 'POST',
      token: managerToken,
      idempotencyKey: rejectKey,
      body: {
        expectedVersion: checked.body.version,
        reason: 'Chưa đủ cơ sở để vượt hạn mức',
      },
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'REJECTED');
    assert.equal(rejected.body.workflowStatus, 'REJECTED');

    const replayed = await request(`/api/finance/credit-overrides/${created.body.id}/reject`, {
      method: 'POST',
      token: managerToken,
      idempotencyKey: rejectKey,
      body: {
        expectedVersion: checked.body.version,
        reason: 'Chưa đủ cơ sở để vượt hạn mức',
      },
    });
    assert.equal(replayed.status, 200);
    assert.equal(replayed.body.replayed, true);
    assert.equal(replayed.body.id, created.body.id);

    const drift = await request(`/api/finance/credit-overrides/${created.body.id}/reject`, {
      method: 'POST',
      token: managerToken,
      idempotencyKey: rejectKey,
      body: {
        expectedVersion: checked.body.version,
        reason: 'Lý do đã thay đổi',
      },
    });
    assert.equal(drift.status, 409);
    assert.match(String(drift.body.error), /Khóa giao dịch trùng/i);

    const staleApprove = await request(`/api/finance/credit-overrides/${created.body.id}/approve`, {
      method: 'POST',
      token: adminToken,
      idempotencyKey: `q23-credit-stale-approve-${created.body.id}`,
      body: { expectedVersion: checked.body.version },
    });
    assert.equal(staleApprove.status, 409);
  });

  test('sorts the queue by whitelisted columns with sort-aware cursor pagination', async () => {
    const customer = await mkCustomer('10000000');
    await mkLedger(customer.id, 10_600_000);

    // Amounts chosen so numeric and lexicographic order differ.
    const amounts = [400_000, 100_000, 300_000, 200_000];
    for (const [index, amount] of amounts.entries()) {
      const created = await request('/api/finance/credit-overrides', {
        method: 'POST',
        token: managerToken,
        idempotencyKey: `q01-credit-sort-${customer.id}-${index}`,
        body: {
          customerId: customer.id,
          proposedAmount: amount,
          expiresAt: futureExpiry,
          reason: `Đề nghị sắp xếp ${amount}`,
        },
      });
      assert.equal(created.status, 201);
    }

    const listUrl = (params: string) =>
      `/api/finance/credit-overrides?customerId=${customer.id}&status=PENDING&${params}`;
    const amountsOf = (body: { items: Array<{ proposedAmount: string }> }) =>
      body.items.map((item) => Number(item.proposedAmount));

    // Asc walk over two pages: page 1 hands back a sort-keyed cursor that
    // page 2 continues exactly (numeric order, no dupes, no skips).
    const ascPage1 = await request(
      listUrl('limit=2&sortBy=proposedAmount&sortDir=asc'),
      { token: managerToken },
    );
    assert.equal(ascPage1.status, 200);
    assert.deepEqual(amountsOf(ascPage1.body), [100_000, 200_000]);
    assert.equal(ascPage1.body.hasMore, true);

    const ascPage2 = await request(
      listUrl(`limit=2&sortBy=proposedAmount&sortDir=asc&cursor=${encodeURIComponent(ascPage1.body.nextCursor)}`),
      { token: managerToken },
    );
    assert.equal(ascPage2.status, 200);
    assert.deepEqual(amountsOf(ascPage2.body), [300_000, 400_000]);
    assert.equal(ascPage2.body.hasMore, false);

    // Desc inverts the whole set on one page.
    const desc = await request(
      listUrl('limit=10&sortBy=proposedAmount&sortDir=desc'),
      { token: managerToken },
    );
    assert.deepEqual(amountsOf(desc.body), [400_000, 300_000, 200_000, 100_000]);

    // A sorted cursor cannot continue under a different direction…
    const mismatchedDir = await request(
      listUrl(`limit=2&sortBy=proposedAmount&sortDir=desc&cursor=${encodeURIComponent(ascPage1.body.nextCursor)}`),
      { token: managerToken },
    );
    assert.equal(mismatchedDir.status, 400);

    // …and a default-order cursor cannot continue a sorted request.
    const defaultPage = await request(listUrl('limit=2'), { token: managerToken });
    assert.equal(defaultPage.status, 200);
    const reusedCursor = await request(
      listUrl(`limit=2&sortBy=proposedAmount&sortDir=asc&cursor=${encodeURIComponent(defaultPage.body.nextCursor)}`),
      { token: managerToken },
    );
    assert.equal(reusedCursor.status, 400);

    // Absent sort params keep the newest-first default exactly (the 200k
    // request was created last).
    assert.equal(Number(defaultPage.body.items[0].proposedAmount), 200_000);
  });

  test('lists filtered history through a stable cursor during concurrent inserts and status changes', async () => {
    const customer = await mkCustomer('10000000');
    await mkLedger(customer.id, 10_500_000);

    for (let index = 1; index <= 3; index += 1) {
      const created = await request('/api/finance/credit-overrides', {
        method: 'POST',
        token: managerToken,
        idempotencyKey: `q01-credit-page-${customer.id}-${index}`,
        body: {
          customerId: customer.id,
          proposedAmount: 100_000 + index,
          expiresAt: futureExpiry,
          reason: `Đề nghị phân trang ${index}`,
        },
      });
      assert.equal(created.status, 201);
    }

    const originalIds = [...createdCreditOverrideIds].slice(-3);
    const firstPage = await request(
      `/api/finance/credit-overrides?customerId=${customer.id}&status=PENDING&limit=2`,
      { token: managerToken },
    );

    const concurrent = await request('/api/finance/credit-overrides', {
      method: 'POST',
      token: managerToken,
      idempotencyKey: `q01-credit-page-${customer.id}-concurrent`,
      body: {
        customerId: customer.id,
        proposedAmount: 200_000,
        expiresAt: futureExpiry,
        reason: 'Đề nghị tạo đồng thời sau trang đầu',
      },
    });
    assert.equal(concurrent.status, 201);
    await db.update(s.creditOverrideRequests)
      .set({ status: 'CANCELED' })
      .where(eq(s.creditOverrideRequests.id, firstPage.body.items[0].id));

    const secondPage = await request(
      `/api/finance/credit-overrides?customerId=${customer.id}&status=PENDING&limit=2&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`,
      { token: managerToken },
    );

    assert.equal(firstPage.status, 200);
    assert.equal(secondPage.status, 200);
    assert.equal(firstPage.body.limit, 2);
    assert.equal(firstPage.body.items.length, 2);
    assert.equal(firstPage.body.hasMore, true);
    assert.equal(typeof firstPage.body.nextCursor, 'string');
    assert.equal(secondPage.body.items.length, 1);
    assert.equal(secondPage.body.hasMore, false);
    const traversedIds = [...firstPage.body.items, ...secondPage.body.items]
      .map((row: { id: number }) => row.id);
    assert.equal(new Set(traversedIds).size, traversedIds.length);
    assert.equal(traversedIds.includes(concurrent.body.id), false);
    assert.deepEqual(
      traversedIds.filter((id: number) => originalIds.includes(id)).sort((a: number, b: number) => a - b),
      originalIds.sort((a, b) => a - b),
    );
  });

  test('credit override create rolls back when idempotency persistence fails after the business callback', async () => {
    const customer = await mkCustomer('10000000');
    await mkLedger(customer.id, 10_700_000);
    const createKey = `q23-credit-fail-${customer.id}`;
    const reason = `Q23 rollback credit ${suffix}`;

    await withIdempotencyInsertFailure('credit-overrides.create', createKey, async () => {
      const response = await request('/api/finance/credit-overrides', {
        method: 'POST',
        token: managerToken,
        idempotencyKey: createKey,
        body: {
          customerId: customer.id,
          proposedAmount: 150_000,
          expiresAt: futureExpiry,
          reason,
        },
      });
      assert.equal(response.status, 500);
    });

    const storedRequests = await db.select()
      .from(s.creditOverrideRequests)
      .where(and(
        eq(s.creditOverrideRequests.customerId, customer.id),
        eq(s.creditOverrideRequests.reason, reason),
      ));
    assert.equal(storedRequests.length, 0);

    const storedKeys = await db.select()
      .from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, createKey));
    assert.equal(storedKeys.length, 0);
  });
});
