import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Role, type SaveBillingDocumentInput } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { generateDraft, getDocument, saveDocument } from '../services/billingDocument.service';
import { transitionDebitNoteStatus } from '../services/debit-note-lifecycle.service';
import { listRecoverableCosts } from '../services/recoverable-cost.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const actorIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const shipmentIds: number[] = [];
const fulfillmentIds: number[] = [];
const tripIds: number[] = [];
const postingIds: number[] = [];
const podSubmissionIds: number[] = [];
const expenseTypeIds: number[] = [];
const expenseIds: number[] = [];
const documentIds: number[] = [];

let actorId = 0;

before(async () => {
  const [actor] = await db.insert(s.users).values({
    username: `q15-claim-${suffix}`,
    passwordHash: 'x',
    role: 'ACCOUNTANT',
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  actorId = actor.id;
  actorIds.push(actor.id);
});

after(async () => {
  if (documentIds.length > 0) {
    await db.delete(s.billingDocumentRecoverableClaims).where(inArray(s.billingDocumentRecoverableClaims.documentId, documentIds));
    await db.delete(s.billingDocumentTripClaims).where(inArray(s.billingDocumentTripClaims.documentId, documentIds));
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, documentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
  }
  if (expenseIds.length > 0) {
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, expenseIds));
  }
  if (podSubmissionIds.length > 0) {
    await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, podSubmissionIds));
  }
  if (postingIds.length > 0) {
    await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, postingIds));
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
  if (expenseTypeIds.length > 0) {
    await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, expenseTypeIds));
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
  await client.end();
});

async function createTripFixture(options: {
  tripCodePrefix: string;
  departureDate: string;
  completedAt: Date;
  revenue: number;
  fuelSurchargeAmount?: number;
  createRecoverableExpense?: boolean;
  expenseDate?: string;
}) {
  const [customer] = await db.insert(s.customers).values({
    name: `Q15 claim customer ${options.tripCodePrefix} ${Date.now()}`,
    status: 'ACTIVE',
    debitNoteMode: 'MONTHLY',
  }).returning();
  const [route] = await db.insert(s.routes).values({
    name: `Q15 claim route ${options.tripCodePrefix} ${Date.now()}`,
  }).returning();
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q15 claim cargo ${options.tripCodePrefix} ${Date.now()}`,
  }).returning();
  customerIds.push(customer.id);
  routeIds.push(route.id);
  cargoTypeIds.push(cargoType.id);

  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `${options.tripCodePrefix}-SHP-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'DRAFT',
    cargoMode: 'LCL',
    createdBy: actorId,
    updatedBy: actorId,
  }).returning();
  shipmentIds.push(shipment.id);

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
    createdBy: actorId,
  }).returning();
  fulfillmentIds.push(fulfillment.id);

  const [trip] = await db.insert(s.trips).values({
    tripCode: `${options.tripCodePrefix}-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    departureDate: options.departureDate,
    completedAt: options.completedAt,
    status: 'COMPLETED',
    revenue: String(options.revenue),
    fuelSurchargeAmount: String(options.fuelSurchargeAmount ?? 0),
    carrierType: 'OWN',
  }).returning();
  tripIds.push(trip.id);

  const [posting] = await db.insert(s.tripFinancialPostings).values({
    tripId: trip.id,
    version: 1,
    tripVersion: trip.version,
    status: 'ACTIVE',
    reason: 'COMPLETION',
    effectiveAt: options.completedAt,
  }).returning({ id: s.tripFinancialPostings.id });
  postingIds.push(posting.id);

  const [submission] = await db.insert(s.tripPodSubmissions).values({
    tripId: trip.id,
    fulfillmentId: fulfillment.id,
    submissionVersion: 1,
    sourceTripVersion: trip.version,
    status: 'ACCEPTED',
    submittedBy: actorId,
    submittedAt: new Date(options.completedAt.getTime() + 60_000),
    reviewedBy: actorId,
    reviewedAt: new Date(options.completedAt.getTime() + 120_000),
    rejectionReason: null,
  }).returning({ id: s.tripPodSubmissions.id });
  podSubmissionIds.push(submission.id);

  let expenseId: number | null = null;
  if (options.createRecoverableExpense) {
    const [expenseType] = await db.insert(s.forwarderExpenseTypes).values({
      code: `Q15CLAIM${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: `Q15 claim fee ${options.tripCodePrefix}`,
      requiresInvoice: false,
      substituteEvidenceAllowed: true,
    }).returning();
    expenseTypeIds.push(expenseType.id);

    const [expense] = await db.insert(s.tripExpenses).values({
      tripId: trip.id,
      expenseType: expenseType.code,
      buyAmount: '100000',
      sellAmount: '200000',
      recoverablePrincipalAmount: '100000',
      serviceFeeAmount: '100000',
      expenseDate: options.expenseDate ?? options.departureDate,
      payeeName: `Q15 claim payee ${options.tripCodePrefix}`,
      note: `Q15 claim fee ${options.tripCodePrefix}`,
      noInvoiceEvidenceTypes: ['RECEIPT'],
      approvalStatus: 'APPROVED',
      createdBy: actorId,
    }).returning({ id: s.tripExpenses.id });
    expenseIds.push(expense.id);
    expenseId = expense.id;
  }

  return { customer, trip, expenseId };
}

