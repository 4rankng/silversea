import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { Role, type SaveBillingDocumentInput } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import type { AuthUser } from '../middleware/auth';
import {
  generateDraft,
  getDocument,
  saveDocument,
} from '../services/billingDocument.service';
import { assembleDisbursementsForPeriod } from '../services/disbursement-assembly.service';
import {
  approveGovernanceAction,
  checkGovernanceAction,
} from '../services/adjustment-governance.service';
import { approveDirectMoneyGovernanceAction } from '../services/governance-transition.service';
import { requestBillingDocumentAdjustment } from '../services/billing-document-governance.service';
import { transitionDebitNoteStatus } from '../services/debit-note-lifecycle.service';
import {
  listAllocationsForReceipt,
  recordPaymentReceipt,
  requestPaymentRefundGovernance,
} from '../services/payment-allocation.service';
import {
  createShipment,
  reviewShipmentChangeRequest,
  snapshotContainersIntoTrip,
  transitionShipmentStatus,
  updateShipment,
} from '../services/shipment.service';
import {
  propagateExpenseApproval,
  propagateTripFinancialSourceChange,
} from '../services/source-change.service';
import { lockTripFinancialAuthority } from '../services/trip-financial-authority-lock.service';
import { createTrip } from '../services/trip.service';
import { getTripArStatus, getCustomerArSummary } from '../services/ar-status.service';
import { getReceivablesSummary, getCustomerAgingList } from '../services/aging.service';
import { getStatementData } from '../services/statement.service';
import { getPaymentTermEvalReport } from '../services/payment-term.service';
import { getCustomerOverdueAmount } from '../services/receivable-reminder.service';

const actorIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const containerTypeIds: number[] = [];
const tripIds: number[] = [];
const tripFinancialPostingIds: number[] = [];
const documentIds: number[] = [];
const governanceActionIds: number[] = [];
const receiptIds: string[] = [];
const expenseIds: number[] = [];
const expenseTypeIds: number[] = [];
const shipmentIds: number[] = [];
const shipmentContainerIds: number[] = [];
const fulfillmentIds: number[] = [];
const podSubmissionIds: number[] = [];
const tripContainerIds: number[] = [];
const paymentReceiptIds: number[] = [];
const paymentAllocationIds: number[] = [];
const notificationIds: number[] = [];

let actors: Array<{ id: number; role: string }> = [];

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  actors = await db.insert(s.users).values([
    { username: `q22-maker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT },
    { username: `q22-checker-${suffix}`, passwordHash: 'x', role: Role.MANAGER },
    { username: `q22-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN },
  ]).returning({ id: s.users.id, role: s.users.role });
  actorIds.push(...actors.map((actor) => actor.id));
});

after(async () => {
  try {
  if (notificationIds.length > 0) {
    await db.delete(s.notifications).where(inArray(s.notifications.id, notificationIds));
  }
  if (actorIds.length > 0) {
    await db.delete(s.notifications).where(inArray(s.notifications.userId, actorIds));
  }
  if (paymentAllocationIds.length > 0) {
    await db.delete(s.paymentAllocations).where(inArray(s.paymentAllocations.id, paymentAllocationIds));
  }
  if (paymentReceiptIds.length > 0) {
    await db.delete(s.paymentRefunds).where(inArray(s.paymentRefunds.paymentReceiptId, paymentReceiptIds));
    await db.delete(s.paymentReceipts).where(inArray(s.paymentReceipts.id, paymentReceiptIds));
  }
  if (governanceActionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, governanceActionIds));
  }
  if (receiptIds.length > 0 || expenseIds.length > 0) {
    await db.delete(s.ledger).where(or(
      receiptIds.length > 0 ? inArray(s.ledger.receiptId, receiptIds) : undefined,
      expenseIds.length > 0
        ? and(eq(s.ledger.txnType, 'SERVICE_FEE'), inArray(s.ledger.txnId, expenseIds))
        : undefined,
    ));
  }
  if (tripIds.length > 0) {
    await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, tripIds));
  }
  if (documentIds.length > 0) {
    await db.delete(s.billingDocumentTripClaims).where(inArray(s.billingDocumentTripClaims.documentId, documentIds));
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, documentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
  }
  if (tripFinancialPostingIds.length > 0) {
    await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, tripFinancialPostingIds));
  }
  if (expenseIds.length > 0) {
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, expenseIds));
  }
  if (podSubmissionIds.length > 0) {
    await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, podSubmissionIds));
  }
  if (shipmentContainerIds.length > 0) {
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, shipmentContainerIds));
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
  if (containerTypeIds.length > 0) {
    await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, containerTypeIds));
  }
  if (expenseTypeIds.length > 0) {
    await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, expenseTypeIds));
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
  } finally {
    await client.end();
  }
});

