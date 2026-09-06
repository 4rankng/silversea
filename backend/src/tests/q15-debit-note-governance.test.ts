import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role, type SaveBillingDocumentInput } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { applyTripPatch, insertTripComposite } from '../services/trip-composite.service';
import billingDocumentsRoutes from '../routes/financial/billing-documents.routes';
import paymentsRoutes from '../routes/financial/payments.routes';
import governanceActionsRoutes from '../routes/financial/governance-actions.routes';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';
import { generateDraft } from '../services/billing-document.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const actorIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const shipmentIds: number[] = [];
const fulfillmentIds: number[] = [];
const tripIds: number[] = [];
const tripFinancialPostingIds: number[] = [];
const podSubmissionIds: number[] = [];
const documentIds: number[] = [];
const governanceActionIds: number[] = [];
const idempotencyKeys: string[] = [];
const ledgerIds: number[] = [];

let actors: Array<{ id: number; role: string }> = [];
let server: http.Server;
let baseUrl = '';

function documentVersion(document: { version?: unknown; updatedAt?: unknown }): number {
  if (Number.isInteger(document.version) && Number(document.version) > 0) {
    return Number(document.version);
  }
  return Math.max(1, Math.floor(new Date(String(document.updatedAt)).getTime() / 1000));
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

async function createTripFixture(status: 'COMPLETED' = 'COMPLETED', revenue = 1_000_000) {
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

  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `Q15-SHP-${suffix}-${shipmentIds.length}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'NEW',
    cargoMode: 'LCL',
    createdBy: actors[0]?.id ?? null,
    updatedBy: actors[0]?.id ?? null,
  }).returning();
  shipmentIds.push(shipment.id);

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
    createdBy: actors[0]?.id ?? null,
  }).returning();
  fulfillmentIds.push(fulfillment.id);

  const trip = await insertTripComposite(db, {
    tripCode: `Q15-DN-${suffix}-${tripIds.length}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    departureDate: '2026-07-15',
    completedAt: new Date('2026-07-15T08:00:00.000Z'),
    status,
    revenue: String(revenue),
    carrierType: 'OWN',
  });
  tripIds.push(trip.id);

  const [posting] = await db.insert(s.tripFinancialPostings).values({
    tripId: trip.id,
    version: 1,
    tripVersion: trip.version,
    status: 'ACTIVE',
    reason: 'COMPLETION',
    effectiveAt: trip.completedAt ?? new Date('2026-07-15T08:00:00.000Z'),
  }).returning();
  tripFinancialPostingIds.push(posting.id);

  const [submission] = await db.insert(s.tripPodSubmissions).values({
    tripId: trip.id,
    fulfillmentId: fulfillment.id,
    submissionVersion: 1,
    sourceTripVersion: trip.version,
    status: 'ACCEPTED',
    submittedBy: actors[0]?.id ?? null,
    submittedAt: new Date('2026-07-15T09:00:00.000Z'),
    reviewedBy: actors[1]?.id ?? actors[0]?.id ?? null,
    reviewedAt: new Date('2026-07-15T10:00:00.000Z'),
    rejectionReason: null,
  }).returning();
  podSubmissionIds.push(submission.id);

  return { customer, trip };
}

async function createDraftDocumentFromSources(tripRevenue = 1_000_000) {
  const { customer, trip } = await createTripFixture('COMPLETED', tripRevenue);
  const generated = await generateDraft({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
  });
  const input: SaveBillingDocumentInput & {
    sourceRefs: Array<{
      sourceType: 'TRIP' | 'EXPENSE';
      sourceId: number;
      financialPostingId?: number;
      financialPostingVersion?: number;
      postingChecksum?: string;
      sourceVersion?: string;
    }>;
  } = {
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    entityName: generated.entityName,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
    note: null,
    sourceRefs: generated.lines.map((line) => {
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
  if (podSubmissionIds.length > 0) {
    await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, podSubmissionIds));
  }
  if (tripFinancialPostingIds.length > 0) {
    await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, tripFinancialPostingIds));
  }
  if (tripIds.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (fulfillmentIds.length > 0) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
  }
  if (shipmentIds.length > 0) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
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
    const { document } = await createDraftDocumentFromSources();
    const documentId = Number(document.id);

    const beforeLedger = await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(eq(s.ledger.receiptId, `GBN:${documentId}`));
    assert.equal(beforeLedger.length, 0, 'draft save must not post AR');

    const issueKey = `q15-debit-issue-${documentId}`;
    const issue = await api('POST', `/api/finance/billing-documents/${documentId}/issue`, {
      reason: 'Đề nghị phát hành giấy báo nợ tháng 07',
      expectedVersion: documentVersion(document),
    }, 0, issueKey);
    assert.equal(issue.status, 201);
    assert.equal(issue.body.status, 'PENDING_CHECK');
    governanceActionIds.push(Number(issue.body.id));

    const issueReplay = await api('POST', `/api/finance/billing-documents/${documentId}/issue`, {
      reason: 'Đề nghị phát hành giấy báo nợ tháng 07',
      expectedVersion: documentVersion(document),
    }, 0, issueKey);
    assert.equal(issueReplay.status, 200);
    assert.equal(issueReplay.body.replayed, true);

    const issueMismatch = await api('POST', `/api/finance/billing-documents/${documentId}/issue`, {
      reason: 'Lý do khác',
      expectedVersion: documentVersion(document),
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
    assert.equal(storedDocument?.ledgerAdjustmentAmount, '0');
    assert.equal(postedLedger.length, 0, 'source-backed issue approval must not duplicate trip-lock AR');
  });

  it('stores explicit rejection reason and leaves draft/state untouched', async () => {
    const { document } = await createDraftDocumentFromSources();
    const documentId = Number(document.id);

    const issue = await api('POST', `/api/finance/billing-documents/${documentId}/issue`, {
      reason: 'Xin kiểm tra trước khi phát hành',
      expectedVersion: documentVersion(document),
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
    const { trip, document } = await createDraftDocumentFromSources(1_000_000);
    const documentId = Number(document.id);

    const issue = await api('POST', `/api/finance/billing-documents/${documentId}/issue`, {
      reason: 'Đề nghị phát hành bản có chuyến nguồn',
      expectedVersion: documentVersion(document),
    }, 0, `q15-debit-issue-stale-${documentId}`);
    assert.equal(issue.status, 201);
    governanceActionIds.push(Number(issue.body.id));

    const checked = await api('POST', `/api/governance-actions/${issue.body.id}/check`, {
      expectedVersion: Number(issue.body.version),
    }, 1, `q15-debit-check-stale-${documentId}`);
    assert.equal(checked.status, 200);

    await applyTripPatch(db, trip.id, {
      revenue: '1400000',
      version: trip.version + 1,
      updatedAt: new Date(Date.now() + 5_000),
    });

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
    const { customer, document } = await createDraftDocumentFromSources();
    const documentId = Number(document.id);

    const regenerated = await generateDraft({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      rangeFrom: '2026-07-01',
      rangeTo: '2026-07-31',
    });
    const updatedInput: SaveBillingDocumentInput & {
      sourceRefs: Array<{
        sourceType: 'TRIP' | 'EXPENSE';
        sourceId: number;
        financialPostingId?: number;
        financialPostingVersion?: number;
        postingChecksum?: string;
        sourceVersion?: string;
      }>;
    } = {
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityName: regenerated.entityName,
      rangeFrom: '2026-07-01',
      rangeTo: '2026-07-31',
      note: 'cap nhat nhap moi',
      sourceRefs: regenerated.lines.map((line) => {
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