async function buildDraftInput(customerId: number, rangeFrom: string, rangeTo: string): Promise<SaveBillingDocumentInput> {
  const draft = await generateDraft({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customerId,
    rangeFrom,
    rangeTo,
  });
  return {
    ...draft,
    note: null,
    lines: draft.lines.map((line) => ({
      ...line,
      renderData: line.renderData ? { ...line.renderData } : null,
    })),
  };
}

async function saveDraft(customerId: number, rangeFrom: string, rangeTo: string) {
  const input = await buildDraftInput(customerId, rangeFrom, rangeTo);
  const document = await saveDocument(input, actorId);
  documentIds.push(document.id!);
  return document;
}

test('stores the incl-VAT fuel surcharge in the canonical freight total without duplicating AR', async () => {
  const { customer } = await createTripFixture({
    tripCodePrefix: 'Q15-FUEL-AR',
    departureDate: '2026-08-02',
    completedAt: new Date('2026-08-02T09:00:00.000Z'),
    revenue: 1_000_000,
    fuelSurchargeAmount: 250_000,
  });

  const draft = await buildDraftInput(customer.id, '2026-08-01', '2026-08-31');
  const freight = (draft.lines ?? []).find((line) => line.sourceType === 'TRIP');
  assert.ok(freight);
  assert.equal(freight.baseAmount, 1_250_000);
  assert.equal(freight.grossAmount, 1_250_000);
  assert.equal(freight.renderData?.freightAmount, 1_000_000);
  assert.equal(freight.renderData?.fuelSurchargeAmount, 250_000);

  const saved = await saveDocument(draft, actorId);
  documentIds.push(saved.id!);
  assert.equal(saved.totalInclVat, 1_250_000);
  assert.equal(saved.ledgerAdjustmentAmount, 0);
});