async function createTripFixture(
  status: 'CREATED' | 'COMPLETED' | 'LOCKED',
  revenue: number,
  dates: { departureDate?: string; completedAt?: Date } = {},
) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [customer] = await db.insert(s.customers)
    .values({ name: `Q22 customer ${suffix}` })
    .returning();
  const [route] = await db.insert(s.routes)
    .values({ name: `Q22 route ${suffix}` })
    .returning();
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `Q22 cargo ${suffix}` })
    .returning();
  customerIds.push(customer.id);
  routeIds.push(route.id);
  cargoTypeIds.push(cargoType.id);

  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `Q22-SHP-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'DRAFT',
    cargoMode: 'LCL',
    createdBy: actors[0]!.id,
    updatedBy: actors[0]!.id,
  }).returning();
  shipmentIds.push(shipment.id);

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
    createdBy: actors[0]!.id,
  }).returning();
  fulfillmentIds.push(fulfillment.id);

  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q22-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    departureDate: dates.departureDate ?? '2026-07-15',
    completedAt: dates.completedAt ?? new Date('2026-07-20T10:00:00Z'),
    status,
    revenue: String(revenue),
    carrierType: 'OWN',
  }).returning();
  tripIds.push(trip.id);

  if (status !== 'CREATED') {
    const [posting] = await db.insert(s.tripFinancialPostings).values({
      tripId: trip.id,
      version: 1,
      tripVersion: trip.version,
      status: 'ACTIVE',
      reason: 'COMPLETION',
      effectiveAt: trip.completedAt ?? new Date('2026-07-20T10:00:00.000Z'),
    }).returning({ id: s.tripFinancialPostings.id });
    tripFinancialPostingIds.push(posting.id);
  }

  if (status !== 'CREATED') {
    const [submission] = await db.insert(s.tripPodSubmissions).values({
      tripId: trip.id,
      fulfillmentId: fulfillment.id,
      submissionVersion: 1,
      sourceTripVersion: trip.version,
      status: 'ACCEPTED',
      submittedBy: actors[0]!.id,
      submittedAt: new Date('2026-07-20T11:00:00.000Z'),
      reviewedBy: actors[1]!.id,
      reviewedAt: new Date('2026-07-20T12:00:00.000Z'),
      rejectionReason: null,
    }).returning({ id: s.tripPodSubmissions.id });
    podSubmissionIds.push(submission.id);
  }

  return { customer, trip };
}

async function createShipmentFixture(customerId: number, options: {
  containerNumber?: string;
  sealNumber?: string;
  containerTypeId?: number | null;
} = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `Q22-SHP-${suffix}`.slice(0, 50),
    customerId,
    status: 'DRAFT',
    createdBy: actors[0]!.id,
    updatedBy: actors[0]!.id,
  }).returning();
  shipmentIds.push(shipment.id);

  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: options.containerTypeId ?? null,
    containerNumber: options.containerNumber ?? `Q22CONT${suffix.slice(-6)}`.slice(0, 50),
    sealNumber: options.sealNumber ?? `Q22SEAL${suffix.slice(-6)}`.slice(0, 50),
    cargoWeightKg: '12345.67',
    createdBy: actors[0]!.id,
  }).returning();
  shipmentContainerIds.push(container.id);

  return { shipment, container };
}

async function createShipmentTripAuthorityFixture() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [customer] = await db.insert(s.customers)
    .values({ name: `Q22 shipment authority customer ${suffix}` })
    .returning();
  const [route] = await db.insert(s.routes)
    .values({ name: `Q22 shipment authority route ${suffix}` })
    .returning();
  const [primaryCargo] = await db.insert(s.cargoTypes)
    .values({ name: `Q22 shipment authority cargo ${suffix}` })
    .returning();
  const [secondaryCargo] = await db.insert(s.cargoTypes)
    .values({ name: `Q22 shipment authority cargo alt ${suffix}` })
    .returning();
  const [containerType] = await db.insert(s.containerTypes)
    .values({
      code: `Q22${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: `Q22 authority ct ${suffix}`.slice(0, 50),
    })
    .returning();
  customerIds.push(customer.id);
  routeIds.push(route.id);
  cargoTypeIds.push(primaryCargo.id, secondaryCargo.id);
  containerTypeIds.push(containerType.id);

  const shipment = await createShipment({
    customerId: customer.id,
    cargoTypeId: primaryCargo.id,
    createdBy: actors[0]!.id,
  });
  shipmentIds.push(shipment.id);

  const trip = await createTrip({
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: primaryCargo.id,
    containerTypeId: containerType.id,
    departureDate: '2026-07-29',
    shipmentId: shipment.id,
    createdBy: actors[0]!.id,
    createdByRole: Role.ADMIN,
  });
  tripIds.push(trip.id);

  return { shipment, trip, primaryCargo, secondaryCargo };
}

async function createDraftDebitNote(
  customerId: number,
  userId: number,
  rangeFrom = '2026-07-01',
  rangeTo = '2026-07-31',
) {
  const draft = await generateDraft({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customerId,
    rangeFrom,
    rangeTo,
  });
  const input: SaveBillingDocumentInput = {
    ...draft,
    lines: draft.lines.map((line) => ({
      ...line,
      renderData: line.renderData ? { ...line.renderData } as Record<string, unknown> : null,
    })),
  };
  const document = await saveDocument(input, userId);
  documentIds.push(document.id!);
  receiptIds.push(`GBN:${document.id}`);
  return document;
}

function requireTripLine(document: Awaited<ReturnType<typeof getDocument>>) {
  const line = document.lines.find((candidate) => candidate.sourceType === 'TRIP');
  assert.ok(line, 'expected a trip source line');
  return line;
}

async function approveDebitNoteAdjustment(documentId: number) {
  const action = await requestBillingDocumentAdjustment({
    documentId,
    reason: 'Điều chỉnh nguồn sau phát hành',
    makerId: actors[0]!.id,
    makerRole: Role.ACCOUNTANT,
  });
  governanceActionIds.push(action.id);
  receiptIds.push(`GBN-ADJ:${action.id}`);
  const checked = await checkGovernanceAction({
    actionId: action.id,
    checkerId: actors[1]!.id,
    checkerRole: Role.MANAGER,
    expectedVersion: action.version,
  });
  return approveGovernanceAction({
    actionId: action.id,
    approverId: actors[2]!.id,
    approverRole: Role.ADMIN,
    expectedVersion: checked.version,
  });
}

