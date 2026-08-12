import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import {
  NO_INVOICE_DEFAULT_CATEGORY_ALIASES,
  NO_INVOICE_REQUIRED_SCOPE,
  Role,
} from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { config } from '../config';
import { db, client } from '../db';
import * as s from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { cacheInvalidate, disconnectRedis } from '../lib/redis';
import configRoutes, { catalogBootstrapRouter } from '../routes/config';
import forwarderRoutes from '../routes/forwarder';
import financialRoutes from '../routes/financial';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdExpenseTypeIds: number[] = [];
const createdGovernanceActionIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdBusinessUnitIds: number[] = [];
let server: http.Server;
let baseUrl: string;
let adminToken: string;
let accountantToken: string;
let managerToken: string;
let forwarderToken: string;
let clerkToken: string;

type BoundarySnapshot = {
  defaultCategoryAliases: string[];
  requiredScope: string;
  financeLeadApprovalTitle: string;
  directorApprovalTitle: string;
};

type BootstrapExpenseType = {
  id: number;
  code: string;
  noInvoicePolicySnapshot: BoundarySnapshot | null;
};

async function mkUser(username: string, role: Role) {
  const [user] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

async function mkCustomer(name: string) {
  const [customer] = await db.insert(s.customers).values({ name }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkBusinessUnit(code: string, name: string) {
  const [businessUnit] = await db.insert(s.businessUnits).values({
    code,
    name,
    status: 'ACTIVE',
  }).returning();
  createdBusinessUnitIds.push(businessUnit.id);
  return businessUnit;
}

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `user-${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function request(path: string, init: {
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
} = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function approvePendingAction(action: { id: number; version: number }) {
  createdGovernanceActionIds.push(action.id);
  const checked = await request(`/api/governance-actions/${action.id}/check`, {
    method: 'POST',
    token: accountantToken,
    headers: { 'Idempotency-Key': `q12q13-check-${action.id}-${action.version}` },
    body: { expectedVersion: action.version },
  });
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  assert.equal(checked.body.status, 'PENDING_APPROVAL');

  const approved = await request(`/api/governance-actions/${action.id}/approve`, {
    method: 'POST',
    token: managerToken,
    headers: { 'Idempotency-Key': `q12q13-approve-${action.id}-${checked.body.version}` },
    body: { expectedVersion: checked.body.version },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, 'APPROVED');
  return approved.body;
}

before(async () => {
  await initEnforcer();
  await cacheInvalidate('catalogs:bootstrap');

  const app = express();
  app.use(express.json());
  app.use('/api/forwarder/me', authMiddleware, casbinAuthz('operations_portal'), forwarderRoutes);
  app.use('/api', authMiddleware, catalogBootstrapRouter);
  app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
  app.use('/api', authMiddleware, casbinAuthz('financial'), financialRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  adminToken = sign(await mkUser(`q12q13-admin-${suffix}`, Role.ADMIN));
  accountantToken = sign(await mkUser(`q12q13-accountant-${suffix}`, Role.ACCOUNTANT));
  managerToken = sign(await mkUser(`q12q13-manager-${suffix}`, Role.MANAGER));
  forwarderToken = sign(await mkUser(`q12q13-forwarder-${suffix}`, Role.OPS));

  const clerk = await mkUser(`q12q13-clerk-${suffix}`, Role.CUS);
  clerkToken = sign(clerk);
  const scopedCustomer = await mkCustomer(`Q12Q13 scoped customer ${suffix}`);
  const hiddenCustomer = await mkCustomer(`Q12Q13 hidden customer ${suffix}`);
  const scopedBusinessUnit = await mkBusinessUnit(`Q12SC-${suffix.slice(-4)}`, `Q12 scoped unit ${suffix}`);
  const hiddenBusinessUnit = await mkBusinessUnit(`Q12HD-${suffix.slice(-4)}`, `Q12 hidden unit ${suffix}`);
  await db.insert(s.userCustomerLinks).values({ userId: clerk.id, customerId: scopedCustomer.id });
  await db.insert(s.userBusinessUnitLinks).values({ userId: clerk.id, businessUnitId: scopedBusinessUnit.id });
  clerkToken = jwt.sign(
    {
      userId: clerk.id,
      username: clerk.username ?? `user-${clerk.id}`,
      role: Role.CUS,
      customerId: scopedCustomer.id,
      customerIds: [scopedCustomer.id],
    },
    config.jwtSecret,
  );
  assert.ok(hiddenCustomer.id > 0);
  assert.ok(hiddenBusinessUnit.id > 0);
  await cacheInvalidate('catalogs:bootstrap');
});

after(async () => {
  try {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    if (createdUserIds.length > 0) {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.governanceActions)
        .where(inArray(s.governanceActions.makerId, createdUserIds));
    }
    if (createdExpenseTypeIds.length > 0) {
      await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, createdExpenseTypeIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.userBusinessUnitLinks).where(inArray(s.userBusinessUnitLinks.userId, createdUserIds));
      await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.userId, createdUserIds));
    }
    if (createdBusinessUnitIds.length > 0) {
      await db.delete(s.businessUnits).where(inArray(s.businessUnits.id, createdBusinessUnitIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
    await cacheInvalidate('catalogs:bootstrap');
  } finally {
    await disconnectRedis();
    await client.end();
  }
});

describe('Q12/Q13 no-invoice route boundaries', () => {
  test('bootstrap surfaces seeded accepted aliases and explicit trip-or-shipment scope', async () => {
    const response = await request('/api/catalogs/bootstrap', { token: adminToken });
    assert.equal(response.status, 200);

    const types = new Map(
      (response.body.forwarderExpenseTypes as BootstrapExpenseType[])
        .map((item) => [item.code, item.noInvoicePolicySnapshot]),
    );

    for (const code of ['LIFTING', 'INFRASTRUCTURE', 'INSPECTION', 'OTHER'] as const) {
      const snapshot = types.get(code);
      assert.ok(snapshot, `seeded category ${code} should expose a no-invoice policy snapshot`);
      assert.deepEqual(snapshot.defaultCategoryAliases, [...NO_INVOICE_DEFAULT_CATEGORY_ALIASES[code]]);
      assert.equal(snapshot.requiredScope, NO_INVOICE_REQUIRED_SCOPE);
    }
  });

  test('clerk bootstrap only exposes assigned customers and business units', async () => {
    const response = await request('/api/catalogs/bootstrap', { token: clerkToken });
    assert.equal(response.status, 200);

    const customerNames = new Set((response.body.customers as Array<{ name: string }>).map((item) => item.name));
    const businessUnitNames = new Set((response.body.businessUnits as Array<{ name: string }>).map((item) => item.name));

    assert.ok(customerNames.has(`Q12Q13 scoped customer ${suffix}`));
    assert.ok(!customerNames.has(`Q12Q13 hidden customer ${suffix}`));
    assert.ok(businessUnitNames.has(`Q12 scoped unit ${suffix}`));
    assert.ok(!businessUnitNames.has(`Q12 hidden unit ${suffix}`));
  });

  test('clerk bootstrap returns empty scoped lists when no customer or unit is assigned', async () => {
    const unassignedClerkToken = sign(await mkUser(`q12q13-clerk-empty-${suffix}`, Role.CUS));
    const response = await request('/api/catalogs/bootstrap', { token: unassignedClerkToken });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.customers, []);
    assert.deepEqual(response.body.businessUnits, []);
  });

  test('config CRUD persists policy-configurable approval titles and only bumps version on policy change', async () => {
    const create = await request('/api/forwarder-expense-types', {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `q12q13-create-${suffix}` },
      body: {
        code: `Q12Q13-${suffix}`.slice(0, 50),
        name: `Q12/Q13 config ${suffix}`,
        requiresInvoice: false,
        substituteEvidenceAllowed: true,
        noInvoiceEvidenceTypes: ['RECEIPT', 'SIGNED_CONFIRMATION'],
        noInvoicePerItemLimit: 400000,
        noInvoicePerDayLimit: 700000,
        noInvoiceFinanceLeadApprovalTitle: 'DIRECTOR',
        noInvoiceDirectorApprovalTitle: 'DIRECTOR',
      },
    });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    assert.equal(create.body.status, 'PENDING_CHECK');
    await approvePendingAction(create.body);
    const [created] = await db.select().from(s.forwarderExpenseTypes)
      .where(eq(s.forwarderExpenseTypes.code, `Q12Q13-${suffix}`.slice(0, 50)))
      .limit(1);
    assert.ok(created);
    createdExpenseTypeIds.push(created.id);
    assert.equal(created.noInvoiceFinanceLeadApprovalTitle, 'DIRECTOR');
    assert.equal(created.noInvoiceDirectorApprovalTitle, 'DIRECTOR');
    assert.equal(created.noInvoicePolicyVersion, 1);

    const bootstrap = await request('/api/catalogs/bootstrap', { token: adminToken });
    const createdType = (bootstrap.body.forwarderExpenseTypes as BootstrapExpenseType[])
      .find((item) => item.id === created.id);
    assert.ok(createdType);
    assert.equal(createdType.noInvoicePolicySnapshot?.financeLeadApprovalTitle, 'DIRECTOR');
    assert.equal(createdType.noInvoicePolicySnapshot?.directorApprovalTitle, 'DIRECTOR');
    assert.deepEqual(createdType.noInvoicePolicySnapshot?.defaultCategoryAliases, [created.name]);
    assert.equal(createdType.noInvoicePolicySnapshot?.requiredScope, NO_INVOICE_REQUIRED_SCOPE);

    const noChange = await request(`/api/forwarder-expense-types/${created.id}`, {
      method: 'PUT',
      token: adminToken,
      headers: {
        'Idempotency-Key': `q12q13-nochange-${suffix}`,
        'If-Unmodified-Since': created.updatedAt.toISOString(),
      },
      body: {
        ...created,
        createdAt: undefined,
        updatedAt: undefined,
        deletedAt: undefined,
      },
    });
    assert.equal(noChange.status, 201, JSON.stringify(noChange.body));
    await approvePendingAction(noChange.body);
    const [unchanged] = await db.select().from(s.forwarderExpenseTypes)
      .where(eq(s.forwarderExpenseTypes.id, created.id))
      .limit(1);
    assert.equal(unchanged.noInvoicePolicyVersion, 1);

    const changed = await request(`/api/forwarder-expense-types/${created.id}`, {
      method: 'PUT',
      token: adminToken,
      headers: {
        'Idempotency-Key': `q12q13-change-${suffix}`,
        'If-Unmodified-Since': unchanged.updatedAt.toISOString(),
      },
      body: {
        ...unchanged,
        createdAt: undefined,
        updatedAt: undefined,
        deletedAt: undefined,
        noInvoiceFinanceLeadApprovalTitle: 'FINANCE_LEAD',
      },
    });
    assert.equal(changed.status, 201, JSON.stringify(changed.body));
    await approvePendingAction(changed.body);
    const [updated] = await db.select().from(s.forwarderExpenseTypes)
      .where(eq(s.forwarderExpenseTypes.id, created.id))
      .limit(1);
    assert.equal(updated.noInvoicePolicyVersion, 2);
  });

  test('invalid approval title is rejected at the config boundary', async () => {
    const response = await request('/api/forwarder-expense-types', {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `q12q13-invalid-${suffix}` },
      body: {
        code: `Q12Q13-BAD-${suffix}`.slice(0, 50),
        name: 'Invalid title',
        noInvoiceFinanceLeadApprovalTitle: 'BAD_TITLE',
      },
    });
    assert.equal(response.status, 400);
  });

  test('forwarder catalog exposes the same no-invoice policy snapshot while config routes stay forbidden', async () => {
    const expenseTypes = await request('/api/forwarder/me/expense-types', { token: forwarderToken });
    assert.equal(expenseTypes.status, 200);
    const other = (expenseTypes.body as BootstrapExpenseType[])
      .find((item) => item.code === 'OTHER');
    assert.ok(other);
    assert.deepEqual(other.noInvoicePolicySnapshot?.defaultCategoryAliases, [...NO_INVOICE_DEFAULT_CATEGORY_ALIASES.OTHER]);
    assert.equal(other.noInvoicePolicySnapshot?.requiredScope, NO_INVOICE_REQUIRED_SCOPE);

    const forbidden = await request('/api/forwarder-expense-types', { token: forwarderToken });
    assert.equal(forbidden.status, 403);
  });
});