test('allows the same trip on non-overlapping periods when July is expense-only and August is freight', async () => {
  const { customer } = await createTripFixture({
    tripCodePrefix: 'Q15-NONOVERLAP',
    departureDate: '2026-07-31',
    completedAt: new Date('2026-08-02T09:00:00.000Z'),
    revenue: 2_000_000,
    createRecoverableExpense: true,
    expenseDate: '2026-07-31',
  });

  const julyDoc = await saveDraft(customer.id, '2026-07-01', '2026-07-31');
  const augustDoc = await saveDraft(customer.id, '2026-08-01', '2026-08-31');

  const julyDetail = await getDocument(julyDoc.id!);
  const augustDetail = await getDocument(augustDoc.id!);
  assert.equal(julyDetail.lines.some((line) => line.sourceType === 'TRIP'), false);
  assert.equal(julyDetail.lines.some((line) => line.sourceType === 'EXPENSE'), true);
  assert.equal(augustDetail.lines.some((line) => line.sourceType === 'TRIP'), true);
  assert.equal(augustDetail.lines.some((line) => line.sourceType === 'EXPENSE'), false);

  const claims = await db.select({
    documentId: s.billingDocumentTripClaims.documentId,
    rangeFrom: s.billingDocumentTripClaims.rangeFrom,
    rangeTo: s.billingDocumentTripClaims.rangeTo,
    releasedAt: s.billingDocumentTripClaims.releasedAt,
  })
    .from(s.billingDocumentTripClaims)
    .where(and(
      eq(s.billingDocumentTripClaims.tripId, augustDetail.lines.find((line) => line.sourceType === 'TRIP')!.sourceId!),
      isNull(s.billingDocumentTripClaims.releasedAt),
    ))
    .orderBy(s.billingDocumentTripClaims.rangeFrom);
  assert.deepEqual(
    claims.map((claim) => [claim.documentId, claim.rangeFrom, claim.rangeTo]),
    [
      [julyDoc.id!, '2026-07-01', '2026-07-31'],
      [augustDoc.id!, '2026-08-01', '2026-08-31'],
    ],
  );
});

test('overlapping save conflicts when the first document claims the trip only through expenses, and CANCELED releases it', async () => {
  const { customer, trip, expenseId } = await createTripFixture({
    tripCodePrefix: 'Q15-OVERLAP',
    departureDate: '2026-07-20',
    completedAt: new Date('2026-07-20T09:00:00.000Z'),
    revenue: 2_000_000,
    createRecoverableExpense: true,
    expenseDate: '2026-07-01',
  });

  const julyDoc = await saveDraft(customer.id, '2026-07-01', '2026-07-10');
  const overlappingFreightInput = await buildDraftInput(customer.id, '2026-07-05', '2026-07-31');
  const overlappingFreightLines = (overlappingFreightInput.lines ?? [])
    .filter((line) => line.sourceType === 'TRIP');
  overlappingFreightInput.lines = overlappingFreightLines;
  assert.equal(overlappingFreightLines.length, 1);
  await assert.rejects(
    () => saveDocument(overlappingFreightInput, actorId),
    (error) => error instanceof ApiError
      && error.statusCode === 409
      && /chồng lấn/i.test(error.message),
  );

  await transitionDebitNoteStatus({
    documentId: julyDoc.id!,
    targetStatus: 'SENT',
    actorUserId: actorId,
  });
  await transitionDebitNoteStatus({
    documentId: julyDoc.id!,
    targetStatus: 'CANCELED',
    actorUserId: actorId,
  });

  const [releasedClaim] = await db.select({
    releasedAt: s.billingDocumentTripClaims.releasedAt,
    releaseReason: s.billingDocumentTripClaims.releaseReason,
  })
    .from(s.billingDocumentTripClaims)
    .where(and(
      eq(s.billingDocumentTripClaims.documentId, julyDoc.id!),
      eq(s.billingDocumentTripClaims.tripId, trip.id),
    ))
    .limit(1);
  assert.ok(releasedClaim?.releasedAt, 'claim must be released after canceling the document');
  assert.equal(releasedClaim?.releaseReason, 'DOCUMENT_CANCELED');

  const [releasedExpenseClaim] = await db.select({
    releasedAt: s.billingDocumentRecoverableClaims.releasedAt,
    releasedBy: s.billingDocumentRecoverableClaims.releasedBy,
    releaseReason: s.billingDocumentRecoverableClaims.releaseReason,
  }).from(s.billingDocumentRecoverableClaims)
    .where(and(
      eq(s.billingDocumentRecoverableClaims.documentId, julyDoc.id!),
      eq(s.billingDocumentRecoverableClaims.expenseId, expenseId!),
    ))
    .limit(1);
  assert.ok(releasedExpenseClaim?.releasedAt, 'recoverable claim history must be retained after cancellation');
  assert.equal(releasedExpenseClaim?.releasedBy, actorId);
  assert.equal(releasedExpenseClaim?.releaseReason, 'DOCUMENT_CANCELED');

  const releasedExpenseListing = await listRecoverableCosts(
    { userId: actorId, role: Role.ACCOUNTANT },
    { page: 1, limit: 100, customerId: customer.id },
  );
  const releasedExpense = releasedExpenseListing.items.find((item) => item.id === expenseId);
  assert.ok(releasedExpense, 'released expense remains visible for rebilling');
  assert.equal(releasedExpense.eligibility.state, 'ELIGIBLE');
  assert.equal(releasedExpense.claim, null);

  const overlappingDoc = await saveDocument(overlappingFreightInput, actorId);
  documentIds.push(overlappingDoc.id!);
  assert.ok(overlappingDoc.id);
});

