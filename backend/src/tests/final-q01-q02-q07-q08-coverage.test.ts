import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';

import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';
import financialRoutes from '../routes/financial';
import { appSettingsRouter } from '../routes/app-settings';
import { disconnectRedis } from '../lib/redis';
import { getAppSettings, saveAppSettings } from '../services/app-settings.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const futureExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000).toISOString();

const userIds: number[] = [];
const customerIds: number[] = [];
const supplierIds: number[] = [];
const partnerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const tripIds: number[] = [];
const expenseIds: number[] = [];
const ledgerIds: number[] = [];
const creditOverrideIds: number[] = [];
const governanceActionIds: number[] = [];
const idempotencyKeys: string[] = [];

let scopedCustomerId = 0;
let server: http.Server;
let baseUrl = '';
let originalSettings: Awaited<ReturnType<typeof getAppSettings>>;

let adminToken: string;
let managerToken: string;
let accountantToken: string;
let customerToken: string;
let driverToken: string;
let forwarderToken: string;
let clerkToken: string;

type SignedUser = {
  id: number;
  username: string | null;
  role: Role;
  customerId?: number;
  customerIds?: number[];
};

type RequestInit = {
  method?: string;
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
  expectedUpdatedAt?: string;
};

type ApiResponse<T> = {
  status: number;
  body: T;
};

function sign(user: SignedUser): string {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username ?? `user-${user.id}`,
      role: user.role,
      customerId: user.customerId,
      customerIds: user.customerIds,
    },
    config.jwtSecret,
  );
}

function addIdempotencyKey(key: string): string {
  idempotencyKeys.push(key);
  return key;
}

function toNumber(value: unknown): number {
  return Number(value);
}

async function request<T = unknown>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  if (init.expectedUpdatedAt) headers['If-Unmodified-Since'] = init.expectedUpdatedAt;
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await response.json().catch(() => ({})) as T;
  return { status: response.status, body };
}

type PendingGovernanceAction = {
  id: number;
  version: number;
  status: string;
};

async function approvePendingAction(action: PendingGovernanceAction) {
  governanceActionIds.push(action.id);
  assert.equal(action.status, 'PENDING_CHECK');
  const checked = await request<PendingGovernanceAction>(
    `/api/governance-actions/${action.id}/check`,
    {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: addIdempotencyKey(`final-governance-check-${suffix}-${action.id}-${action.version}`),
      body: { expectedVersion: action.version },
    },
  );
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  assert.equal(checked.body.status, 'PENDING_APPROVAL');

  const approved = await request<PendingGovernanceAction>(
    `/api/governance-actions/${action.id}/approve`,
    {
      method: 'POST',
      token: managerToken,
      idempotencyKey: addIdempotencyKey(`final-governance-approve-${suffix}-${action.id}-${checked.body.version}`),
      body: { expectedVersion: checked.body.version },
    },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, 'APPROVED');
}

async function mkUser(role: Role, options: { customerId?: number } = {}) {
  const [user] = await db.insert(s.users).values({
    username: `final-${role.toLowerCase()}-${suffix}-${userIds.length}`,
    passwordHash: 'test',
    role,
    status: 'ACTIVE',
    customerId: options.customerId ?? null,
  }).returning();
  userIds.push(user.id);
  return {
    id: user.id,
    username: user.username,
    role: user.role as Role,
    customerId: user.customerId ?? undefined,
  };
}

async function mkCustomerRow(values: Partial<typeof s.customers.$inferInsert> = {}) {
  const [customer] = await db.insert(s.customers).values({
    name: values.name ?? `Final customer ${suffix}-${customerIds.length}`,
    creditLimit: values.creditLimit,
    taxCode: values.taxCode,
    creditWarningThreshold: values.creditWarningThreshold,
    status: values.status,
    isCarrier: values.isCarrier,
    paymentDatePolicy: values.paymentDatePolicy,
  }).returning();
  customerIds.push(customer.id);
  return customer;
}

async function mkRouteRow() {
  const [route] = await db.insert(s.routes).values({
    name: `Final route ${suffix}-${routeIds.length}`,
  }).returning();
  routeIds.push(route.id);
  return route;
}

