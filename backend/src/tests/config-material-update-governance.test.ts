import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { eq, inArray, like, or } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';
import governanceActionsRoutes from '../routes/financial/governance-actions.routes';
import paymentsRoutes from '../routes/financial/payments.routes';

/**
 * Edit forms resend the full record on every save. Governed updates must
 * therefore compare incoming values against the current row (value-diff), not
 * key presence — otherwise every edit of drivers, penalty-reasons, or
 * forwarder-expense-types queues a PRICE_CONFIG_CHANGE even when the material
 * fields are byte-identical.
 *
 * Maker is MANAGER (non-ADMIN) so the queue path is exercised regardless of
 * any ADMIN immediate-apply behavior.
 */
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];
const driverIds: number[] = [];
const penaltyReasonIds: number[] = [];
const forwarderExpenseTypeIds: number[] = [];
const governanceActionIds: number[] = [];
let actorIds: number[] = [];
let server: http.Server;
let baseUrl = '';

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
  expectedUpdatedAt?: string,
  actorIndex = 0,
) {
  if (idempotencyKey) idempotencyKeys.push(idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(expectedUpdatedAt ? { 'If-Unmodified-Since': expectedUpdatedAt } : {}),
      'X-Test-Actor': String(actorIndex),
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

async function approvePendingAction(action: Record<string, unknown>) {
  const actionId = Number(action.id);
  governanceActionIds.push(actionId);
  assert.equal(action.status, 'PENDING_CHECK', JSON.stringify(action));
  const checked = await api(
    'POST',
    `/api/governance-actions/${actionId}/check`,
    { expectedVersion: Number(action.version) },
    `material-check-${suffix}-${actionId}`,
    undefined,
    1,
  );
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  const approved = await api(
    'POST',
    `/api/governance-actions/${actionId}/approve`,
    { expectedVersion: Number(checked.body.version) },
    `material-approve-${suffix}-${actionId}`,
    undefined,
    2,
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
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
  const actors = await db.insert(s.users).values([
    { username: `material-gov-maker-${suffix}`, passwordHash: 'x', role: Role.MANAGER, status: 'ACTIVE' },
    { username: `material-gov-checker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT, status: 'ACTIVE' },
    { username: `material-gov-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN, status: 'ACTIVE' },
  ]).returning({ id: s.users.id, role: s.users.role }) as Array<{ id: number; role: Role }>;
  actorIds = actors.map((actor) => actor.id);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const actor = actors[Number(req.header('X-Test-Actor') ?? 0)] ?? actors[0]!;
    req.user = {
      userId: actor.id,
      username: `material-gov-${actor.role}`,
      email: null,
      fullName: null,
      role: actor.role,
    };
    next();
  });
  app.use('/api', configRoutes);
  app.use('/api', governanceActionsRoutes);
  app.use('/api', paymentsRoutes);
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
  if (governanceActionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, governanceActionIds));
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
  const staleUsers = await db.select({ id: s.users.id }).from(s.users)
    .where(like(s.users.username, 'material-gov-%'));
  if (staleUsers.length > 0) {
    const staleIds = staleUsers.map((user) => user.id);
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.makerId, staleIds));
    await db.delete(s.users).where(inArray(s.users.id, staleIds));
  }
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
  }
  await disconnectRedis();
  await client.end();
});

describe('value-diff governance for material config updates', () => {
  it('queues a driver salary change but lets an unchanged-salary full-payload edit through directly', async () => {
    // Create without salary fields → not governed → direct row.
    const created = await api('POST', '/api/drivers', {
      name: `Material driver ${suffix}`,
      phone: '0900001122',
    }, `material-driver-create-${suffix}`);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    driverIds.push(Number(created.body.id));

    const [driver] = await db.select().from(s.drivers)
      .where(eq(s.drivers.id, Number(created.body.id)));
    assert.ok(driver);

    // Full edit-form payload introducing a salary → material → PENDING_CHECK.
    const pending = await api(
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
    assert.equal(pending.status, 201, JSON.stringify(pending.body));
    assert.ok(isGovernancePending(pending.body), `expected governed queue, got: ${JSON.stringify(pending.body)}`);
    await approvePendingAction(pending.body);

    const [withSalary] = await db.select().from(s.drivers)
      .where(eq(s.drivers.id, driver.id));
    assert.equal(withSalary.baseSalary, '7000000');

    // Same full payload, salary byte-identical, only the name changes → direct.
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
  });

  it('queues a penalty default-amount change but lets an unchanged-amount severity edit through directly', async () => {
    // Penalty creates always carry defaultAmount → governed.
    const created = await api('POST', '/api/penalty-reasons', {
      reasonText: `Material penalty ${suffix}`,
      defaultAmount: 500000,
      severity: 'mid',
    }, `material-penalty-create-${suffix}`);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.ok(isGovernancePending(created.body), `expected governed create, got: ${JSON.stringify(created.body)}`);
    await approvePendingAction(created.body);

    const [reason] = await db.select().from(s.penaltyReasons)
      .where(eq(s.penaltyReasons.reasonText, `Material penalty ${suffix}`));
    assert.ok(reason);
    penaltyReasonIds.push(reason.id);

    // Full payload, same defaultAmount, different severity → direct.
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

    // Changed defaultAmount → governed.
    const [afterDirect] = await db.select().from(s.penaltyReasons)
      .where(eq(s.penaltyReasons.id, reason.id));
    const pending = await api(
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
    assert.equal(pending.status, 201, JSON.stringify(pending.body));
    assert.ok(isGovernancePending(pending.body), `expected governed queue, got: ${JSON.stringify(pending.body)}`);
    governanceActionIds.push(Number(pending.body.id));
  });

  it('queues a forwarder policy change but lets an unchanged-policy full-payload edit through directly', async () => {
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
    assert.ok(isGovernancePending(created.body), `expected governed create, got: ${JSON.stringify(created.body)}`);
    await approvePendingAction(created.body);

    const [expenseType] = await db.select().from(s.forwarderExpenseTypes)
      .where(eq(s.forwarderExpenseTypes.code, `MAT${suffix.slice(-6).toUpperCase()}`));
    assert.ok(expenseType);
    forwarderExpenseTypeIds.push(expenseType.id);

    // Full edit-form payload with byte-identical policy → direct rename.
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

    // Tightened per-item limit → governed.
    const [afterDirect] = await db.select().from(s.forwarderExpenseTypes)
      .where(eq(s.forwarderExpenseTypes.id, expenseType.id));
    const pending = await api(
      'PUT',
      `/api/forwarder-expense-types/${expenseType.id}`,
      {
        noInvoicePerItemLimit: 2000000,
      },
      `material-fwd-limit-${suffix}`,
      afterDirect.updatedAt.toISOString(),
    );
    assert.equal(pending.status, 201, JSON.stringify(pending.body));
    assert.ok(isGovernancePending(pending.body), `expected governed queue, got: ${JSON.stringify(pending.body)}`);
    governanceActionIds.push(Number(pending.body.id));
  });
});