test('concurrent overlapping saves leave one winner and one 409 conflict', async () => {
  const { customer, trip } = await createTripFixture({
    tripCodePrefix: 'Q15-CONCURRENT',
    departureDate: '2026-07-20',
    completedAt: new Date('2026-07-20T09:00:00.000Z'),
    revenue: 1_500_000,
  });

  const results = await Promise.allSettled([
    saveDraft(customer.id, '2026-07-01', '2026-07-31'),
    saveDraft(customer.id, '2026-07-15', '2026-07-31'),
  ]);

  const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof saveDraft>>> => result.status === 'fulfilled');
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(String(rejected[0]!.reason), /chồng lấn|nhận trước/i);

  const activeClaims = await db.select({ id: s.billingDocumentTripClaims.id })
    .from(s.billingDocumentTripClaims)
    .where(and(
      eq(s.billingDocumentTripClaims.tripId, trip.id),
      isNull(s.billingDocumentTripClaims.releasedAt),
    ));
  assert.equal(activeClaims.length, 1);
});

test('expense-only stale preview rejects when the latest e-POD is no longer accepted at save time', async () => {
  const { customer, trip } = await createTripFixture({
    tripCodePrefix: 'Q15-STALE',
    departureDate: '2026-07-31',
    completedAt: new Date('2026-08-02T09:00:00.000Z'),
    revenue: 2_000_000,
    createRecoverableExpense: true,
    expenseDate: '2026-07-31',
  });

  const input = await buildDraftInput(customer.id, '2026-07-01', '2026-07-31');
  assert.equal((input.lines ?? []).some((line) => line.sourceType === 'TRIP'), false);
  assert.equal((input.lines ?? []).some((line) => line.sourceType === 'EXPENSE'), true);

  const [latestSubmission] = await db.select({
    id: s.tripPodSubmissions.id,
  }).from(s.tripPodSubmissions)
    .where(eq(s.tripPodSubmissions.tripId, trip.id))
    .orderBy(s.tripPodSubmissions.submissionVersion)
    .limit(1);
  const [rejectedSubmission] = await db.insert(s.tripPodSubmissions).values({
    tripId: trip.id,
    fulfillmentId: trip.fulfillmentId!,
    submissionVersion: 2,
    sourceTripVersion: trip.version,
    status: 'REJECTED',
    supersedesSubmissionId: latestSubmission.id,
    submittedBy: actorId,
    submittedAt: new Date('2026-08-02T10:00:00.000Z'),
    reviewedBy: actorId,
    reviewedAt: new Date('2026-08-02T10:05:00.000Z'),
    rejectionReason: 'Thiếu chứng từ giao nhận bản ký',
  }).returning({ id: s.tripPodSubmissions.id });
  podSubmissionIds.push(rejectedSubmission.id);

  await assert.rejects(
    () => saveDocument(input, actorId),
    (error) => error instanceof ApiError
      && error.statusCode === 409
      && /e-POD bị từ chối/i.test(error.message),
  );
});
