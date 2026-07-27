import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import {
  generateDraft,
  getDocument,
  saveDocument,
} from '../services/billingDocument.service';
import {
  approveGovernanceAction,
  checkGovernanceAction,
} from '../services/adjustment-governance.service';
import { requestBillingDocumentAdjustment } from '../services/billing-document-governance.service';
import { transitionDebitNoteStatus } from '../services/debit-note-lifecycle.service';
import { propagateTripFinancialSourceChange } from '../services/source-change.service';
import { lockTripFinancialAuthority } from '../services/trip-financial-authority-lock.service';

const actorIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const tripIds: number[] = [];
const documentIds: number[] = [];
const governanceActionIds: number[] = [];
const receiptIds: string[] = [];

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
  if (receiptIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.receiptId, receiptIds));
  }
  if (governanceActionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, governanceActionIds));
  }
  if (documentIds.length > 0) {
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, documentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
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
  await client.end();
});

async function createTripFixture(status: 'COMPLETED' | 'LOCKED', revenue: number) {
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

  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q22-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    departureDate: '2026-07-15',
    status,
    revenue: String(revenue),
    carrierType: 'OWN',
  }).returning();
  tripIds.push(trip.id);
  return { customer, trip };
}

async function createDraftDebitNote(customerId: number, userId: number) {
  const draft = await generateDraft({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customerId,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
  });
  const document = await saveDocument(draft, userId);
  documentIds.push(document.id!);
  receiptIds.push(`GBN:${document.id}`);
  return document;
}

function requireTripLine(document: Awaited<ReturnType<typeof getDocument>>) {
  const line = document.lines.find((candidate) => candidate.sourceType === 'TRIP');
  assert.ok(line, 'expected a trip source line');
  return line;
}

describe('Q22 source authority propagation', () => {
  test('recomputes draft debit-note lines from the latest trip source', async () => {
    const { customer, trip } = await createTripFixture('COMPLETED', 1_000_000);
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
    assert.equal(after.ledgerAdjustmentAmount, 1_250_000);
    assert.equal(after.authorityState, 'CURRENT');
    assert.equal(afterLine.provenance?.status, 'CURRENT');
    assert.notEqual(afterLine.renderData?.sourceVersion, beforeLine.renderData?.sourceVersion);
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
    assert.equal(staleDocument.debitNoteStatus, 'SENT');
    assert.equal(staleDocument.authorityState, 'ADJUSTMENT_REQUIRED');
    assert.equal(staleLine.baseAmount, 1_000_000);
    assert.equal(staleLine.provenance?.status, 'STALE');

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

  test('waits on the shared trip authority lock before sending a debit note', async () => {
    const { customer, trip } = await createTripFixture('COMPLETED', 1_000_000);
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
});
