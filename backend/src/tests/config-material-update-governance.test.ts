import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';

/**
 * Product decision 2026-09-05: the maker → checker → approver queue is
 * removed for governed config. Every permitted maker's mutation applies
 * directly. Value-diff semantics still decide whether the write is recorded
 * as an APPROVED PRICE_CONFIG audit action (material field changed) or skips
 * governance entirely (unchanged material values in a full edit-form
 * payload). These tests pin that contract: rows always change immediately,
 * and the audit action exists exactly when a material value changed.
 *
 * Maker is MANAGER (non-ADMIN) to prove no role is queued anymore.
 */
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];
const driverIds: number[] = [];
const penaltyReasonIds: number[] = [];
const forwarderExpenseTypeIds: number[] = [];
const expenseCategoryIds: number[] = [];
let actorIds: number[] = [];
let server: http.Server;
let baseUrl = '';
let makerId = 0;

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
  expectedUpdatedAt?: string,
) {
  if (idempotencyKey) idempotencyKeys.push(idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(expectedUpdatedAt ? { 'If-Unmodified-Since': expectedUpdatedAt } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function isGovernancePending(body: Record<string, unknown>): boolean {
  return body != null && typeof body === 'object' && 'actionKind' in body && body.status === 'PENDING_CHECK';
}

/** APPROVED PRICE_CONFIG audit actions authored by this run's maker. */
async function approvedPriceConfigActionCount(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)` })
    .from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.makerId, makerId),
      eq(s.governanceActions.status, 'APPROVED'),
      eq(s.governanceActions.actionKind, 'PRICE_CONFIG_CHANGE'),
    ));
  return Number(row?.count ?? 0);
}

before(async () => {
  const staleUsers = await db.select({ id: s.users.id }).from(s.users)
    .where(like(s.users.username, 'material-gov-%'));
  if (staleUsers.length > 0) {
    const staleIds = staleUsers.map((user) => user.id);
    await db.delete(s.notifications).where(inArray(s.notifications.userId, staleIds));
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.makerId, staleIds));
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, staleIds));
    await db.delete(s.users).where(inArray(s.users.id, staleIds));
  }
  const [maker] = await db.insert(s.users).values([
    { username: `material-gov-maker-${suffix}`, passwordHash: 'x', role: Role.MANAGER, status: 'ACTIVE' },
  ]).returning({ id: s.users.id }) as Array<{ id: number }>;
  makerId = maker!.id;
  actorIds = [maker!.id];

  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => {
    _req.user = {
      userId: maker!.id,
      username: `material-gov-maker-${suffix}`,
      email: null,
      fullName: null,
      role: Role.MANAGER,
    };
    next();
  });
  app.use('/api', configRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  if (driverIds.length > 0) {
    await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
  }
  if (penaltyReasonIds.length > 0) {
    await db.delete(s.penaltyReasons).where(inArray(s.penaltyReasons.id, penaltyReasonIds));
  }
  if (forwarderExpenseTypeIds.length > 0) {
    await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, forwarderExpenseTypeIds));
  }
  if (expenseCategoryIds.length > 0) {
    await db.delete(s.expenseCategories).where(inArray(s.expenseCategories.id, expenseCategoryIds));
  }
  if (actorIds.length > 0) {
    await db.delete(s.notifications).where(inArray(s.notifications.userId, actorIds));
    await db.delete(s.governanceActions).where(or(
      inArray(s.governanceActions.makerId, actorIds),
      inArray(s.governanceActions.checkerId, actorIds),
      inArray(s.governanceActions.approverId, actorIds),
    ));
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, actorIds));
    await db.delete(s.users).where(inArray(s.users.id, actorIds));
  }
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
  }
  await disconnectRedis();
  await client.end();
});

describe('direct-apply governance for material config updates', () => {
  it('applies a driver salary change directly with an audit action, and a same-salary edit without one', async () => {
    const auditBefore = await approvedPriceConfigActionCount();

    const created = await api('POST', '/api/drivers', {
      name: `Material driver ${suffix}`,
      phone: '0900001122',
    }, `material-driver-create-${suffix}`);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    driverIds.push(Number(created.body.id));

    const [driver] = await db.select().from(s.drivers)
      .where(eq(s.drivers.id, Number(created.body.id)));
    assert.ok(driver);

    // Full edit-form payload introducing a salary → material → applies
    // directly and records an APPROVED audit action.
    const applied = await api(
      'PUT',
      `/api/drivers/${driver.id}`,
      {
        name: driver.name,
        phone: driver.phone ?? undefined,
        assignedTruckId: driver.assignedTruckId,
        baseSalary: 7000000,
        socialInsurance: 0,
        status: driver.status,
      },
      `material-driver-salary-${suffix}`,
      driver.updatedAt.toISOString(),
    );
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.ok(!isGovernancePending(applied.body), `expected direct row, got: ${JSON.stringify(applied.body)}`);

    const [withSalary] = await db.select().from(s.drivers)
      .where(eq(s.drivers.id, driver.id));
    assert.equal(withSalary.baseSalary, '7000000');
    assert.equal(await approvedPriceConfigActionCount(), auditBefore + 1,
      'material salary change must record an APPROVED audit action');

    // Same full payload, salary byte-identical, only the name changes →
    // direct update, no additional audit action.
    const direct = await api(
      'PUT',
      `/api/drivers/${driver.id}`,
      {
        name: `Material driver renamed ${suffix}`,
        phone: withSalary.phone ?? undefined,
        assignedTruckId: withSalary.assignedTruckId,
        baseSalary: 7000000,
        socialInsurance: 0,
        status: withSalary.status,
      },
      `material-driver-rename-${suffix}`,
      withSalary.updatedAt.toISOString(),
    );
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    assert.ok(!isGovernancePending(direct.body), `expected direct row, got: ${JSON.stringify(direct.body)}`);
    assert.equal(direct.body.name, `Material driver renamed ${suffix}`);
    assert.equal(await approvedPriceConfigActionCount(), auditBefore + 1,
      'unchanged material values must not record another audit action');
  });

  it('applies a penalty create and amount change directly with audit actions', async () => {
    const auditBefore = await approvedPriceConfigActionCount();

    // Penalty creates always carry defaultAmount → governed → direct apply.
    const created = await api('POST', '/api/penalty-reasons', {
      reasonText: `Material penalty ${suffix}`,
      defaultAmount: 500000,
      severity: 'mid',
    }, `material-penalty-create-${suffix}`);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.ok(!isGovernancePending(created.body), `expected direct row, got: ${JSON.stringify(created.body)}`);

    const [reason] = await db.select().from(s.penaltyReasons)
      .where(eq(s.penaltyReasons.reasonText, `Material penalty ${suffix}`));
    assert.ok(reason);
    penaltyReasonIds.push(reason.id);
    assert.equal(await approvedPriceConfigActionCount(), auditBefore + 1,
      'governed create must record an APPROVED audit action');

    // Full payload, same defaultAmount, different severity → direct, no action.
    const direct = await api(
      'PUT',
      `/api/penalty-reasons/${reason.id}`,
      {
        reasonText: reason.reasonText,
        defaultAmount: 500000,
        severity: 'high',
      },
      `material-penalty-severity-${suffix}`,
      reason.updatedAt.toISOString(),
    );
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    assert.ok(!isGovernancePending(direct.body), `expected direct row, got: ${JSON.stringify(direct.body)}`);
    assert.equal(direct.body.severity, 'high');
    assert.equal(await approvedPriceConfigActionCount(), auditBefore + 1,
      'unchanged defaultAmount must not record another audit action');

    // Changed defaultAmount → material → direct apply WITH audit action.
    const [afterDirect] = await db.select().from(s.penaltyReasons)
      .where(eq(s.penaltyReasons.id, reason.id));
    const applied = await api(
      'PUT',
      `/api/penalty-reasons/${reason.id}`,
      {
        reasonText: reason.reasonText,
        defaultAmount: 800000,
        severity: 'high',
      },
      `material-penalty-amount-${suffix}`,
      afterDirect.updatedAt.toISOString(),
    );
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.ok(!isGovernancePending(applied.body), `expected direct row, got: ${JSON.stringify(applied.body)}`);
    assert.equal(String(applied.body.defaultAmount), '800000');
    assert.equal(await approvedPriceConfigActionCount(), auditBefore + 2,
      'material defaultAmount change must record an APPROVED audit action');
  });

  it('applies forwarder policy creates and changes directly with audit actions', async () => {
    const auditBefore = await approvedPriceConfigActionCount();

    const created = await api('POST', '/api/forwarder-expense-types', {
      code: `MAT${suffix.slice(-6).toUpperCase()}`,
      name: `Material expense ${suffix}`,
      requiresInvoice: false,
      substituteEvidenceAllowed: true,
      noInvoiceEvidenceTypes: [],
      noInvoicePerItemLimit: 1000000,
      noInvoicePerDayLimit: 5000000,
      noInvoiceFinanceLeadItemApprovalLimit: 5000000,
      noInvoiceDirectorDayApprovalLimit: 10000000,
      defaultMarkup: false,
      billingLabel: null,
      vatRate: '0.080',
    }, `material-fwd-create-${suffix}`);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.ok(!isGovernancePending(created.body), `expected direct row, got: ${JSON.stringify(created.body)}`);

    const [expenseType] = await db.select().from(s.forwarderExpenseTypes)
      .where(eq(s.forwarderExpenseTypes.code, `MAT${suffix.slice(-6).toUpperCase()}`));
    assert.ok(expenseType);
    forwarderExpenseTypeIds.push(expenseType.id);
    assert.equal(await approvedPriceConfigActionCount(), auditBefore + 1,
      'governed create must record an APPROVED audit action');

    // Full edit-form payload with byte-identical policy → direct rename, no action.
    const direct = await api(
      'PUT',
      `/api/forwarder-expense-types/${expenseType.id}`,
      {
        code: expenseType.code,
        name: `Material expense renamed ${suffix}`,
        requiresInvoice: expenseType.requiresInvoice ?? false,
        substituteEvidenceAllowed: expenseType.substituteEvidenceAllowed ?? true,
        noInvoiceEvidenceTypes: (expenseType.noInvoiceEvidenceTypes ?? []) as unknown[],
        noInvoicePerItemLimit: Number(expenseType.noInvoicePerItemLimit),
        noInvoicePerDayLimit: Number(expenseType.noInvoicePerDayLimit),
        noInvoiceFinanceLeadItemApprovalLimit: Number(expenseType.noInvoiceFinanceLeadItemApprovalLimit),
        noInvoiceDirectorDayApprovalLimit: Number(expenseType.noInvoiceDirectorDayApprovalLimit),
        defaultMarkup: expenseType.defaultMarkup,
        billingLabel: expenseType.billingLabel,
        vatRate: expenseType.vatRate,
      },
      `material-fwd-rename-${suffix}`,
      expenseType.updatedAt.toISOString(),
    );
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    assert.ok(!isGovernancePending(direct.body), `expected direct row, got: ${JSON.stringify(direct.body)}`);
    assert.equal(direct.body.name, `Material expense renamed ${suffix}`);
    assert.equal(await approvedPriceConfigActionCount(), auditBefore + 1,
      'unchanged policy must not record another audit action');

    // Tightened per-item limit → material → direct apply WITH audit action.
    const [afterDirect] = await db.select().from(s.forwarderExpenseTypes)
      .where(eq(s.forwarderExpenseTypes.id, expenseType.id));
    const applied = await api(
      'PUT',
      `/api/forwarder-expense-types/${expenseType.id}`,
      {
        noInvoicePerItemLimit: 2000000,
      },
      `material-fwd-limit-${suffix}`,
      afterDirect.updatedAt.toISOString(),
    );
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.ok(!isGovernancePending(applied.body), `expected direct row, got: ${JSON.stringify(applied.body)}`);
    assert.equal(await approvedPriceConfigActionCount(), auditBefore + 2,
      'material policy change must record an APPROVED audit action');
  });

  it('applies expense-category creates and policy changes directly with audit actions', async () => {
    const auditBefore = await approvedPriceConfigActionCount();

    // Creates always carry policy fields → governed → direct apply.
    const created = await api('POST', '/api/expense-categories', {
      name: `Material expense category ${suffix}`,
      isRenewable: true,
      reminderLeadDays: 15,
      status: 'ACTIVE',
    }, `material-expense-cat-create-${suffix}`);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.ok(!isGovernancePending(created.body), `expected direct row, got: ${JSON.stringify(created.body)}`);

    const [category] = await db.select().from(s.expenseCategories)
      .where(eq(s.expenseCategories.name, `Material expense category ${suffix}`));
    assert.ok(category);
    expenseCategoryIds.push(category.id);
    assert.equal(await approvedPriceConfigActionCount(), auditBefore + 1,
      'governed create must record an APPROVED audit action');

    // Full edit-form payload, policy byte-identical, only the name changes →
    // direct, no additional action.
    const direct = await api(
      'PUT',
      `/api/expense-categories/${category.id}`,
      {
        name: `Material expense category renamed ${suffix}`,
        isRenewable: category.isRenewable ?? false,
        reminderLeadDays: category.reminderLeadDays,
        status: category.status,
      },
      `material-expense-cat-rename-${suffix}`,
      category.updatedAt.toISOString(),
    );
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    assert.ok(!isGovernancePending(direct.body), `expected direct row, got: ${JSON.stringify(direct.body)}`);
    assert.equal(direct.body.name, `Material expense category renamed ${suffix}`);
    assert.equal(await approvedPriceConfigActionCount(), auditBefore + 1,
      'unchanged policy must not record another audit action');

    // Changed reminderLeadDays → material → direct apply WITH audit action.
    const [afterDirect] = await db.select().from(s.expenseCategories)
      .where(eq(s.expenseCategories.id, category.id));
    const applied = await api(
      'PUT',
      `/api/expense-categories/${category.id}`,
      {
        name: `Material expense category renamed ${suffix}`,
        isRenewable: category.isRenewable ?? false,
        reminderLeadDays: 45,
        status: category.status,
      },
      `material-expense-cat-lead-days-${suffix}`,
      afterDirect.updatedAt.toISOString(),
    );
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.ok(!isGovernancePending(applied.body), `expected direct row, got: ${JSON.stringify(applied.body)}`);
    assert.equal(await approvedPriceConfigActionCount(), auditBefore + 2,
      'material policy change must record an APPROVED audit action');
  });
});
