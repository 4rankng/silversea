import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, eq, inArray, or } from 'drizzle-orm';
import { Role, TxnType, type SaveBillingDocumentInput } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import advancesRoutes from '../routes/financial/advances.routes';
import billingDocumentsRoutes from '../routes/financial/billing-documents.routes';
import debtOffsetsRoutes from '../routes/financial/debt-offsets.routes';
import governanceActionsRoutes from '../routes/financial/governance-actions.routes';
import paymentsRoutes from '../routes/financial/payments.routes';
import { initAuditService } from '../services/audit.service';
import { initNotificationService } from '../services/notification.service';
import { disconnectRedis } from '../lib/redis';
import { upsertPartnerFromTaxCode } from '../services/legal-partner.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: number[] = [];
const customerIds: number[] = [];
const supplierIds: number[] = [];
const advanceRequestIds: number[] = [];
const advanceSettlementIds: number[] = [];
const billingDocumentIds: number[] = [];
const billingLineDocIds: number[] = [];
const debtOffsetIds: number[] = [];
const auditLogIds: number[] = [];
const idempotencyKeys: string[] = [];
const ledgerIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let actor: typeof s.users.$inferSelect;
let managerActor: typeof s.users.$inferSelect;
let accountantActor: typeof s.users.$inferSelect;