async function assertReceivableConsumers(args: {
  customerId: number;
  customerName: string;
  representativeTripId: number;
  documentId: number;
  expectedOutstanding: number;
  expectedDocumentTotal: number;
}) {
  const tripStatus = await getTripArStatus(args.representativeTripId, 30);
  assert.equal(tripStatus.documentType, 'BILLING_DOCUMENT');
  assert.equal(tripStatus.documentId, args.documentId);
  assert.equal(tripStatus.totalDebit, args.expectedDocumentTotal);
  assert.equal(tripStatus.outstanding, args.expectedOutstanding);

  const customerSummary = await getCustomerArSummary(args.customerId);
  assert.equal(customerSummary.outstanding, args.expectedOutstanding);

  const agingSearch = await getCustomerAgingList({ search: args.customerName });
  const agingRow = agingSearch.customers.find((customer) => customer.customerId === args.customerId);
  assert.ok(agingRow);
  assert.equal(agingRow!.totalOutstanding, args.expectedOutstanding);

  const statement = await getStatementData(args.customerId);
  assert.ok(statement);
  assert.equal(statement!.totalOutstanding, args.expectedOutstanding);
  const unpaid = statement!.unpaidTrips.find((item) => item.tripId === args.representativeTripId);
  assert.ok(unpaid);
  assert.equal(unpaid!.outstanding, args.expectedOutstanding);
  assert.match(unpaid!.note, /Giấy báo nợ/);

  const overdueAmount = await getCustomerOverdueAmount(args.customerId);
  assert.equal(overdueAmount, args.expectedOutstanding);

  const paymentTermRow = (await getPaymentTermEvalReport())
    .find((row) => row.customerId === args.customerId);
  assert.ok(paymentTermRow);
  assert.equal(Number(paymentTermRow!.totalOutstanding), args.expectedOutstanding);

  const summaryBefore = await getReceivablesSummary();
  assert.ok(summaryBefore.totalOutstanding >= args.expectedOutstanding);
}