async function mkCargoTypeRow() {
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Final cargo ${suffix}-${cargoTypeIds.length}`,
  }).returning();
  cargoTypeIds.push(cargoType.id);
  return cargoType;
}

async function mkTripRow(customerId: number, supplierId: number) {
  const route = await mkRouteRow();
  const cargoType = await mkCargoTypeRow();
  const [trip] = await db.insert(s.trips).values({
    tripCode: `FINAL-${suffix}-${tripIds.length}`.slice(0, 50),
    customerId,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    departureDate: '2026-07-25',
    status: 'COMPLETED',
    carrierType: 'OWN',
    fuelSupplierId: supplierId,
    totalFuelCost: '250000',
  }).returning();
  tripIds.push(trip.id);
  return trip;
}

async function mkLedgerRow(customerId: number, debit: number) {
  const [ledger] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER',
    entityId: customerId,
    txnType: 'TRIP_REVENUE',
    txnId: 0,
    debit: String(debit),
    credit: '0',
    balance: String(debit),
    note: `Final ledger ${suffix}-${ledgerIds.length}`,
  }).returning();
  ledgerIds.push(ledger.id);
  return ledger;
}

before(async () => {
  await initEnforcer();
  originalSettings = await getAppSettings();
  const scopedCustomer = await mkCustomerRow({
    name: `Final scoped customer ${suffix}`,
  });
  scopedCustomerId = scopedCustomer.id;

  const admin = await mkUser(Role.ADMIN);
  const manager = await mkUser(Role.MANAGER);
  const accountant = await mkUser(Role.ACCOUNTANT);
  const customer = await mkUser(Role.CUSTOMER, { customerId: scopedCustomer.id });
  const driver = await mkUser(Role.DRIVER);
  const forwarder = await mkUser(Role.OPS);
  const clerk = await mkUser(Role.CUS);

  adminToken = sign(admin);
  managerToken = sign(manager);
  accountantToken = sign(accountant);
  customerToken = sign(customer);
  driverToken = sign(driver);
  forwarderToken = sign(forwarder);
  clerkToken = sign(clerk);

  const app = express();
  app.use(express.json());
  app.use('/api/admin/app-settings', authMiddleware, casbinAuthz('config'), appSettingsRouter);
  app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
  app.use('/api', authMiddleware, casbinAuthz('financial'), financialRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  try {
    await saveAppSettings(originalSettings);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });

    if (governanceActionIds.length > 0) {
      await db.delete(s.governanceActions)
        .where(inArray(s.governanceActions.id, governanceActionIds));
    }
    if (userIds.length > 0) {
      await db.delete(s.governanceActions)
        .where(inArray(s.governanceActions.makerId, userIds));
    }
    if (idempotencyKeys.length > 0) {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
    }
    if (expenseIds.length > 0) {
      await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, expenseIds));
    }
    if (creditOverrideIds.length > 0) {
      await db.delete(s.creditOverrideRequests).where(inArray(s.creditOverrideRequests.id, creditOverrideIds));
    }
    if (ledgerIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
    }
    if (tripIds.length > 0) {
      await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    }
    if (cargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
    }
    if (routeIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    }
    if (supplierIds.length > 0) {
      await db.delete(s.suppliers).where(inArray(s.suppliers.id, supplierIds));
    }
    if (customerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    }
    if (partnerIds.length > 0) {
      await db.delete(s.partners).where(inArray(s.partners.id, [...new Set(partnerIds)]));
    }
    if (userIds.length > 0) {
      await db.delete(s.notifications).where(inArray(s.notifications.userId, userIds));
      await db.delete(s.users).where(inArray(s.users.id, userIds));
    }
  } finally {
    await disconnectRedis();
    await client.end();
  }
});

describe('final audit proof coverage for Q01/Q02/Q07/Q08', () => {
  test('Q01 persists global default and customer override into live credit override snapshots', async () => {
    const readSettings = await request<Awaited<ReturnType<typeof getAppSettings>> & { updatedAt: string | null }>(
      '/api/admin/app-settings/',
      {
      token: adminToken,
      },
    );
    assert.equal(readSettings.status, 200);

    const writeSettings = await request<PendingGovernanceAction>('/api/admin/app-settings/', {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: addIdempotencyKey(`final-q01-settings-${suffix}`),
      expectedUpdatedAt: readSettings.body.updatedAt ?? undefined,
      body: {
        ...originalSettings,
        creditWarningThresholdDefault: 0.67,
        creditTierOneAmountCap: 5_000_000,
      },
    });
    assert.equal(writeSettings.status, 201, JSON.stringify(writeSettings.body));
    await approvePendingAction(writeSettings.body);
    assert.equal((await getAppSettings()).creditWarningThresholdDefault, 0.67);

    const customerName = `Final Q01 customer ${suffix}`;
    const createdCustomerAction = await request<PendingGovernanceAction>('/api/customers', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: addIdempotencyKey(`final-q01-customer-${suffix}`),
      body: {
        name: customerName,
        creditLimit: 1_000_000,
      },
    });
    assert.equal(createdCustomerAction.status, 201, JSON.stringify(createdCustomerAction.body));
    await approvePendingAction(createdCustomerAction.body);
    const [createdCustomer] = await db.select().from(s.customers)
      .where(eq(s.customers.name, customerName))
      .limit(1);
    assert.ok(createdCustomer);
    customerIds.push(createdCustomer.id);

    await mkLedgerRow(createdCustomer.id, 1_100_000);

    const defaultScopedOverride = await request<{ id: number; warningThreshold: string }>('/api/finance/credit-overrides', {
      method: 'POST',
      token: managerToken,
      idempotencyKey: addIdempotencyKey(`final-q01-default-override-${suffix}`),
      body: {
        customerId: createdCustomer.id,
        proposedAmount: 100_000,
        expiresAt: futureExpiry,
        reason: 'Chứng minh ngưỡng cảnh báo mặc định',
      },
    });
    assert.equal(defaultScopedOverride.status, 201, JSON.stringify(defaultScopedOverride.body));
    creditOverrideIds.push(defaultScopedOverride.body.id);
    assert.equal(toNumber(defaultScopedOverride.body.warningThreshold), 0.67);

    const updatedCustomerAction = await request<PendingGovernanceAction>('/api/customers/' + createdCustomer.id, {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: addIdempotencyKey(`final-q01-customer-update-${suffix}`),
      expectedUpdatedAt: createdCustomer.updatedAt.toISOString(),
      body: {
        creditWarningThreshold: 0.92,
      },
    });
    assert.equal(updatedCustomerAction.status, 201, JSON.stringify(updatedCustomerAction.body));
    await approvePendingAction(updatedCustomerAction.body);
    const [updatedCustomer] = await db.select().from(s.customers)
      .where(eq(s.customers.id, createdCustomer.id))
      .limit(1);
    assert.equal(toNumber(updatedCustomer.creditWarningThreshold), 0.92);

    const customerScopedOverride = await request<{ id: number; warningThreshold: string }>('/api/finance/credit-overrides', {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: addIdempotencyKey(`final-q01-customer-override-${suffix}`),
      body: {
        customerId: createdCustomer.id,
        proposedAmount: 120_000,
        expiresAt: futureExpiry,
        reason: 'Chứng minh ngưỡng cảnh báo riêng khách hàng',
      },
    });
    assert.equal(customerScopedOverride.status, 201, JSON.stringify(customerScopedOverride.body));
    creditOverrideIds.push(customerScopedOverride.body.id);
    assert.equal(toNumber(customerScopedOverride.body.warningThreshold), 0.92);
  });

  test('Q02 denies customer, driver, forwarder, and clerk across credit override HTTP routes', async () => {
    const creditCustomer = await mkCustomerRow({
      name: `Final Q02 customer ${suffix}`,
      creditLimit: '1000000',
    });
    await mkLedgerRow(creditCustomer.id, 1_150_000);

    const pending = await request<{ id: number; version: number }>('/api/finance/credit-overrides', {
      method: 'POST',
      token: managerToken,
      idempotencyKey: addIdempotencyKey(`final-q02-pending-${suffix}`),
      body: {
        customerId: creditCustomer.id,
        proposedAmount: 80_000,
        expiresAt: futureExpiry,
        reason: 'Tạo đề nghị để kiểm tra chặn quyền',
      },
    });
    assert.equal(pending.status, 201, JSON.stringify(pending.body));
    creditOverrideIds.push(pending.body.id);

    for (const token of [customerToken, driverToken, forwarderToken, clerkToken]) {
      assert.equal((await request('/api/finance/credit-overrides', { token })).status, 403);
      assert.equal((await request(`/api/finance/credit-overrides/${pending.body.id}`, { token })).status, 403);
      assert.equal((await request('/api/finance/credit-overrides', {
        method: 'POST',
        token,
        body: {
          customerId: scopedCustomerId,
          proposedAmount: 50_000,
          expiresAt: futureExpiry,
          reason: 'Không được phép tạo đề nghị',
        },
      })).status, 403);
      assert.equal((await request(`/api/finance/credit-overrides/${pending.body.id}/approve`, {
        method: 'POST',
        token,
        body: { expectedVersion: pending.body.version },
      })).status, 403);
      assert.equal((await request(`/api/finance/credit-overrides/${pending.body.id}/reject`, {
        method: 'POST',
        token,
        body: {
          expectedVersion: pending.body.version,
          reason: 'Không được phép từ chối',
        },
      })).status, 403);
    }
  });

  test('Q07 supplier primary type edits do not reclassify existing trip expenses', async () => {
    const supplierName = `Final Q07 supplier ${suffix}`;
    const createdSupplierAction = await request<PendingGovernanceAction>('/api/suppliers', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: addIdempotencyKey(`final-q07-supplier-${suffix}`),
      body: {
        name: supplierName,
        types: ['FUEL'],
        primaryType: 'FUEL',
        isFuelSupplier: true,
      },
    });
    assert.equal(createdSupplierAction.status, 201, JSON.stringify(createdSupplierAction.body));
    await approvePendingAction(createdSupplierAction.body);
    const [createdSupplier] = await db.select().from(s.suppliers)
      .where(eq(s.suppliers.name, supplierName))
      .limit(1);
    assert.ok(createdSupplier);
    supplierIds.push(createdSupplier.id);
    assert.equal(createdSupplier.primaryType, 'FUEL');
    assert.equal(createdSupplier.isFuelSupplier, true);

    const tripCustomer = await mkCustomerRow({
      name: `Final Q07 trip customer ${suffix}`,
    });
    const trip = await mkTripRow(tripCustomer.id, createdSupplier.id);
    const [expense] = await db.insert(s.tripExpenses).values({
      tripId: trip.id,
      expenseType: 'FUEL_DIESEL',
      buyAmount: '250000',
      sellAmount: '0',
      supplierId: createdSupplier.id,
      expenseDate: '2026-07-25',
      invoiceNumber: `Q07-${suffix}`.slice(0, 50),
      invoiceDate: '2026-07-25',
      approvalStatus: 'APPROVED',
    }).returning();
    expenseIds.push(expense.id);

    const updatedSupplierAction = await request<PendingGovernanceAction>('/api/suppliers/' + createdSupplier.id, {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: addIdempotencyKey(`final-q07-supplier-update-${suffix}`),
      expectedUpdatedAt: createdSupplier.updatedAt.toISOString(),
      body: {
        types: ['SERVICE'],
        primaryType: 'SERVICE',
      },
    });
    assert.equal(updatedSupplierAction.status, 201, JSON.stringify(updatedSupplierAction.body));
    await approvePendingAction(updatedSupplierAction.body);
    const [updatedSupplier] = await db.select().from(s.suppliers)
      .where(eq(s.suppliers.id, createdSupplier.id))
      .limit(1);
    assert.ok(updatedSupplier);
    assert.equal(updatedSupplier.primaryType, 'SERVICE');
    assert.equal(updatedSupplier.isFuelSupplier, false);

    const [storedExpense] = await db.select({
      expenseType: s.tripExpenses.expenseType,
      supplierId: s.tripExpenses.supplierId,
    }).from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, expense.id))
      .limit(1);
    assert.equal(storedExpense?.expenseType, 'FUEL_DIESEL');
    assert.equal(storedExpense?.supplierId, createdSupplier.id);
  });

  test('Q07 supplier API rejects unknown categories and a primary outside selected types', async () => {
    const unknownType = await request('/api/suppliers', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: addIdempotencyKey(`final-q07-invalid-type-${suffix}`),
      body: {
        name: `Final Q07 invalid type ${suffix}`,
        types: ['FUEL', 'GAS'],
        primaryType: 'FUEL',
      },
    });
    assert.equal(unknownType.status, 400, JSON.stringify(unknownType.body));

    const invalidPrimary = await request('/api/suppliers', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: addIdempotencyKey(`final-q07-invalid-primary-${suffix}`),
      body: {
        name: `Final Q07 invalid primary ${suffix}`,
        types: ['FUEL'],
        primaryType: 'SERVICE',
      },
    });
    assert.equal(invalidPrimary.status, 400, JSON.stringify(invalidPrimary.body));
  });

  test('Q08 customer and supplier CRUD converge on one canonical partner for the same normalized tax code', async () => {
    const q08CustomerName = `Final Q08 customer ${suffix}`;
    const createdCustomerAction = await request<PendingGovernanceAction>('/api/customers', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: addIdempotencyKey(`final-q08-customer-${suffix}`),
      body: {
        name: q08CustomerName,
        taxCode: ' MST 123 ',
      },
    });
    assert.equal(createdCustomerAction.status, 201, JSON.stringify(createdCustomerAction.body));
    await approvePendingAction(createdCustomerAction.body);
    const [createdCustomer] = await db.select().from(s.customers)
      .where(eq(s.customers.name, q08CustomerName))
      .limit(1);
    assert.ok(createdCustomer);
    customerIds.push(createdCustomer.id);

    const q08SupplierName = `Final Q08 supplier ${suffix}`;
    const createdSupplierAction = await request<PendingGovernanceAction>('/api/suppliers', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: addIdempotencyKey(`final-q08-supplier-${suffix}`),
      body: {
        name: q08SupplierName,
        taxCode: 'm s t123',
        types: ['SERVICE'],
        primaryType: 'SERVICE',
      },
    });
    assert.equal(createdSupplierAction.status, 201, JSON.stringify(createdSupplierAction.body));
    await approvePendingAction(createdSupplierAction.body);
    const [createdSupplier] = await db.select().from(s.suppliers)
      .where(eq(s.suppliers.name, q08SupplierName))
      .limit(1);
    assert.ok(createdSupplier);
    supplierIds.push(createdSupplier.id);

    const [storedCustomer] = await db.select({
      partnerId: s.customers.partnerId,
    }).from(s.customers)
      .where(eq(s.customers.id, createdCustomer.id))
      .limit(1);
    const [storedSupplier] = await db.select({
      partnerId: s.suppliers.partnerId,
    }).from(s.suppliers)
      .where(eq(s.suppliers.id, createdSupplier.id))
      .limit(1);
    assert.ok(storedCustomer?.partnerId != null);
    assert.equal(storedSupplier?.partnerId, storedCustomer?.partnerId);

    if (storedCustomer?.partnerId != null) {
      partnerIds.push(storedCustomer.partnerId);
    }

    const normalizedPartners = await db.select({
      id: s.partners.id,
    }).from(s.partners)
      .where(eq(s.partners.normalizedTaxCode, 'mst123'));
    assert.equal(normalizedPartners.length, 1);

    const updatedCustomerAction = await request<PendingGovernanceAction>('/api/customers/' + createdCustomer.id, {
      method: 'PUT',
      token: adminToken,
      idempotencyKey: addIdempotencyKey(`final-q08-customer-update-${suffix}`),
      expectedUpdatedAt: createdCustomer.updatedAt.toISOString(),
      body: {
        taxCode: ' M S T 123 ',
      },
    });
    assert.equal(updatedCustomerAction.status, 201, JSON.stringify(updatedCustomerAction.body));
    await approvePendingAction(updatedCustomerAction.body);
    const [updatedCustomer] = await db.select({ partnerId: s.customers.partnerId })
      .from(s.customers)
      .where(eq(s.customers.id, createdCustomer.id))
      .limit(1);
    assert.ok(updatedCustomer);
    assert.equal(updatedCustomer.partnerId, storedCustomer?.partnerId ?? null);

    const normalizedPartnersAfterUpdate = await db.select({
      id: s.partners.id,
    }).from(s.partners)
      .where(eq(s.partners.normalizedTaxCode, 'mst123'));
    assert.equal(normalizedPartnersAfterUpdate.length, 1);
  });
});