async function createUser(role: Role, usernamePrefix: string) {
  const [user] = await db.insert(s.users).values({
    username: `${usernamePrefix}-${suffix}-${userIds.length}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  userIds.push(user.id);
  return user;
}

async function createCustomer() {
  const [customer] = await db.insert(s.customers).values({
    name: `Q23 billing customer ${suffix}-${customerIds.length}`,
  }).returning();
  customerIds.push(customer.id);
  return customer;
}

async function createLinkedCounterparties() {
  const taxCode = `Q23${String(Date.now()).slice(-8)}${customerIds.length}`;
  const partnerId = await upsertPartnerFromTaxCode(taxCode);
  const [customer] = await db.insert(s.customers).values({
    name: `Q23 offset customer ${suffix}-${customerIds.length}`,
    taxCode,
    partnerId,
  }).returning();
  customerIds.push(customer.id);
  const [supplier] = await db.insert(s.suppliers).values({
    name: `Q23 offset supplier ${suffix}-${supplierIds.length}`,
    taxCode,
    partnerId,
    linkedCustomerId: customer.id,
  }).returning();
  supplierIds.push(supplier.id);
  await db.update(s.customers)
    .set({ linkedSupplierId: supplier.id })
    .where(eq(s.customers.id, customer.id));
  return { customer, supplier };
}

async function postLedgerSeed(entityType: 'CUSTOMER' | 'VENDOR', entityId: number, txnType: TxnType, debit: number, credit: number, note: string) {
  const [row] = await db.insert(s.ledger).values({
    entityType,
    entityId,
    txnType,
    txnId: 0,
    debit: String(debit),
    credit: String(credit),
    balance: String(Math.max(debit, credit)),
    note,
  }).returning({ id: s.ledger.id });
  ledgerIds.push(row.id);
}

async function createApprovedAdvanceRequest(requesterId: number, amount: number) {
  const [request] = await db.insert(s.advanceRequests).values({
    requesterId,
    amount: String(amount),
    reason: `Q23 approved request ${suffix}-${advanceRequestIds.length}`,
    status: 'APPROVED',
  }).returning();
  advanceRequestIds.push(request.id);
  return request;
}

async function createPendingAdvanceRequest(requesterId: number, amount: number) {
  const [request] = await db.insert(s.advanceRequests).values({
    requesterId,
    amount: String(amount),
    reason: `Q23 pending request ${suffix}-${advanceRequestIds.length}`,
    status: 'PENDING',
  }).returning();
  advanceRequestIds.push(request.id);
  return request;
}

async function createSettlement(forwarderId: number, requestIds: number[], note: string, status: 'PENDING' | 'CHECKED_BY_ACCOUNTANT' = 'PENDING') {
  const [settlement] = await db.insert(s.advanceSettlements).values({
    code: `Q23-STL-${suffix}-${advanceSettlementIds.length}`.slice(0, 20),
    forwarderId,
    totalExpenseAmount: '0',
    refundAmount: '500000',
    status,
    checkedBy: status === 'CHECKED_BY_ACCOUNTANT' ? actor.id : null,
    checkedAt: status === 'CHECKED_BY_ACCOUNTANT' ? new Date('2026-07-27T09:00:00.000Z') : null,
    note,
  }).returning();
  advanceSettlementIds.push(settlement.id);
  await db.insert(s.advanceSettlementRequests).values(
    requestIds.map((advanceRequestId) => ({
      settlementId: settlement.id,
      advanceRequestId,
    })),
  );
  return settlement;
}

function adHocDocumentInput(customer: { id: number; name: string }, note: string, amount: number, description: string): SaveBillingDocumentInput {
  return {
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    entityName: customer.name,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
    note,
    lines: [{
      sourceType: 'ADHOC',
      sourceId: null,
      lineType: 'ADHOC',
      typeLabel: 'Phí dịch vụ',
      unit: 'lần',
      description,
      baseAmount: amount,
      amountOverride: null,
      excluded: false,
      sortOrder: 0,
    }],
  };
}

async function requestJson(
  path: string,
  options: {
    method?: 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    idempotencyKey?: string;
    userId?: number;
  } = {},
) {
  const method = options.method ?? 'POST';
  const url = new URL(`/api${path}`, baseUrl);
  const payload = options.body === undefined ? '' : JSON.stringify(options.body);
  const headers: Record<string, string> = {
    Connection: 'close',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload).toString();
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
    if (!idempotencyKeys.includes(options.idempotencyKey)) {
      idempotencyKeys.push(options.idempotencyKey);
    }
  }
  if (options.userId) {
    headers['x-user-id'] = String(options.userId);
  }

  return new Promise<{ status: number; data: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: Number(url.port),
      path: `${url.pathname}${url.search}`,
      method,
      agent: false,
      headers,
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          resolve({
            status: response.statusCode ?? 0,
            data: raw ? JSON.parse(raw) as Record<string, unknown> : {},
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

async function waitForAuditRows(
  predicate: (payload: Record<string, unknown>) => boolean,
  expectedAtLeast = 1,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rows = await db.select().from(s.auditLogs)
      .where(eq(s.auditLogs.userId, actor.id))
      .orderBy(s.auditLogs.id);
    const matches = rows.filter((row) => predicate(row.payload as Record<string, unknown>));
    if (matches.length >= expectedAtLeast) {
      for (const row of matches) {
        if (!auditLogIds.includes(row.id)) auditLogIds.push(row.id);
      }
      return matches.map((row) => row.payload as Record<string, unknown>);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return [] as Record<string, unknown>[];
}

before(async () => {
  initNotificationService();
  initAuditService();

  actor = await createUser(Role.ADMIN, 'q23-finance-actor');
  managerActor = await createUser(Role.MANAGER, 'q23-finance-manager');
  accountantActor = await createUser(Role.ACCOUNTANT, 'q23-finance-accountant');

  const app = express();
  app.use(express.json());
  app.use(auditLogMiddleware);
  app.use('/api', (req, _res, next) => {
    const requestedUserId = Number(req.header('x-user-id'));
    const currentUser = [actor, managerActor, accountantActor]
      .find((row) => row.id === requestedUserId) ?? actor;
    req.user = {
      userId: currentUser.id,
      username: currentUser.username,
      email: currentUser.email,
      fullName: currentUser.fullName,
      role: currentUser.role as Role,
    };
    next();
  });
  app.use('/api', advancesRoutes);
  app.use('/api', billingDocumentsRoutes);
  app.use('/api', debtOffsetsRoutes);
  app.use('/api', paymentsRoutes);
  app.use('/api', governanceActionsRoutes);
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
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
  }
  if (auditLogIds.length > 0) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.id, auditLogIds));
  }
  if (userIds.length > 0) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, userIds));
  }
  if (advanceSettlementIds.length > 0) {
    await db.delete(s.notifications).where(and(
      eq(s.notifications.relatedEntityType, 'advance_settlements'),
      inArray(s.notifications.relatedEntityId, advanceSettlementIds),
    ));
    await db.delete(s.settlementExpenseAdjustments).where(inArray(s.settlementExpenseAdjustments.settlementId, advanceSettlementIds));
    await db.delete(s.settlementExpenses).where(inArray(s.settlementExpenses.settlementId, advanceSettlementIds));
    await db.delete(s.advanceSettlementRequests).where(inArray(s.advanceSettlementRequests.settlementId, advanceSettlementIds));
    await db.delete(s.advanceSettlements).where(inArray(s.advanceSettlements.id, advanceSettlementIds));
  }
  if (advanceRequestIds.length > 0) {
    await db.delete(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.FORWARDER_ADVANCE),
      inArray(s.ledger.txnId, advanceRequestIds),
    ));
    await db.delete(s.advanceRequests).where(inArray(s.advanceRequests.id, advanceRequestIds));
  }
  if (billingLineDocIds.length > 0) {
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, billingLineDocIds));
  }
  if (billingDocumentIds.length > 0) {
    await db.delete(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.ADJUSTMENT),
      inArray(s.ledger.txnId, billingDocumentIds),
    ));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, billingDocumentIds));
  }
  if (supplierIds.length > 0) {
    await db.update(s.customers)
      .set({ linkedSupplierId: null })
      .where(inArray(s.customers.id, customerIds));
    await db.update(s.suppliers)
      .set({ linkedCustomerId: null })
      .where(inArray(s.suppliers.id, supplierIds));
  }
  if (debtOffsetIds.length > 0) {
    await db.delete(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.ADJUSTMENT),
      inArray(s.ledger.txnId, debtOffsetIds),
    ));
    await db.delete(s.debtOffsets).where(inArray(s.debtOffsets.id, debtOffsetIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  if (supplierIds.length > 0) {
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, supplierIds));
  }
  if (userIds.length > 0) {
    await db.delete(s.governanceActions)
      .where(inArray(s.governanceActions.makerId, userIds));
  }
  if (userIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, userIds));
  }
  await disconnectRedis();
  await client.end();
});

describe('Q23 approved financial route idempotency', () => {
  test('advance settlement update replays the original snapshot and rejects same-key changed payloads', async () => {
    const requester = await createUser(Role.FORWARDER, 'q23-forwarder');
    const request = await createApprovedAdvanceRequest(requester.id, 500000);
    const settlement = await createSettlement(requester.id, [request.id], 'seed pending');

    const key = `q23-advance-update-${settlement.id}`;
    const firstBody = {
      expectedVersion: settlement.version,
      advanceRequestIds: [request.id],
      tripExpenseIds: [],
      refundAmount: 500000,
      note: 'ghi chu lan 1',
    };
    const changedBody = {
      ...firstBody,
      note: 'ghi chu thay doi',
    };

    const first = await requestJson(`/advance-settlements/${settlement.id}`, {
      method: 'PUT',
      body: firstBody,
      idempotencyKey: key,
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.replayed, false);
    assert.equal(first.data.note, 'ghi chu lan 1');

    const conflict = await requestJson(`/advance-settlements/${settlement.id}`, {
      method: 'PUT',
      body: changedBody,
      idempotencyKey: key,
    });
    assert.equal(conflict.status, 409);
    assert.match(String(conflict.data.error ?? ''), /Khóa giao dịch trùng/);

    const secondKey = `${key}-next`;
    const second = await requestJson(`/advance-settlements/${settlement.id}`, {
      method: 'PUT',
      body: { ...changedBody, expectedVersion: settlement.version + 1 },
      idempotencyKey: secondKey,
    });
    assert.equal(second.status, 200);
    assert.equal(second.data.note, 'ghi chu thay doi');

    const replay = await requestJson(`/advance-settlements/${settlement.id}`, {
      method: 'PUT',
      body: firstBody,
      idempotencyKey: key,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.deepEqual(
      { ...replay.data, replayed: false },
      first.data,
    );

    const auditRows = await waitForAuditRows(
      (payload) =>
        payload.path === `/api/advance-settlements/${settlement.id}`
        && (payload.outcome === 'REPLAYED' || payload.statusCode === 409),
      2,
    );
    assert.ok(auditRows.some((row) => row.outcome === 'REPLAYED'));
    assert.ok(auditRows.some((row) => row.statusCode === 409 && row.idempotencyKeyPresent === true));
  });

  test('advance request approval is first-winner under concurrent distinct keys', async () => {
    const requester = await createUser(Role.FORWARDER, 'q23-approve-forwarder');
    const request = await createPendingAdvanceRequest(requester.id, 275000);
    const requested = await requestJson(`/advance-requests/${request.id}/approve`, {
      body: { expectedVersion: request.version, reason: 'Trình duyệt tạm ứng' },
      idempotencyKey: `q23-advance-request-${request.id}`,
      userId: managerActor.id,
    });
    assert.equal(requested.status, 201, JSON.stringify(requested.data));
    assert.equal(requested.data.actionKind, 'ADVANCE_REQUEST_APPROVAL');

    const requestReplay = await requestJson(`/advance-requests/${request.id}/approve`, {
      body: { expectedVersion: request.version, reason: 'Trình duyệt tạm ứng' },
      idempotencyKey: `q23-advance-request-${request.id}`,
      userId: managerActor.id,
    });
    assert.equal(requestReplay.status, 200);
    assert.equal(requestReplay.data.replayed, true);

    const requestConflict = await requestJson(`/advance-requests/${request.id}/approve`, {
      body: { expectedVersion: request.version, reason: 'Đổi lý do' },
      idempotencyKey: `q23-advance-request-${request.id}`,
      userId: managerActor.id,
    });
    assert.equal(requestConflict.status, 409);

    const checked = await requestJson(`/governance-actions/${requested.data.id}/check`, {
      body: { expectedVersion: requested.data.version },
      idempotencyKey: `q23-advance-check-${request.id}`,
      userId: accountantActor.id,
    });
    assert.equal(checked.status, 200, JSON.stringify(checked.data));

    const [first, second] = await Promise.all([
      requestJson(`/governance-actions/${requested.data.id}/approve`, {
        body: { expectedVersion: checked.data.version },
        idempotencyKey: `q23-advance-approve-a-${request.id}`,
        userId: actor.id,
      }),
      requestJson(`/governance-actions/${requested.data.id}/approve`, {
        body: { expectedVersion: checked.data.version },
        idempotencyKey: `q23-advance-approve-b-${request.id}`,
        userId: actor.id,
      }),
    ]);

    assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [200, 409]);
    const [updated] = await db.select({ status: s.advanceRequests.status })
      .from(s.advanceRequests)
      .where(eq(s.advanceRequests.id, request.id))
      .limit(1);
    assert.equal(updated?.status, 'APPROVED');

    const ledgerRows = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.txnType, TxnType.FORWARDER_ADVANCE),
        eq(s.ledger.txnId, request.id),
      ));
    ledgerIds.push(...ledgerRows.map((row) => row.id));
    assert.equal(ledgerRows.length, 1);
  });

  test('advance request rejection is governed by three actors and has no ledger effect', async () => {
    const requester = await createUser(Role.FORWARDER, 'q15-reject-forwarder');
    const request = await createPendingAdvanceRequest(requester.id, 315000);
    const requested = await requestJson(`/advance-requests/${request.id}/reject`, {
      body: { expectedVersion: request.version, reason: 'Chứng từ tạm ứng không hợp lệ' },
      idempotencyKey: `q15-advance-reject-${request.id}`,
      userId: managerActor.id,
    });
    assert.equal(requested.status, 201, JSON.stringify(requested.data));
    assert.equal(requested.data.actionKind, 'ADVANCE_REQUEST_REJECTION');

    const [beforeCheck] = await db.select().from(s.advanceRequests)
      .where(eq(s.advanceRequests.id, request.id))
      .limit(1);
    assert.equal(beforeCheck.status, 'PENDING');
    assert.equal(beforeCheck.approvedBy, null);
    const ledgerBefore = await db.select().from(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.FORWARDER_ADVANCE),
      eq(s.ledger.txnId, request.id),
    ));
    assert.equal(ledgerBefore.length, 0);

    const checked = await requestJson(`/governance-actions/${requested.data.id}/check`, {
      body: { expectedVersion: requested.data.version },
      idempotencyKey: `q15-advance-reject-check-${request.id}`,
      userId: accountantActor.id,
    });
    assert.equal(checked.status, 200, JSON.stringify(checked.data));
    const [afterCheck] = await db.select().from(s.advanceRequests)
      .where(eq(s.advanceRequests.id, request.id))
      .limit(1);
    assert.equal(afterCheck.status, 'PENDING');

    const actionId = Number(requested.data.id);
    assert.equal(Number.isInteger(actionId), true);
    const approvedDecision = await requestJson(`/governance-actions/${actionId}/approve`, {
      body: { expectedVersion: checked.data.version },
      idempotencyKey: `q15-advance-reject-approve-${request.id}`,
      userId: actor.id,
    });
    assert.equal(approvedDecision.status, 200, JSON.stringify(approvedDecision.data));
    const [rejected, action] = await Promise.all([
      db.select().from(s.advanceRequests)
        .where(eq(s.advanceRequests.id, request.id))
        .limit(1)
        .then((rows) => rows[0]),
      db.select().from(s.governanceActions)
        .where(eq(s.governanceActions.id, actionId))
        .limit(1)
        .then((rows) => rows[0]),
    ]);
    assert.ok(rejected);
    assert.ok(action);
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(new Set([action.makerId, action.checkerId, action.approverId]).size, 3);
    const ledgerAfter = await db.select().from(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.FORWARDER_ADVANCE),
      eq(s.ledger.txnId, request.id),
    ));
    assert.equal(ledgerAfter.length, 0);
  });

  test('debt offset approval and cancel use governed replay and single-winner application', async () => {
    const { customer, supplier } = await createLinkedCounterparties();
    await postLedgerSeed('CUSTOMER', customer.id, TxnType.TRIP_REVENUE, 800000, 0, 'Q23 debt offset AR');
    await postLedgerSeed('VENDOR', supplier.id, TxnType.VENDOR_EXPENSE, 0, 800000, 'Q23 debt offset AP');

    const created = await requestJson('/finance/debt-offsets', {
      body: {
        customerId: customer.id,
        supplierId: supplier.id,
        offsetDate: '2026-07-28',
        currency: 'VND',
        note: 'Q23 debt offset',
        minutesReference: `BB-Q23-${suffix}`,
      },
      idempotencyKey: `q23-offset-create-${customer.id}`,
      userId: accountantActor.id,
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const offsetId = Number(created.data.id);
    debtOffsetIds.push(offsetId);

    const requested = await requestJson(`/finance/debt-offsets/${offsetId}/approve`, {
      body: { expectedVersion: 1, reason: 'Trình duyệt đối trừ' },
      idempotencyKey: `q23-offset-approve-request-${offsetId}`,
      userId: managerActor.id,
    });
    assert.equal(requested.status, 201, JSON.stringify(requested.data));
    assert.equal(requested.data.actionKind, 'DEBT_OFFSET_APPROVAL');

    const requestReplay = await requestJson(`/finance/debt-offsets/${offsetId}/approve`, {
      body: { expectedVersion: 1, reason: 'Trình duyệt đối trừ' },
      idempotencyKey: `q23-offset-approve-request-${offsetId}`,
      userId: managerActor.id,
    });
    assert.equal(requestReplay.status, 200);
    assert.equal(requestReplay.data.replayed, true);

    const checked = await requestJson(`/governance-actions/${requested.data.id}/check`, {
      body: { expectedVersion: requested.data.version },
      idempotencyKey: `q23-offset-check-${offsetId}`,
      userId: accountantActor.id,
    });
    assert.equal(checked.status, 200, JSON.stringify(checked.data));

    const [approvedLeft, approvedRight] = await Promise.all([
      requestJson(`/governance-actions/${requested.data.id}/approve`, {
        body: { expectedVersion: checked.data.version },
        idempotencyKey: `q23-offset-approve-left-${offsetId}`,
        userId: actor.id,
      }),
      requestJson(`/governance-actions/${requested.data.id}/approve`, {
        body: { expectedVersion: checked.data.version },
        idempotencyKey: `q23-offset-approve-right-${offsetId}`,
        userId: actor.id,
      }),
    ]);
    assert.deepEqual([approvedLeft.status, approvedRight.status].sort((a, b) => a - b), [200, 409]);

    const [approvedOffset] = await db.select({ status: s.debtOffsets.approvalStatus })
      .from(s.debtOffsets)
      .where(eq(s.debtOffsets.id, offsetId))
      .limit(1);
    assert.equal(approvedOffset?.status, 'APPROVED');

    const approveEntries = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.txnType, TxnType.ADJUSTMENT),
        eq(s.ledger.txnId, offsetId),
        or(
          and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, customer.id)),
          and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, supplier.id)),
        ),
      ));
    assert.equal(approveEntries.length, 2);

    const cancelRequested = await requestJson(`/finance/debt-offsets/${offsetId}/cancel`, {
      body: { expectedVersion: 2, reason: 'Hoàn tác đối trừ Q23' },
      idempotencyKey: `q23-offset-cancel-request-${offsetId}`,
      userId: managerActor.id,
    });
    assert.equal(cancelRequested.status, 201, JSON.stringify(cancelRequested.data));

    const cancelChecked = await requestJson(`/governance-actions/${cancelRequested.data.id}/check`, {
      body: { expectedVersion: cancelRequested.data.version },
      idempotencyKey: `q23-offset-cancel-check-${offsetId}`,
      userId: accountantActor.id,
    });
    assert.equal(cancelChecked.status, 200, JSON.stringify(cancelChecked.data));

    const canceled = await requestJson(`/governance-actions/${cancelRequested.data.id}/approve`, {
      body: { expectedVersion: cancelChecked.data.version },
      idempotencyKey: `q23-offset-cancel-approve-${offsetId}`,
      userId: actor.id,
    });
    assert.equal(canceled.status, 200, JSON.stringify(canceled.data));

    const [canceledOffset] = await db.select({ status: s.debtOffsets.approvalStatus })
      .from(s.debtOffsets)
      .where(eq(s.debtOffsets.id, offsetId))
      .limit(1);
    assert.equal(canceledOffset?.status, 'CANCELED');

    const allAdjustmentEntries = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.txnType, TxnType.ADJUSTMENT),
        eq(s.ledger.txnId, offsetId),
        or(
          and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, customer.id)),
          and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, supplier.id)),
        ),
      ));
    assert.equal(allAdjustmentEntries.length, 4);
  });

  test('billing document create replays the original snapshot after later edits', async () => {
    const customer = await createCustomer();
    const createKey = `q23-billing-create-${customer.id}`;
    const createBody = adHocDocumentInput(customer, 'ghi chu tao lan 1', 1250000, 'dong goc');

    const first = await requestJson('/finance/billing-documents', {
      method: 'POST',
      body: createBody,
      idempotencyKey: createKey,
    });
    assert.equal(first.status, 201);
    assert.equal(first.data.replayed, false);
    const documentId = Number(first.data.id);
    billingDocumentIds.push(documentId);
    billingLineDocIds.push(documentId);

    const updateBody = adHocDocumentInput(customer, 'ghi chu cap nhat lan 2', 1450000, 'dong moi');
    const updated = await requestJson(`/finance/billing-documents/${documentId}`, {
      method: 'PUT',
      body: updateBody,
      idempotencyKey: `${createKey}-update`,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.note, 'ghi chu cap nhat lan 2');

    const replay = await requestJson('/finance/billing-documents', {
      method: 'POST',
      body: createBody,
      idempotencyKey: createKey,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.deepEqual(
      { ...replay.data, replayed: false },
      first.data,
    );
  });

  test('billing document update audits same-key changed-payload conflicts and delete is first-winner', async () => {
    const customer = await createCustomer();
    const created = await requestJson('/finance/billing-documents', {
      method: 'POST',
      body: adHocDocumentInput(customer, 'seed delete', 1000000, 'seed line'),
      idempotencyKey: `q23-billing-seed-${customer.id}`,
    });
    const documentId = Number(created.data.id);
    billingDocumentIds.push(documentId);
    billingLineDocIds.push(documentId);

    const updateKey = `q23-billing-update-${documentId}`;
    const firstUpdate = await requestJson(`/finance/billing-documents/${documentId}`, {
      method: 'PUT',
      body: adHocDocumentInput(customer, 'cap nhat 1', 1100000, 'dong 1'),
      idempotencyKey: updateKey,
    });
    assert.equal(firstUpdate.status, 200);

    const updateConflict = await requestJson(`/finance/billing-documents/${documentId}`, {
      method: 'PUT',
      body: adHocDocumentInput(customer, 'cap nhat 2', 1200000, 'dong 2'),
      idempotencyKey: updateKey,
    });
    assert.equal(updateConflict.status, 409);
    assert.match(String(updateConflict.data.error ?? ''), /Khóa giao dịch trùng/);

    const auditRows = await waitForAuditRows(
      (payload) =>
        payload.path === `/api/finance/billing-documents/${documentId}`
        && payload.statusCode === 409,
    );
    assert.ok(auditRows.some((row) => row.idempotencyKeyPresent === true));

    const [deleteA, deleteB] = await Promise.all([
      requestJson(`/finance/billing-documents/${documentId}`, {
        method: 'DELETE',
        idempotencyKey: `q23-billing-delete-a-${documentId}`,
      }),
      requestJson(`/finance/billing-documents/${documentId}`, {
        method: 'DELETE',
        idempotencyKey: `q23-billing-delete-b-${documentId}`,
      }),
    ]);
    assert.deepEqual([deleteA.status, deleteB.status].sort((a, b) => a - b), [200, 404]);
  });
});
