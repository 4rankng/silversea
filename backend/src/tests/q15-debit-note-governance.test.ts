import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role, type SaveBillingDocumentInput } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import billingDocumentsRoutes from '../routes/financial/billing-documents.routes';
import paymentsRoutes from '../routes/financial/payments.routes';
import governanceActionsRoutes from '../routes/financial/governance-actions.routes';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';
import { generateDraft } from '../services/billingDocument.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const actorIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const tripIds: number[] = [];
const documentIds: number[] = [];
const governanceActionIds: number[] = [];
const idempotencyKeys: string[] = [];
const ledgerIds: number[] = [];

let actors: Array<{ id: number; role: string }> = [];
let server: http.Server;
let baseUrl = '';

function documentVersion(updatedAt: unknown): number {
  return Math.max(1, Math.floor(new Date(String(updatedAt)).getTime() / 1000));
}

async function api(
  method: 'POST' | 'PUT',
  path: string,
  body: Record<string, unknown> | undefined,
  actorIndex: number,
  idempotencyKey?: string,
) {
  if (idempotencyKey && !idempotencyKeys.includes(idempotencyKey)) {
    idempotencyKeys.push(idempotencyKey);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Test-Actor': String(actorIndex),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function createTripFixture(status: 'LOCKED' | 'COMPLETED' = 'LOCKED', revenue = 1_000_000) {
  const [customer] = await db.insert(s.customers).values({
    name: `Q15 debit customer ${suffix}-${customerIds.length}`,
  }).returning();
  customerIds.push(customer.id);

  const [route] = await db.insert(s.routes).values({
    name: `Q15 debit route ${suffix}-${routeIds.length}`,
  }).returning();
  routeIds.push(route.id);

  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q15 debit cargo ${suffix}-${cargoTypeIds.length}`,
  }).returning();
  cargoTypeIds.push(cargoType.id);

  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q15-DN-${suffix}-${tripIds.length}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    departureDate: '2026-07-15',
    completedAt: new Date('2026-07-15T08:00:00.000Z'),
    status,
    revenue: String(revenue),
    carrierType: 'OWN',
  }).returning();
  tripIds.push(trip.id);

  return { customer, trip };
}

async function createDraftDocumentWithAdhoc(tripRevenue = 1_000_000) {
  const { customer, trip } = await createTripFixture('LOCKED', tripRevenue);
  const generated = await generateDraft({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
  });
  const input: SaveBillingDocumentInput = {
    ...generated,
    lines: [
      ...generated.lines.map((line) => ({
        ...line,
        renderData: line.renderData ? { ...line.renderData } as Record<string, unknown> : null,
      })),
      {
        sourceType: 'ADHOC',
        sourceId: null,
        lineType: 'ADHOC',
        typeLabel: 'Phụ phí bổ sung',
        unit: 'lần',
        description: `Phụ phí Q15 ${suffix}`,
        baseAmount: 250_000,
        amountOverride: null,
        excluded: false,
        sortOrder: generated.lines.length,
      },
    ],
  };
  const created = await api(
    'POST',
    '/api/finance/billing-documents',
    input as unknown as Record<string, unknown>,
    0,
    `q15-debit-create-${trip.id}`,
  );
  assert.equal(created.status, 201);
  const documentId = Number(created.body.id);
  documentIds.push(documentId);
  return { customer, trip, document: created.body };
}

before(async () => {
  actors = await db.insert(s.users).values([
    { username: `q15-dn-maker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT, status: 'ACTIVE' },
    { username: `q15-dn-checker-${suffix}`, passwordHash: 'x', role: Role.MANAGER, status: 'ACTIVE' },
    { username: `q15-dn-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN, status: 'ACTIVE' },
  ]).returning({ id: s.users.id, role: s.users.role });
  actorIds.push(...actors.map((actor) => actor.id));

  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    const actorIndex = Number(req.header('X-Test-Actor') ?? 0);
    const actor = actors[actorIndex] ?? actors[0]!;
    req.user = {
      userId: actor.id,
      username: `q15-dn-${actor.id}`,
      email: null,
      fullName: null,
      role: actor.role as Role,
    };
    next();
  });
  app.use('/api', billingDocumentsRoutes);
  app.use('/api', paymentsRoutes);
  app.use('/api', governanceActionsRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
  }
  if (governanceActionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, governanceActionIds));
  }
  if (documentIds.length > 0) {
    await db.delete(s.billingDocumentSourcePeriodLocks).where(inArray(s.billingDocumentSourcePeriodLocks.documentId, documentIds));
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, documentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
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
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  if (actorIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, actorIds));
  }
  await disconnectRedis();
  await client.end();
});

describe('Q15 debit-note issue governance', () => {
  it('keeps draft AR unchanged until a three-actor issue approval, then posts exactly once with replay safety', async () => {
    const { document } = await createDraftDocumentWithAdhoc();
    const documentId = Number(document.id);

    const beforeLedger = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(eq(s.ledger.receiptId, `GBN:${documentId}`));
    assert.equal(beforeLedger.length, 0, 'draft save must not post AR');

    const issueKey = `q15-debit-issue-${documentId}`;
    const issue = await api('POST', `/api/finance/billing-documents/${documentId}/issue`, {
      reason: 'Đề nghị phát hành giấy báo nợ tháng 07',
      expectedVersion: documentVersion(document.updatedAt),
    }, 0, issueKey);
    assert.equal(issue.status, 201);
    assert.equal(issue.body.status, 'PENDING_CHECK');
    governanceActionIds.push(Number(issue.body.id));

    const issueReplay = await api('POST', `/api/finance/billing-documents/${documentId}/issue`, {
      reason: 'Đề nghị phát hành giấy báo nợ tháng 07',
      expectedVersion: documentVersion(document.updatedAt),
    }, 0, issueKey);
    assert.equal(issueReplay.status, 200);
    assert.equal(issueReplay.body.replayed, true);

    const issueMismatch = await api('POST', `/api/finance/billing-documents/${documentId}/issue`, {
      reason: 'Lý do khác',
      expectedVersion: documentVersion(document.updatedAt),
    }, 0, issueKey);
    assert.equal(issueMismatch.status, 409);

    const selfCheck = await api('POST', `/api/governance-actions/${issue.body.id}/check`, {
      expectedVersion: Number(issue.body.version),
    }, 0, `q15-debit-self-check-${documentId}`);
    assert.equal(selfCheck.status, 403);

    const checked = await api('POST', `/api/governance-actions/${issue.body.id}/check`, {
      expectedVersion: Number(issue.body.version),
    }, 1, `q15-debit-check-${documentId}`);
    assert.equal(checked.status, 200);
    assert.equal(checked.body.status, 'PENDING_APPROVAL');

    const selfApprove = await api('POST', `/api/governance-actions/${issue.body.id}/approve`, {
      expectedVersion: Number(checked.body.version),
    }, 1, `q15-debit-self-approve-${documentId}`);
    assert.equal(selfApprove.status, 403);

    const beforeApproveLedger = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(eq(s.ledger.receiptId, `GBN:${documentId}`));
    assert.equal(beforeApproveLedger.length, 0, 'check must not post AR');

    const approveKey = `q15-debit-approve-${documentId}`;
    const approved = await api('POST', `/api/governance-actions/${issue.body.id}/approve`, {
      expectedVersion: Number(checked.body.version),
    }, 2, approveKey);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'APPROVED');
    assert.equal((approved.body.applicationResult as Record<string, unknown>).documentStatus, 'SENT');

    const approveReplay = await api('POST', `/api/governance-actions/${issue.body.id}/approve`, {
      expectedVersion: Number(checked.body.version),
    }, 2, approveKey);
    assert.equal(approveReplay.status, 200);
    assert.equal(approveReplay.body.replayed, true);

    const [storedDocument] = await db.select({
      debitNoteStatus: s.billingDocuments.debitNoteStatus,
      ledgerAdjustmentAmount: s.billingDocuments.ledgerAdjustmentAmount,
    })
      .from(s.billingDocuments)
      .where(eq(s.billingDocuments.id, documentId))
      .limit(1);
    assert.equal(storedDocument?.debitNoteStatus, 'SENT');

    const postedLedger = await db.select({
      id: s.ledger.id,
      debit: s.ledger.debit,
      credit: s.ledger.credit,
    })
      .from(s.ledger)
      .where(eq(s.ledger.receiptId, `GBN:${documentId}`));
    ledgerIds.push(...postedLedger.map((row) => row.id));
    assert.equal(postedLedger.length, 1, 'approval must post exactly one AR delta');
    assert.equal(postedLedger[0]?.debit, storedDocument?.ledgerAdjustmentAmount);
    assert.equal(postedLedger[0]?.credit, '0');
  });

  it('stores explicit rejection reason and leaves draft/state untouched', async () => {
    const { document } = await createDraftDocumentWithAdhoc();
    const documentId = Number(document.id);

    const issue = await api('POST', `/api/finance/billing-documents/${documentId}/issue`, {
      reason: 'Xin kiểm tra trước khi phát hành',
      expectedVersion: documentVersion(document.updatedAt),
    }, 0, `q15-debit-issue-reject-${documentId}`);
    assert.equal(issue.status, 201);
    governanceActionIds.push(Number(issue.body.id));

    const rejected = await api('POST', `/api/governance-actions/${issue.body.id}/reject`, {
      expectedVersion: Number(issue.body.version),
      reason: 'Thiếu đối chiếu khách hàng',
    }, 1, `q15-debit-reject-${documentId}`);
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'REJECTED');

    const [storedAction] = await db.select({
      status: s.governanceActions.status,
      rejectionReason: s.governanceActions.rejectionReason,
      rejectedBy: s.governanceActions.rejectedBy,
    })
      .from(s.governanceActions)
      .where(eq(s.governanceActions.id, Number(issue.body.id)))
      .limit(1);
    assert.equal(storedAction?.status, 'REJECTED');
    assert.equal(storedAction?.rejectionReason, 'Thiếu đối chiếu khách hàng');
    assert.equal(storedAction?.rejectedBy, actors[1]?.id);

    const [storedDocument] = await db.select({ debitNoteStatus: s.billingDocuments.debitNoteStatus })
      .from(s.billingDocuments)
      .where(eq(s.billingDocuments.id, documentId))
      .limit(1);
    assert.equal(storedDocument?.debitNoteStatus, 'DRAFT');

    const ledgerRows = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(eq(s.ledger.receiptId, `GBN:${documentId}`));
    assert.equal(ledgerRows.length, 0);
  });

  it('rejects stale-source approval and keeps the draft pending approval without posting AR', async () => {
    const { trip, document } = await createDraftDocumentWithAdhoc(1_000_000);
    const documentId = Number(document.id);

    const issue = await api('POST', `/api/finance/billing-documents/${documentId}/issue`, {
      reason: 'Đề nghị phát hành bản có chuyến nguồn',
      expectedVersion: documentVersion(document.updatedAt),
    }, 0, `q15-debit-issue-stale-${documentId}`);
    assert.equal(issue.status, 201);
    governanceActionIds.push(Number(issue.body.id));

    const checked = await api('POST', `/api/governance-actions/${issue.body.id}/check`, {
      expectedVersion: Number(issue.body.version),
    }, 1, `q15-debit-check-stale-${documentId}`);
    assert.equal(checked.status, 200);

    await db.update(s.trips).set({
      revenue: '1400000',
      version: trip.version + 1,
      updatedAt: new Date(Date.now() + 5_000),
    }).where(eq(s.trips.id, trip.id));

    const staleApprove = await api('POST', `/api/governance-actions/${issue.body.id}/approve`, {
      expectedVersion: Number(checked.body.version),
    }, 2, `q15-debit-approve-stale-${documentId}`);
    assert.equal(staleApprove.status, 409);
    assert.match(String(staleApprove.body.error ?? staleApprove.body.message ?? ''), /đã thay đổi/i);

    const [storedAction] = await db.select({ status: s.governanceActions.status })
      .from(s.governanceActions)
      .where(eq(s.governanceActions.id, Number(issue.body.id)))
      .limit(1);
    assert.equal(storedAction?.status, 'PENDING_APPROVAL');

    const [storedDocument] = await db.select({ debitNoteStatus: s.billingDocuments.debitNoteStatus })
      .from(s.billingDocuments)
      .where(eq(s.billingDocuments.id, documentId))
      .limit(1);
    assert.equal(storedDocument?.debitNoteStatus, 'DRAFT');

    const ledgerRows = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(eq(s.ledger.receiptId, `GBN:${documentId}`));
    assert.equal(ledgerRows.length, 0);
  });

  it('allows normal draft update before issue approval and still keeps AR at zero', async () => {
    const { customer, document } = await createDraftDocumentWithAdhoc();
    const documentId = Number(document.id);

    const updatedInput: SaveBillingDocumentInput = {
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityName: customer.name,
      rangeFrom: '2026-07-01',
      rangeTo: '2026-07-31',
      note: 'cap nhat nhap moi',
      lines: [{
        sourceType: 'ADHOC',
        sourceId: null,
        lineType: 'ADHOC',
        typeLabel: 'Phí điều chỉnh',
        unit: 'lần',
        description: 'Cập nhật nháp trước phê duyệt',
        baseAmount: 300_000,
        amountOverride: null,
        excluded: false,
        sortOrder: 0,
      }],
    };

    const updated = await api('PUT', `/api/finance/billing-documents/${documentId}`, updatedInput as unknown as Record<string, unknown>, 0, `q15-debit-update-${documentId}`);
    assert.equal(updated.status, 200);
    assert.equal(updated.body.note, 'cap nhat nhap moi');
    assert.notEqual(String(updated.body.updatedAt), String(document.updatedAt));

    const ledgerRows = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(eq(s.ledger.receiptId, `GBN:${documentId}`));
    assert.equal(ledgerRows.length, 0, 'draft update must not post AR');
  });
});