describe('Q22 source authority propagation', () => {
  test('versions shipment container provenance into immutable trip snapshots', async () => {
    const { customer, trip } = await createTripFixture('CREATED', 0, {
      departureDate: '2026-07-15',
      completedAt: undefined,
    });
    const { shipment, container } = await createShipmentFixture(customer.id);

    const firstSnapshot = await snapshotContainersIntoTrip(shipment.id, trip.id, actors[0]!.id);
    assert.deepEqual(firstSnapshot, { copied: 1, skipped: false });

    const [firstTripContainer] = await db.select()
      .from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, trip.id));
    assert.ok(firstTripContainer);
    tripContainerIds.push(firstTripContainer.id);
    assert.equal(firstTripContainer.sourceShipmentId, shipment.id);
    assert.equal(firstTripContainer.sourceShipmentContainerId, container.id);
    assert.equal(firstTripContainer.sourceShipmentVersion, shipment.version);

    const replaySnapshot = await snapshotContainersIntoTrip(shipment.id, trip.id, actors[0]!.id);
    assert.deepEqual(replaySnapshot, { copied: 0, skipped: true });

    await db.update(s.shipments).set({
      version: shipment.version + 1,
      updatedAt: new Date(Date.now() + 1_000),
      updatedBy: actors[1]!.id,
    }).where(eq(s.shipments.id, shipment.id));

    const [nextTrip] = await db.insert(s.trips).values({
      tripCode: `Q22-SNAP-${Date.now()}`.slice(0, 50),
      customerId: customer.id,
      routeId: trip.routeId,
      cargoTypeId: trip.cargoTypeId,
      departureDate: '2026-07-16',
      status: 'CREATED',
      revenue: '0',
      carrierType: 'OWN',
    }).returning();
    tripIds.push(nextTrip.id);

    const secondSnapshot = await snapshotContainersIntoTrip(shipment.id, nextTrip.id, actors[0]!.id);
    assert.deepEqual(secondSnapshot, { copied: 1, skipped: false });

    const [versionedTripContainer] = await db.select()
      .from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, nextTrip.id));
    assert.ok(versionedTripContainer);
    tripContainerIds.push(versionedTripContainer.id);
    assert.equal(versionedTripContainer.sourceShipmentId, shipment.id);
    assert.equal(versionedTripContainer.sourceShipmentContainerId, container.id);
    assert.equal(versionedTripContainer.sourceShipmentVersion, shipment.version + 1);

    const [unchangedFirstTripContainer] = await db.select()
      .from(s.tripContainers)
      .where(eq(s.tripContainers.id, firstTripContainer.id))
      .limit(1);
    assert.equal(unchangedFirstTripContainer?.sourceShipmentVersion, shipment.version);
  });

  test('recomputes linked draft-trip cargo from shipment authority before dispatch', async () => {
    const { shipment, trip, secondaryCargo } = await createShipmentTripAuthorityFixture();

    const updated = await updateShipment(shipment.id, {
      expectedVersion: shipment.version,
      cargoTypeId: secondaryCargo.id,
      updatedBy: actors[0]!.id,
    });
    assert.equal(updated.changeMode, 'DIRECT');
    assert.equal(updated.cargoTypeId, secondaryCargo.id);
    assert.equal(updated.version, shipment.version + 1);

    const [reloadedTrip] = await db.select()
      .from(s.trips)
      .where(eq(s.trips.id, trip.id))
      .limit(1);
    assert.ok(reloadedTrip);
    assert.equal(reloadedTrip.cargoTypeId, secondaryCargo.id);
    assert.equal(reloadedTrip.sourceShipmentVersion, updated.version);
    assert.equal(reloadedTrip.version, trip.version + 1);
  });

  test('routes post-dispatch cargo changes through a request without overwriting the linked trip', async () => {
    const { shipment, trip, primaryCargo, secondaryCargo } = await createShipmentTripAuthorityFixture();
    const dispatched = await transitionShipmentStatus(
      shipment.id,
      'IN_PROGRESS',
      { changedBy: actors[0]!.id },
    );

    const requested = await updateShipment(shipment.id, {
      expectedVersion: dispatched.version,
      cargoTypeId: secondaryCargo.id,
      updatedBy: actors[0]!.id,
    });
    assert.equal(requested.changeMode, 'REQUESTED');
    assert.equal(requested.cargoTypeId, primaryCargo.id);

    const [request] = await db.select()
      .from(s.shipmentChangeRequests)
      .where(eq(s.shipmentChangeRequests.shipmentId, shipment.id))
      .limit(1);
    assert.ok(request);
    assert.equal(
      (request.afterSnapshot as Record<string, unknown>).cargoTypeId,
      secondaryCargo.id,
    );

    const [beforeReviewShipment] = await db.select()
      .from(s.shipments)
      .where(eq(s.shipments.id, shipment.id))
      .limit(1);
    const [beforeReviewTrip] = await db.select()
      .from(s.trips)
      .where(eq(s.trips.id, trip.id))
      .limit(1);
    assert.equal(beforeReviewShipment?.cargoTypeId, primaryCargo.id);
    assert.equal(beforeReviewTrip?.cargoTypeId, primaryCargo.id);
    assert.equal(beforeReviewTrip?.sourceShipmentVersion, shipment.version);

    const approver: AuthUser = {
      userId: actors[2]!.id,
      username: 'q22-approver',
      email: null,
      fullName: null,
      role: Role.ADMIN,
      customerId: null,
      customerIds: [],
    };
    const review = await reviewShipmentChangeRequest(
      shipment.id,
      request.id,
      'APPLIED',
      approver,
    );
    assert.equal(review.resolution, 'APPLIED');

    const [afterReviewShipment] = await db.select()
      .from(s.shipments)
      .where(eq(s.shipments.id, shipment.id))
      .limit(1);
    const [afterReviewTrip] = await db.select()
      .from(s.trips)
      .where(eq(s.trips.id, trip.id))
      .limit(1);
    assert.equal(afterReviewShipment?.cargoTypeId, secondaryCargo.id);
    assert.equal(afterReviewTrip?.cargoTypeId, primaryCargo.id);
    assert.equal(afterReviewTrip?.sourceShipmentVersion, shipment.version);
  });

  test('uses completion date for freight and expense date for service-fee periods', async () => {
    const { customer, trip } = await createTripFixture('LOCKED', 1_000_000, {
      departureDate: '2026-07-31',
      completedAt: new Date('2026-08-02T09:00:00Z'),
    });
    const [expenseType] = await db.insert(s.forwarderExpenseTypes).values({
      code: `Q22-EVT-${trip.id}`,
      name: `Q22 event fee ${trip.id}`,
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
      expenseDate: '2026-07-31',
      payeeName: 'Q22 payee',
      note: 'Q22 cross-period event',
      noInvoiceEvidenceTypes: ['RECEIPT'],
      approvalStatus: 'APPROVED',
      createdBy: actors[0]!.id,
    }).returning();
    expenseIds.push(expense.id);

    const julyDocument = await createDraftDebitNote(
      customer.id,
      actors[0]!.id,
      '2026-07-01',
      '2026-07-31',
    );
    const augustDocument = await createDraftDebitNote(
      customer.id,
      actors[0]!.id,
      '2026-08-01',
      '2026-08-31',
    );

    const julyBefore = await getDocument(julyDocument.id!);
    const augustBefore = await getDocument(augustDocument.id!);
    assert.equal(
      julyBefore.lines.some((line) => line.sourceType === 'TRIP' && line.sourceId === trip.id),
      false,
      'departure date must not place freight in July',
    );
    assert.equal(
      julyBefore.lines.some((line) => line.sourceType === 'EXPENSE' && line.sourceId === expense.id),
      true,
      'actual expense date places service fee in July',
    );
    assert.equal(
      augustBefore.lines.some((line) => line.sourceType === 'TRIP' && line.sourceId === trip.id),
      true,
      'completion date places freight in August',
    );
    assert.equal(
      augustBefore.lines.some((line) => line.sourceType === 'EXPENSE' && line.sourceId === expense.id),
      false,
      'expense must not inherit the trip completion period',
    );

    await db.transaction(async (tx) => {
      await tx.update(s.trips).set({
        revenue: '1250000',
        version: trip.version + 1,
        updatedAt: new Date(Date.now() + 1_000),
      }).where(eq(s.trips.id, trip.id));
      await propagateTripFinancialSourceChange(tx, { tripId: trip.id });
      await tx.update(s.tripExpenses).set({
        sellAmount: '275000',
        serviceFeeAmount: '175000',
        updatedAt: new Date(Date.now() + 2_000),
      }).where(eq(s.tripExpenses.id, expense.id));
      await propagateExpenseApproval(tx, { expenseId: expense.id });
    });

    const julyAfter = await getDocument(julyDocument.id!);
    const augustAfter = await getDocument(augustDocument.id!);
    assert.equal(
      julyAfter.lines.find((line) => line.sourceType === 'EXPENSE' && line.sourceId === expense.id)?.baseAmount,
      275_000,
    );
    assert.equal(
      augustAfter.lines.find((line) => line.sourceType === 'TRIP' && line.sourceId === trip.id)?.baseAmount,
      1_250_000,
    );
    assert.equal(julyAfter.lines.some((line) => line.sourceType === 'TRIP'), false);
    assert.equal(augustAfter.lines.some((line) => line.sourceType === 'EXPENSE'), false);
  });

  test('recomputes draft debit-note lines from the latest trip source', async () => {
    const { customer, trip } = await createTripFixture('LOCKED', 1_000_000);
    const document = await createDraftDebitNote(customer.id, actors[0]!.id);
    const before = await getDocument(document.id!);
    const beforeLine = requireTripLine(before);
    assert.equal(beforeLine.baseAmount, 1_000_000);
    assert.equal(before.authorityState, 'CURRENT');
    assert.equal(beforeLine.provenance?.status, 'CURRENT');

    await db.transaction(async (tx) => {
      await tx.update(s.trips).set({
        revenue: '1250000',
        version: trip.version + 1,
        updatedAt: new Date(Date.now() + 1_000),
      }).where(eq(s.trips.id, trip.id));
      await propagateTripFinancialSourceChange(tx, { tripId: trip.id });
    });

    const after = await getDocument(document.id!);
    const afterLine = requireTripLine(after);
    assert.equal(after.debitNoteStatus, 'DRAFT');
    assert.equal(afterLine.baseAmount, 1_250_000);
    assert.equal(after.totalInclVat, 1_250_000);
    assert.equal(after.ledgerAdjustmentAmount, 0);
    assert.equal(after.authorityState, 'CURRENT');
    assert.equal(afterLine.provenance?.status, 'CURRENT');
    assert.notEqual(afterLine.renderData?.sourceVersion, beforeLine.renderData?.sourceVersion);
  });

  test('treats only approved expenses as authoritative for debit-note and disbursement reads', async () => {
    const { customer, trip } = await createTripFixture('LOCKED', 1_000_000);
    const [expenseType] = await db.insert(s.forwarderExpenseTypes).values({
      code: `Q22-AUTH-${trip.id}`,
      name: `Q22 authority fee ${trip.id}`,
      requiresInvoice: false,
      substituteEvidenceAllowed: true,
    }).returning();
    expenseTypeIds.push(expenseType.id);

    const [pendingExpense] = await db.insert(s.tripExpenses).values({
      tripId: trip.id,
      expenseType: expenseType.code,
      buyAmount: '100000',
      sellAmount: '150000',
      expenseDate: '2026-07-18',
      payeeName: 'Q22 pending payee',
      note: 'Q22 pending expense',
      noInvoiceEvidenceTypes: ['RECEIPT'],
      approvalStatus: 'PENDING',
      createdBy: actors[0]!.id,
    }).returning();
    const [rejectedExpense] = await db.insert(s.tripExpenses).values({
      tripId: trip.id,
      expenseType: expenseType.code,
      buyAmount: '120000',
      sellAmount: '175000',
      expenseDate: '2026-07-19',
      payeeName: 'Q22 rejected payee',
      note: 'Q22 rejected expense',
      noInvoiceEvidenceTypes: ['RECEIPT'],
      approvalStatus: 'REJECTED',
      createdBy: actors[0]!.id,
    }).returning();
    expenseIds.push(pendingExpense.id, rejectedExpense.id);

    const beforeAssembly = await assembleDisbursementsForPeriod(customer.id, '2026-07-01', '2026-07-31');
    assert.deepEqual(beforeAssembly.approved.map((row) => row.id), []);
    assert.deepEqual(
      beforeAssembly.pending.map((row) => row.id).sort((left, right) => left - right),
      [pendingExpense.id, rejectedExpense.id].sort((left, right) => left - right),
    );

    const draftDocument = await createDraftDebitNote(customer.id, actors[0]!.id);
    const beforeDocument = await getDocument(draftDocument.id!);
    assert.equal(
      beforeDocument.lines.some((line) => line.sourceType === 'EXPENSE' && line.sourceId === pendingExpense.id),
      false,
    );
    assert.equal(
      beforeDocument.lines.some((line) => line.sourceType === 'EXPENSE' && line.sourceId === rejectedExpense.id),
      false,
    );

    await db.transaction(async (tx) => {
      await tx.update(s.tripExpenses).set({
        approvalStatus: 'APPROVED',
        sellAmount: '190000',
        version: 2,
        updatedAt: new Date(Date.now() + 2_000),
      }).where(eq(s.tripExpenses.id, pendingExpense.id));
      await propagateExpenseApproval(tx, { expenseId: pendingExpense.id });
    });

    const afterAssembly = await assembleDisbursementsForPeriod(customer.id, '2026-07-01', '2026-07-31');
    assert.deepEqual(afterAssembly.approved.map((row) => row.id), [pendingExpense.id]);
    assert.deepEqual(afterAssembly.pending.map((row) => row.id), [rejectedExpense.id]);

    const afterDocument = await getDocument(draftDocument.id!);
    const approvedLine = afterDocument.lines.find(
      (line) => line.sourceType === 'EXPENSE' && line.sourceId === pendingExpense.id,
    );
    assert.ok(approvedLine);
    assert.equal(approvedLine.baseAmount, 190_000);
    assert.equal(
      afterDocument.lines.some((line) => line.sourceType === 'EXPENSE' && line.sourceId === rejectedExpense.id),
      false,
    );
  });

  test('keeps issued debit notes immutable and routes source drift through governance adjustments', async () => {
    const { customer, trip } = await createTripFixture('LOCKED', 1_000_000);
    const document = await createDraftDebitNote(customer.id, actors[0]!.id);
    await transitionDebitNoteStatus({
      documentId: document.id!,
      targetStatus: 'SENT',
      actorUserId: actors[0]!.id,
    });

    await db.transaction(async (tx) => {
      await tx.update(s.trips).set({
        revenue: '1400000',
        version: trip.version + 1,
        updatedAt: new Date(Date.now() + 2_000),
      }).where(eq(s.trips.id, trip.id));
      await propagateTripFinancialSourceChange(tx, { tripId: trip.id });
    });

    const staleDocument = await getDocument(document.id!);
    const staleLine = requireTripLine(staleDocument);
    const [persistedDocumentWarning] = await db.select({
      authorityWarningReason: s.billingDocuments.authorityWarningReason,
    }).from(s.billingDocuments).where(eq(s.billingDocuments.id, document.id!)).limit(1);
    assert.equal(staleDocument.debitNoteStatus, 'SENT');
    assert.equal(staleDocument.authorityState, 'ADJUSTMENT_REQUIRED');
    assert.match(
      persistedDocumentWarning?.authorityWarningReason ?? '',
      /Nguồn chuyến đã thay đổi sau khi phát hành giấy báo nợ/i,
    );
    assert.equal(staleLine.baseAmount, 1_000_000);
    assert.equal(staleLine.provenance?.status, 'CURRENT');

    const warningNotifications = await db.select({
      id: s.notifications.id,
      title: s.notifications.title,
      message: s.notifications.message,
    }).from(s.notifications).where(and(
      eq(s.notifications.relatedEntityType, 'billing_documents'),
      eq(s.notifications.relatedEntityId, document.id!),
    ));
    notificationIds.push(...warningNotifications.map((row) => row.id));
    assert.ok(warningNotifications.length > 0);
    assert.ok(
      warningNotifications.every((row) => /Giấy báo nợ cần điều chỉnh theo nguồn/i.test(row.title)),
    );

    const action = await requestBillingDocumentAdjustment({
      documentId: document.id!,
      reason: 'Điều chỉnh theo nguồn chuyến đã đổi',
      makerId: actors[0]!.id,
      makerRole: Role.ACCOUNTANT,
    });
    governanceActionIds.push(action.id);
    receiptIds.push(`GBN-ADJ:${action.id}`);
    assert.equal(action.subjectType, 'BILLING_DOCUMENT');
    assert.equal(action.status, 'PENDING_CHECK');

    const checked = await checkGovernanceAction({
      actionId: action.id,
      checkerId: actors[1]!.id,
      checkerRole: Role.MANAGER,
      expectedVersion: action.version,
    });
    const approved = await approveGovernanceAction({
      actionId: action.id,
      approverId: actors[2]!.id,
      approverRole: Role.ADMIN,
      expectedVersion: checked.version,
    });
    assert.equal(approved.status, 'APPROVED');
    assert.deepEqual(approved.applicationResult, {
      originalDocumentId: document.id!,
      adjustmentAmount: 400_000,
      resultingTotalInclVat: 1_400_000,
      sourceDiffCount: 1,
    });

    const [ledgerEntry] = await db.select({
      id: s.ledger.id,
      debit: s.ledger.debit,
      credit: s.ledger.credit,
    }).from(s.ledger).where(and(
      eq(s.ledger.txnType, 'ADJUSTMENT'),
      eq(s.ledger.txnId, document.id!),
      eq(s.ledger.receiptId, `GBN-ADJ:${action.id}`),
    )).limit(1);
    assert.ok(ledgerEntry);
    assert.equal(ledgerEntry.debit, '400000');
    assert.equal(ledgerEntry.credit, '0');

    const correctedDocument = await getDocument(document.id!);
    const correctedLine = requireTripLine(correctedDocument);
    assert.equal(correctedLine.baseAmount, 1_000_000);
    assert.equal(correctedDocument.corrections?.[0]?.actionId, action.id);
    assert.equal(correctedDocument.corrections?.[0]?.status, 'APPROVED');
  });

  test('routes trip-targeted receipts onto the issued debit note authority', async () => {
    const { customer, trip } = await createTripFixture('LOCKED', 1_000_000);
    const document = await createDraftDebitNote(customer.id, actors[0]!.id);
    await transitionDebitNoteStatus({
      documentId: document.id!,
      targetStatus: 'SENT',
      actorUserId: actors[0]!.id,
    });

    const receiptId = `Q22-RCPT-${document.id}-${Date.now()}`.slice(0, 100);
    const receipt = await recordPaymentReceipt({
      customerId: customer.id,
      receiptId,
      payments: [{ tripId: trip.id, amount: 400_000 }],
      allocatedBy: actors[0]!.id,
    });
    paymentReceiptIds.push(receipt.id);
    receiptIds.push(receipt.receiptId);

    const allocations = await listAllocationsForReceipt(receipt.receiptId);
    paymentAllocationIds.push(...allocations.map((row) => row.id));
    assert.equal(allocations.length, 1);
    assert.equal(allocations[0]!.sourceTripId, trip.id);
    assert.equal(allocations[0]!.targetType, 'BILLING_DOCUMENT');
    assert.equal(allocations[0]!.targetId, document.id!);
    assert.equal(allocations[0]!.billingDocumentId, document.id!);
    assert.equal(Number(allocations[0]!.amount), 400_000);

    const report = await assembleDisbursementsForPeriod(customer.id, '2026-07-01', '2026-07-31');
    assert.ok(Array.isArray(report.approved));

    const refreshedDocument = await getDocument(document.id!);
    assert.equal(refreshedDocument.authorityState, 'CURRENT');

    const [persistedReceipt] = await db.select({
      allocatedTotal: s.paymentReceipts.allocatedTotal,
      unappliedAmount: s.paymentReceipts.unappliedAmount,
    }).from(s.paymentReceipts).where(eq(s.paymentReceipts.id, receipt.id)).limit(1);
    assert.equal(Number(persistedReceipt?.allocatedTotal ?? 0), 400_000);
    assert.equal(Number(persistedReceipt?.unappliedAmount ?? 0), 0);
  });

  test('waits on the shared trip authority lock before sending a debit note', async () => {
    const { customer, trip } = await createTripFixture('LOCKED', 1_000_000);
    const document = await createDraftDebitNote(customer.id, actors[0]!.id);

    let releaseAuthority!: () => void;
    let markAuthorityHeld!: () => void;
    const authorityHeld = new Promise<void>((resolve) => {
      markAuthorityHeld = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      releaseAuthority = resolve;
    });

    const blocker = db.transaction(async (tx) => {
      await lockTripFinancialAuthority(tx, [trip.id]);
      await tx.update(s.trips).set({
        status: 'LOCKED',
        revenue: '1500000',
        version: trip.version + 1,
        updatedAt: new Date(Date.now() + 3_000),
      }).where(eq(s.trips.id, trip.id));
      await propagateTripFinancialSourceChange(tx, { tripId: trip.id });
      markAuthorityHeld();
      await releasePromise;
    });
    await authorityHeld;

    let sendSettled = false;
    const sendPromise = transitionDebitNoteStatus({
      documentId: document.id!,
      targetStatus: 'SENT',
      actorUserId: actors[0]!.id,
    }).finally(() => {
      sendSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(sendSettled, false, 'send must wait for the trip authority lock holder');

    releaseAuthority();
    await blocker;
    const sent = await sendPromise;
    assert.equal(sent.debitNoteStatus, 'SENT');

    const after = await getDocument(document.id!);
    const line = requireTripLine(after);
    assert.equal(after.debitNoteStatus, 'SENT');
    assert.equal(line.baseAmount, 1_500_000);
    assert.equal(line.provenance?.status, 'CURRENT');
  });

  test('all receivable consumers stay on issued-note authority after issue and move only through approved adjustment history', async () => {
    const { customer, trip } = await createTripFixture('LOCKED', 1_000_000, {
      departureDate: '2026-05-15',
      completedAt: new Date('2026-05-20T10:00:00Z'),
    });
    const document = await createDraftDebitNote(
      customer.id,
      actors[0]!.id,
      '2026-05-01',
      '2026-05-31',
    );
    await transitionDebitNoteStatus({
      documentId: document.id!,
      targetStatus: 'SENT',
      actorUserId: actors[0]!.id,
    });

    const receiptId = `Q22-AUTH-${document.id}-${Date.now()}`.slice(0, 100);
    const receipt = await recordPaymentReceipt({
      customerId: customer.id,
      receiptId,
      payments: [{ tripId: trip.id, amount: 400_000 }],
      allocatedBy: actors[0]!.id,
    });
    paymentReceiptIds.push(receipt.id);
    receiptIds.push(receipt.receiptId);
    const allocations = await listAllocationsForReceipt(receipt.receiptId);
    paymentAllocationIds.push(...allocations.map((row) => row.id));

    await db.update(s.trips).set({
      revenue: '1400000',
      version: trip.version + 1,
      updatedAt: new Date(Date.now() + 5_000),
    }).where(eq(s.trips.id, trip.id));
    await db.transaction(async (tx) => {
      await propagateTripFinancialSourceChange(tx, { tripId: trip.id });
    });

    await assertReceivableConsumers({
      customerId: customer.id,
      customerName: customer.name,
      representativeTripId: trip.id,
      documentId: document.id!,
      expectedOutstanding: 600_000,
      expectedDocumentTotal: 1_000_000,
    });

    const approved = await approveDebitNoteAdjustment(document.id!);
    assert.equal(approved.status, 'APPROVED');

    await assertReceivableConsumers({
      customerId: customer.id,
      customerName: customer.name,
      representativeTripId: trip.id,
      documentId: document.id!,
      expectedOutstanding: 1_000_000,
      expectedDocumentTotal: 1_400_000,
    });
  });

  test('post-issue allocation and refund races leave one winner and immutable receipt-allocation history', async () => {
    const { customer, trip } = await createTripFixture('LOCKED', 1_000_000);
    const document = await createDraftDebitNote(customer.id, actors[0]!.id);
    await transitionDebitNoteStatus({
      documentId: document.id!,
      targetStatus: 'SENT',
      actorUserId: actors[0]!.id,
    });

    const firstAttempts = await Promise.allSettled([
      recordPaymentReceipt({
        customerId: customer.id,
        receiptId: `Q22-RACE-A-${Date.now()}`.slice(0, 100),
        payments: [{ tripId: trip.id, amount: 700_000 }],
        allocatedBy: actors[0]!.id,
      }),
      recordPaymentReceipt({
        customerId: customer.id,
        receiptId: `Q22-RACE-B-${Date.now()}`.slice(0, 100),
        payments: [{ tripId: trip.id, amount: 700_000 }],
        allocatedBy: actors[0]!.id,
      }),
    ]);

    const fulfilledReceipts = firstAttempts
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof recordPaymentReceipt>>> => result.status === 'fulfilled')
      .map((result) => result.value);
    const rejectedReceipts = firstAttempts
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.equal(fulfilledReceipts.length, 1);
    assert.equal(rejectedReceipts.length, 1);
    assert.match(String(rejectedReceipts[0]!.reason), /vượt quá số dư còn lại/i);

    const winningReceipt = fulfilledReceipts[0]!;
    paymentReceiptIds.push(winningReceipt.id);
    receiptIds.push(winningReceipt.receiptId);
    const winningAllocations = await listAllocationsForReceipt(winningReceipt.receiptId);
    paymentAllocationIds.push(...winningAllocations.map((row) => row.id));
    assert.equal(winningAllocations.length, 1);
    assert.equal(Number(winningAllocations[0]!.amount), 700_000);

    const topUpReceipt = await recordPaymentReceipt({
      customerId: customer.id,
      receiptId: `Q22-TOPUP-${Date.now()}`.slice(0, 100),
      amount: 500_000,
      payments: [{ tripId: trip.id, amount: 300_000 }],
      allocatedBy: actors[0]!.id,
    });
    paymentReceiptIds.push(topUpReceipt.id);
    receiptIds.push(topUpReceipt.receiptId);
    const topUpAllocations = await listAllocationsForReceipt(topUpReceipt.receiptId);
    paymentAllocationIds.push(...topUpAllocations.map((row) => row.id));
    assert.equal(topUpAllocations.length, 1);
    assert.equal(Number(topUpAllocations[0]!.amount), 300_000);

    const [persistedTopUp] = await db.select({
      unappliedAmount: s.paymentReceipts.unappliedAmount,
    }).from(s.paymentReceipts).where(eq(s.paymentReceipts.id, topUpReceipt.id)).limit(1);
    assert.equal(Number(persistedTopUp?.unappliedAmount ?? 0), 200_000);

    const refundOne = await requestPaymentRefundGovernance({
      paymentReceiptId: topUpReceipt.id,
      amount: 200_000,
      reason: 'Hoàn tiền phần chưa phân bổ',
      makerId: actors[0]!.id,
      makerRole: Role.ACCOUNTANT,
    });
    governanceActionIds.push(refundOne.id);
    await assert.rejects(
      () => requestPaymentRefundGovernance({
        paymentReceiptId: topUpReceipt.id,
        amount: 200_000,
        reason: 'Thử hoàn trùng',
        makerId: actors[0]!.id,
        makerRole: Role.ACCOUNTANT,
      }),
      (error) => {
        const text = [
          String(error),
          String((error as { message?: string }).message ?? ''),
          String((error as { cause?: { message?: string } }).cause?.message ?? ''),
        ].join('\n');
        return /duplicate key|already exists|đã tồn tại/i.test(text);
      },
    );

    const refundOneChecked = await checkGovernanceAction({
      actionId: refundOne.id,
      checkerId: actors[1]!.id,
      checkerRole: Role.MANAGER,
      expectedVersion: refundOne.version,
    });

    await approveDirectMoneyGovernanceAction({
      actionId: refundOne.id,
      approverId: actors[2]!.id,
      approverRole: Role.ADMIN,
      expectedVersion: refundOneChecked.version,
    });

    const [refundedReceipt] = await db.select({
      unappliedAmount: s.paymentReceipts.unappliedAmount,
      refundedAmount: s.paymentReceipts.refundedAmount,
    }).from(s.paymentReceipts).where(eq(s.paymentReceipts.id, topUpReceipt.id)).limit(1);
    assert.equal(Number(refundedReceipt?.unappliedAmount ?? 0), 0);
    assert.equal(Number(refundedReceipt?.refundedAmount ?? 0), 200_000);

    const [refundCount] = await db.select({
      total: sql<number>`count(*)::int`,
    }).from(s.paymentRefunds).where(eq(s.paymentRefunds.paymentReceiptId, topUpReceipt.id));
    assert.equal(Number(refundCount?.total ?? 0), 1);

    const status = await getTripArStatus(trip.id, 30);
    assert.equal(status.documentType, 'BILLING_DOCUMENT');
    assert.equal(status.outstanding, 0);
    const statement = await getStatementData(customer.id);
    assert.ok(statement);
    assert.equal(statement!.totalOutstanding, 0);
    const paymentTermRow = (await getPaymentTermEvalReport()).find((row) => row.customerId === customer.id);
    assert.ok(paymentTermRow);
    assert.equal(Number(paymentTermRow!.totalOutstanding), 0);
  });
});
