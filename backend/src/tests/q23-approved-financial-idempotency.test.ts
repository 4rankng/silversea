import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, eq, inArray, or } from 'drizzle-orm';
import { Role, TxnType, type SaveBillingDocumentInput } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { withTestCleanup } from './helpers/db-isolation';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import advancesRoutes from '../routes/financial/advances.routes';
import billingDocumentsRoutes from '../routes/financial/billing-documents.routes';
import debtOffsetsRoutes from '../routes/financial/debt-offsets.routes';
import paymentsRoutes from '../routes/financial/payments.routes';
import { initAuditService } from '../services/audit.service';
import { generateDraft } from '../services/billing-document.service';
import { initNotificationService } from '../services/notification.service';
import { disconnectRedis } from '../lib/redis';
import { upsertPartnerFromTaxCode } from '../services/legal-partner.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cleanup = withTestCleanup();
const userIds: number[] = [];
const customerIds: number[] = [];
const supplierIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const shipmentIds: number[] = [];
const fulfillmentIds: number[] = [];
const tripIds: number[] = [];
const tripFinancialPostingIds: number[] = [];
const podSubmissionIds: number[] = [];
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

async function createBillableDebitDocumentInput(
  customer: { id: number; name: string },
  note: string,
  amount: number,
): Promise<SaveBillingDocumentInput> {
  const [route] = await db.insert(s.routes).values({
    name: `Q23 billing route ${suffix}-${routeIds.length}`,
  }).returning({ id: s.routes.id });
  routeIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q23 billing cargo ${suffix}-${cargoTypeIds.length}`,
  }).returning({ id: s.cargoTypes.id });
  cargoTypeIds.push(cargoType.id);
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `Q23-BILL-SHP-${suffix}-${shipmentIds.length}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    cargoMode: 'LCL',
    status: 'NEW',
  }).returning();
  shipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
    createdBy: null,
  }).returning();
  fulfillmentIds.push(fulfillment.id);
  const completedAt = new Date('2026-07-15T09:00:00.000Z');
  const trip = await insertTripComposite(db, {
    tripCode: `Q23-BILL-${suffix}-${tripIds.length}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    departureDate: '2026-07-15',
    completedAt,
    status: 'COMPLETED',
    revenue: String(amount),
    carrierType: 'OWN',
  });
  tripIds.push(trip.id);
  const [posting] = await db.insert(s.tripFinancialPostings).values({
    tripId: trip.id,
    version: 1,
    tripVersion: trip.version,
    status: 'ACTIVE',
    reason: 'COMPLETION',
    effectiveAt: completedAt,
  }).returning({ id: s.tripFinancialPostings.id });
  tripFinancialPostingIds.push(posting.id);
  const [submission] = await db.insert(s.tripPodSubmissions).values({
    tripId: trip.id,
    fulfillmentId: fulfillment.id,
    submissionVersion: 1,
    sourceTripVersion: trip.version,
    status: 'ACCEPTED',
    submittedBy: accountantActor.id,
    submittedAt: new Date('2026-07-15T09:01:00.000Z'),
    reviewedBy: managerActor.id,
    reviewedAt: new Date('2026-07-15T09:02:00.000Z'),
    rejectionReason: null,
  }).returning({ id: s.tripPodSubmissions.id });
  podSubmissionIds.push(submission.id);

  const draft = await generateDraft({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
  });
  return {
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    entityName: draft.entityName,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
    note,
    sourceRefs: draft.lines.map((line) => {
      if (line.sourceType === 'TRIP' && line.sourceId != null) {
        assert.ok(line.financialPostingId != null);
        assert.ok(line.financialPostingVersion != null);
        assert.ok(line.postingChecksum);
        return {
          sourceType: 'TRIP' as const,
          sourceId: line.sourceId,
          financialPostingId: line.financialPostingId,
          financialPostingVersion: line.financialPostingVersion,
          postingChecksum: line.postingChecksum,
        };
      }
      assert.equal(line.sourceType, 'EXPENSE');
      assert.ok(line.sourceId != null);
      assert.equal(typeof line.renderData?.sourceVersion, 'string');
      return {
        sourceType: 'EXPENSE' as const,
        sourceId: line.sourceId,
        sourceVersion: String(line.renderData?.sourceVersion),
      };
    }),
  } as SaveBillingDocumentInput;
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

  try {
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
  }
  await cleanup.deleteAll(s.auditLogs, auditLogIds);
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
      eq(s.ledger.txnType, TxnType.OPS_ADVANCE),
      inArray(s.ledger.txnId, advanceRequestIds),
    ));
    await db.delete(s.advanceRequests).where(inArray(s.advanceRequests.id, advanceRequestIds));
  }
  await cleanup.deleteWhere(s.billingDocumentLines, billingLineDocIds, (ids) => inArray(s.billingDocumentLines.documentId, ids));
  if (billingDocumentIds.length > 0) {
    await db.delete(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.ADJUSTMENT),
      inArray(s.ledger.txnId, billingDocumentIds),
    ));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, billingDocumentIds));
  }
  await cleanup.deleteAll(s.tripPodSubmissions, podSubmissionIds);
  await cleanup.deleteAll(s.tripFinancialPostings, tripFinancialPostingIds);
  await cleanup.deleteAll(s.trips, tripIds);
  await cleanup.deleteAll(s.shipmentFulfillments, fulfillmentIds);
  await cleanup.deleteAll(s.shipments, shipmentIds);
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
  await cleanup.deleteAll(s.customers, customerIds);
  await cleanup.deleteAll(s.suppliers, supplierIds);
  await cleanup.deleteAll(s.routes, routeIds);
  await cleanup.deleteAll(s.cargoTypes, cargoTypeIds);
  if (userIds.length > 0) {
    await db.delete(s.notifications)
      .where(inArray(s.notifications.userId, userIds));
  }
  await cleanup.deleteAll(s.users, userIds);
  } finally {
    await disconnectRedis();
    await client.end();
  }
});

describe('Q23 approved financial route idempotency', () => {
  test('advance settlement update replays the original snapshot and rejects same-key changed payloads', async () => {
    const requester = await createUser(Role.OPS, 'q23-forwarder');
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
    const requester = await createUser(Role.OPS, 'q23-approve-forwarder');
    const request = await createPendingAdvanceRequest(requester.id, 275000);

    // 2026-09-10 (phê duyệt removed): the approve route applies immediately —
    // two concurrent distinct-key approvals: the first applies (201), the
    // second finds the request already APPROVED and 409s.
    const [first, second] = await Promise.all([
      requestJson(`/advance-requests/${request.id}/approve`, {
        body: { expectedVersion: request.version, reason: 'Trình duyệt tạm ứng' },
        idempotencyKey: `q23-advance-approve-a-${request.id}`,
        userId: managerActor.id,
      }),
      requestJson(`/advance-requests/${request.id}/approve`, {
        body: { expectedVersion: request.version, reason: 'Trình duyệt tạm ứng' },
        idempotencyKey: `q23-advance-approve-b-${request.id}`,
        userId: managerActor.id,
      }),
    ]);
    assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [201, 409]);
    const winner = first.status === 201 ? first : second;
    assert.equal(winner.data.actionKind, 'ADVANCE_REQUEST_APPROVAL');

    const winnerKey = winner === first
      ? `q23-advance-approve-a-${request.id}`
      : `q23-advance-approve-b-${request.id}`;
    const replay = await requestJson(`/advance-requests/${request.id}/approve`, {
      body: { expectedVersion: request.version, reason: 'Trình duyệt tạm ứng' },
      idempotencyKey: winnerKey,
      userId: managerActor.id,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);

    const conflict = await requestJson(`/advance-requests/${request.id}/approve`, {
      body: { expectedVersion: request.version, reason: 'Đổi lý do' },
      idempotencyKey: winnerKey,
      userId: managerActor.id,
    });
    assert.equal(conflict.status, 409);

    const [updated] = await db.select({ status: s.advanceRequests.status })
      .from(s.advanceRequests)
      .where(eq(s.advanceRequests.id, request.id))
      .limit(1);
    assert.equal(updated?.status, 'APPROVED');

    const ledgerRows = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.txnType, TxnType.OPS_ADVANCE),
        eq(s.ledger.txnId, request.id),
      ));
    ledgerIds.push(...ledgerRows.map((row) => row.id));
    assert.equal(ledgerRows.length, 1);
  });

  test('advance request rejection applies immediately with no ledger effect (phê duyệt removed)', async () => {
    const requester = await createUser(Role.OPS, 'q15-reject-forwarder');
    const request = await createPendingAdvanceRequest(requester.id, 315000);
    const rejected = await requestJson(`/advance-requests/${request.id}/reject`, {
      body: { expectedVersion: request.version, reason: 'Chứng từ tạm ứng không hợp lệ' },
      idempotencyKey: `q15-advance-reject-${request.id}`,
      userId: managerActor.id,
    });
    assert.equal(rejected.status, 201, JSON.stringify(rejected.data));
    assert.equal(rejected.data.actionKind, 'ADVANCE_REQUEST_REJECTION');

    const [row] = await db.select().from(s.advanceRequests)
      .where(eq(s.advanceRequests.id, request.id))
      .limit(1);
    assert.ok(row);
    // Applied in ONE call: the request is REJECTED and the transient action
    // record returned by the route is APPROVED with the single actor making
    // and applying the decision.
    assert.equal(row.status, 'REJECTED');
    assert.equal(row.approvedBy, managerActor.id);
    assert.equal(rejected.data.status, 'APPROVED');
    assert.equal(rejected.data.makerId, rejected.data.approverId);
    assert.equal(rejected.data.subjectId, request.id);
    const ledgerAfter = await db.select().from(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.OPS_ADVANCE),
      eq(s.ledger.txnId, request.id),
    ));
    assert.equal(ledgerAfter.length, 0);
  });

  test('debt offset create applies immediately; cancel applies with reversal entries (phê duyệt removed)', async () => {
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

    // 2026-09-10 (phê duyệt removed): the create applies immediately —
    // APPROVED with the paired ADJUSTMENT entries posted in one call.
    assert.equal(created.data.approvalStatus, 'APPROVED');
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
    ledgerIds.push(...approveEntries.map((row) => row.id));
    assert.equal(approveEntries.length, 2);

    // The approve endpoint is now a dead path on an applied offset: 409.
    const approveAfter = await requestJson(`/finance/debt-offsets/${offsetId}/approve`, {
      body: { expectedVersion: 2, reason: 'Trình duyệt đối trừ' },
      idempotencyKey: `q23-offset-approve-after-${offsetId}`,
      userId: managerActor.id,
    });
    assert.equal(approveAfter.status, 409);

    // Cancel applies immediately: CANCELED with the reversing pair (4 total).
    const cancelApplied = await requestJson(`/finance/debt-offsets/${offsetId}/cancel`, {
      body: { expectedVersion: 2, reason: 'Hoàn tác đối trừ Q23' },
      idempotencyKey: `q23-offset-cancel-request-${offsetId}`,
      userId: managerActor.id,
    });
    assert.equal(cancelApplied.status, 201, JSON.stringify(cancelApplied.data));

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
    ledgerIds.push(...allAdjustmentEntries.map((row) => row.id));
    assert.equal(allAdjustmentEntries.length, 4);
  });

  test('billing document create replays the original snapshot after later edits', async () => {
    const customer = await createCustomer();
    const createKey = `q23-billing-create-${customer.id}`;
    const createBody = await createBillableDebitDocumentInput(customer, 'ghi chu tao lan 1', 1250000);

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

    const updateBody = await createBillableDebitDocumentInput(customer, 'ghi chu cap nhat lan 2', 1450000);
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
    const seedBody = await createBillableDebitDocumentInput(customer, 'seed delete', 1000000);
    const created = await requestJson('/finance/billing-documents', {
      method: 'POST',
      body: seedBody,
      idempotencyKey: `q23-billing-seed-${customer.id}`,
    });
    const documentId = Number(created.data.id);
    billingDocumentIds.push(documentId);
    billingLineDocIds.push(documentId);

    const updateKey = `q23-billing-update-${documentId}`;
    const firstUpdateBody = await createBillableDebitDocumentInput(customer, 'cap nhat 1', 1100000);
    const firstUpdate = await requestJson(`/finance/billing-documents/${documentId}`, {
      method: 'PUT',
      body: firstUpdateBody,
      idempotencyKey: updateKey,
    });
    assert.equal(firstUpdate.status, 200);

    const conflictingUpdateBody = await createBillableDebitDocumentInput(customer, 'cap nhat 2', 1200000);
    const updateConflict = await requestJson(`/finance/billing-documents/${documentId}`, {
      method: 'PUT',
      body: conflictingUpdateBody,
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
