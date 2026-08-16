import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  createAdjustmentSchema,
  FuelMode,
  tripReopenRequestSchema,
  Role,
} from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import {
  approveGovernanceAction,
  checkGovernanceAction,
  requestTripArAdjustment,
  requestTripReopen,
} from '../services/adjustment-governance.service';
import { updateTripFigures } from '../services/trip-mutations.service';
import {
  createTripExpense,
  deleteTripExpenseGuarded,
  updateTripExpense,
} from '../services/forwarder.service';
import { transitionApproval } from '../services/approval.service';
import { transitionDebitNoteStatus } from '../services/debit-note-lifecycle.service';
import {
  TRIP_FINANCIAL_AUTHORITY_LOCK_NAMESPACE,
} from '../services/trip-financial-authority-lock.service';
import { updateDocument } from '../services/billingDocument.service';

const actorIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const tripIds: number[] = [];
const expenseIds: number[] = [];
const periodLockIds: number[] = [];
const billingDocumentIds: number[] = [];

let actors: Array<{ id: number; role: string }> = [];

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  actors = await db.insert(s.users).values([
    { username: `q18-maker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT },
    { username: `q18-checker-${suffix}`, passwordHash: 'x', role: Role.MANAGER },
    { username: `q18-approver-a-${suffix}`, passwordHash: 'x', role: Role.ADMIN },
    { username: `q18-approver-b-${suffix}`, passwordHash: 'x', role: Role.MANAGER },
    { username: `q18-driver-${suffix}`, passwordHash: 'x', role: Role.DRIVER },
  ]).returning({ id: s.users.id, role: s.users.role });
  actorIds.push(...actors.map((actor) => actor.id));
});

after(async () => {
  if (tripIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.subjectId, tripIds));
    await db.delete(s.paymentAllocations).where(and(
      eq(s.paymentAllocations.targetType, 'TRIP'),
      inArray(s.paymentAllocations.targetId, tripIds),
    ));
    await db.delete(s.billingDocumentLines).where(and(
      eq(s.billingDocumentLines.sourceType, 'TRIP'),
      inArray(s.billingDocumentLines.sourceId, tripIds),
    ));
  }
  if (billingDocumentIds.length > 0) {
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, billingDocumentIds));
  }
  if (expenseIds.length > 0) {
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, expenseIds));
  }
  if (tripIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, tripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (periodLockIds.length > 0) {
    await db.delete(s.periodLocks).where(inArray(s.periodLocks.id, periodLockIds));
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

async function createTrip(status: 'COMPLETED' = 'COMPLETED') {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [customer] = await db.insert(s.customers)
    .values({ name: `Q18 customer ${suffix}` }).returning();
  const [route] = await db.insert(s.routes)
    .values({ name: `Q18 route ${suffix}` }).returning();
  const [cargo] = await db.insert(s.cargoTypes)
    .values({ name: `Q18 cargo ${suffix}` }).returning();
  customerIds.push(customer.id);
  routeIds.push(route.id);
  cargoTypeIds.push(cargo.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q18-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargo.id,
    departureDate: '2026-07-15',
    status,
    revenue: '1000000',
    carrierType: 'OWN',
  }).returning();
  tripIds.push(trip.id);
  return { trip, customer };
}

async function expectApiError(
  operation: Promise<unknown>,
  statusCode: number,
  pattern: RegExp,
) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, statusCode);
    assert.match(error.message, pattern);
    return true;
  });
}

describe('Q18 bounded adjustment governance', () => {
  it('requires the source version at both public adjustment boundaries', async () => {
    const { trip } = await createTrip('COMPLETED');
    assert.equal(createAdjustmentSchema.safeParse({
      tripId: trip.id,
      amount: 100,
      note: 'Stale adjustment',
      signedAgreementRef: 'Q18-VERSION',
    }).success, false);
    assert.equal(tripReopenRequestSchema.safeParse({
      reason: 'Missing source version',
    }).success, false);
    await expectApiError(
      requestTripArAdjustment({
        tripId: trip.id,
        amount: 100,
        reason: 'Stale adjustment',
        signedAgreementRef: 'Q18-VERSION',
        makerId: actors[0]!.id,
        makerRole: Role.ACCOUNTANT,
        expectedTripVersion: undefined as unknown as number,
      }),
      400,
      /expectedVersion/,
    );
    await expectApiError(
      requestTripReopen({
        tripId: trip.id,
        reason: 'Stale reopen',
        makerId: actors[1]!.id,
        makerRole: Role.MANAGER,
        expectedTripVersion: undefined as unknown as number,
      }),
      400,
      /expectedVersion/,
    );
    await expectApiError(
      requestTripArAdjustment({
        tripId: trip.id,
        amount: 100,
        reason: 'Stale adjustment',
        signedAgreementRef: 'Q18-STALE',
        makerId: actors[0]!.id,
        makerRole: Role.ACCOUNTANT,
        expectedTripVersion: trip.version + 1,
      }),
      409,
      /đã được thay đổi/,
    );
    await expectApiError(
      requestTripReopen({
        tripId: trip.id,
        reason: 'Stale reopen',
        makerId: actors[1]!.id,
        makerRole: Role.MANAGER,
        expectedTripVersion: trip.version + 1,
      }),
      409,
      /đã được thay đổi/,
    );
  });

  it('persists exact authority and posts only after three distinct actors', async () => {
    const { trip, customer } = await createTrip();
    const [periodLock] = await db.insert(s.periodLocks).values({
      domain: 'DEBIT_NOTE',
      scopeType: 'CUSTOMER',
      scopeId: customer.id,
      cycle: 'MONTHLY',
      periodKey: '2026-07',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      status: 'CLOSED',
      closedBy: actors[2]!.id,
    }).returning();
    periodLockIds.push(periodLock.id);

    await expectApiError(
      requestTripArAdjustment({
        tripId: trip.id,
        amount: 0,
        reason: '',
        signedAgreementRef: '',
        makerId: actors[0]!.id,
        makerRole: Role.ACCOUNTANT,
        expectedTripVersion: trip.version,
      }),
      400,
      /Lý do|khác 0/,
    );
    await expectApiError(
      requestTripArAdjustment({
        tripId: trip.id,
        amount: 100,
        reason: 'Không đủ quyền',
        signedAgreementRef: 'Q18-RBAC',
        makerId: actors[4]!.id,
        makerRole: Role.DRIVER,
        expectedTripVersion: trip.version,
      }),
      403,
      /không có quyền/,
    );

    const action = await requestTripArAdjustment({
      tripId: trip.id,
      amount: 125000,
      reason: 'Bổ sung cước theo biên bản',
      signedAgreementRef: 'Q18-AGREEMENT-01',
      makerId: actors[0]!.id,
      makerRole: Role.ACCOUNTANT,
      expectedTripVersion: trip.version,
    });
    assert.equal(action.status, 'PENDING_CHECK');
    assert.equal(action.makerRole, Role.ACCOUNTANT);
    assert.equal(action.originalPeriodLockId, periodLock.id);
    assert.deepEqual(action.beforeSnapshot, {
      tripStatus: 'COMPLETED',
      tripRevenue: '1000000',
      customerId: customer.id,
    });
    assert.deepEqual(action.deltaSnapshot, {
      customerBalanceDelta: 125000,
      signedAgreementRef: 'Q18-AGREEMENT-01',
    });
    assert.equal(
      (await db.select().from(s.ledger).where(and(
        eq(s.ledger.txnType, 'ADJUSTMENT'),
        eq(s.ledger.txnId, trip.id),
      ))).length,
      0,
    );

    await expectApiError(
      checkGovernanceAction({
        actionId: action.id,
        checkerId: actors[0]!.id,
        checkerRole: Role.ACCOUNTANT,
        expectedVersion: action.version,
      }),
      403,
      /tự kiểm tra/,
    );
    const checked = await checkGovernanceAction({
      actionId: action.id,
      checkerId: actors[1]!.id,
      checkerRole: Role.MANAGER,
      expectedVersion: action.version,
    });
    assert.equal(checked.checkerRole, Role.MANAGER);
    await expectApiError(
      approveGovernanceAction({
        actionId: action.id,
        approverId: actors[1]!.id,
        approverRole: Role.MANAGER,
        expectedVersion: checked.version,
      }),
      403,
      /phải khác/,
    );
    const approved = await approveGovernanceAction({
      actionId: action.id,
      approverId: actors[2]!.id,
      approverRole: Role.ADMIN,
      expectedVersion: checked.version,
    });
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.makerId, actors[0]!.id);
    assert.equal(approved.checkerId, actors[1]!.id);
    assert.equal(approved.approverId, actors[2]!.id);
    assert.equal(approved.approverRole, Role.ADMIN);
    assert.deepEqual(approved.applicationResult, {
      subjectType: 'TRIP',
      subjectId: trip.id,
      resultingVersion: trip.version + 1,
    });
    assert.ok(approved.ledgerEntryId);
    const [unchangedTrip] = await db.select().from(s.trips).where(eq(s.trips.id, trip.id));
    assert.equal(unchangedTrip.revenue, '1000000');
    assert.equal(unchangedTrip.status, 'COMPLETED');
    assert.equal(unchangedTrip.version, trip.version + 1);
  });

  it('allows only one concurrent adjustment against the original version', async () => {
    const { trip } = await createTrip();
    const requests = await Promise.all([
      requestTripArAdjustment({
        tripId: trip.id,
        amount: 100,
        reason: 'Điều chỉnh A',
        signedAgreementRef: 'Q18-A',
        makerId: actors[0]!.id,
        makerRole: Role.ACCOUNTANT,
        expectedTripVersion: trip.version,
      }),
      requestTripArAdjustment({
        tripId: trip.id,
        amount: 200,
        reason: 'Điều chỉnh B',
        signedAgreementRef: 'Q18-B',
        makerId: actors[0]!.id,
        makerRole: Role.ACCOUNTANT,
        expectedTripVersion: trip.version,
      }),
    ]);
    const checked = await Promise.all(requests.map((action) =>
      checkGovernanceAction({
        actionId: action.id,
        checkerId: actors[1]!.id,
        checkerRole: Role.MANAGER,
        expectedVersion: action.version,
      })));

    const outcomes = await Promise.allSettled([
      approveGovernanceAction({
        actionId: checked[0]!.id,
        approverId: actors[2]!.id,
        approverRole: Role.ADMIN,
        expectedVersion: checked[0]!.version,
      }),
      approveGovernanceAction({
        actionId: checked[1]!.id,
        approverId: actors[3]!.id,
        approverRole: Role.MANAGER,
        expectedVersion: checked[1]!.version,
      }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected');
    assert.ok(rejected.reason instanceof ApiError);
    assert.equal(rejected.reason.statusCode, 409);
    const posted = await db.select().from(s.ledger).where(and(
      eq(s.ledger.txnType, 'ADJUSTMENT'),
      eq(s.ledger.txnId, trip.id),
    ));
    assert.equal(posted.length, 1);
  });

  it('blocks direct reopen and applies exceptional reopen only after approval', async () => {
    const { trip } = await createTrip('COMPLETED');
    // O2C: COMPLETED is terminal. A direct financial mutation on a completed
    // trip is blocked (it must go through the governed correction flow), and
    // reopening must go through the governed TRIP_REOPEN workflow, which sends
    // the trip COMPLETED → IN_TRANSIT once approved.
    await expectApiError(
      updateTripFigures(trip.id, {
        legs: [],
        fuelMode: FuelMode.AUTO,
        fuelSupplementLiters: 0,
        tollsDiscount: 0,
        tollsAddition: 0,
        tollsStations: 0,
        hasReturnCargo: false,
        revenue: 9_000_000,
        expectedVersion: trip.version,
        userId: actors[1]!.id,
        userRole: Role.MANAGER,
      }),
      409,
      /chỉ được thay đổi sau khi kiểm tra và phê duyệt/,
    );
    // Direct reopen by an unauthorized role is blocked at the RBAC boundary.
    await expectApiError(
      requestTripReopen({
        tripId: trip.id,
        reason: 'Không đủ quyền',
        makerId: actors[0]!.id,
        makerRole: Role.ACCOUNTANT,
        expectedTripVersion: trip.version,
      }),
      403,
      /không có quyền/,
    );
    const action = await requestTripReopen({
      tripId: trip.id,
      reason: 'Sửa chứng từ trước khi phát hành',
      makerId: actors[1]!.id,
      makerRole: Role.MANAGER,
      expectedTripVersion: trip.version,
    });
    const checked = await checkGovernanceAction({
      actionId: action.id,
      checkerId: actors[3]!.id,
      checkerRole: Role.MANAGER,
      expectedVersion: action.version,
    });
    await approveGovernanceAction({
      actionId: action.id,
      approverId: actors[2]!.id,
      approverRole: Role.ADMIN,
      expectedVersion: checked.version,
    });
    const [reopened] = await db.select().from(s.trips).where(eq(s.trips.id, trip.id));
    assert.equal(reopened.status, 'IN_TRANSIT');
    assert.equal(reopened.version, trip.version + 1);
  });

  it('O2C C2: reopen IS allowed for completion postings (reversed); blocked on debit-note/payment', async () => {
    // O2C: a TRIP_REVENUE ledger entry from completion is now reversible —
    // reopen is ALLOWED (the governed reopen reverses it). Formerly blocked.
    const posted = await createTrip('COMPLETED');
    await db.insert(s.ledger).values({
      txnType: 'TRIP_REVENUE',
      txnId: posted.trip.id,
      entityType: 'CUSTOMER',
      entityId: posted.customer.id,
      debit: '1000000',
      credit: '0',
      balance: '1000000',
      note: 'Posted trip authority',
    });
    // This should now SUCCEED at request time (no longer blocked on ledger).
    const reopenAction = await requestTripReopen({
      tripId: posted.trip.id,
      reason: 'Reopen after completion — entries will be reversed',
      makerId: actors[1]!.id,
      makerRole: Role.MANAGER,
      expectedTripVersion: posted.trip.version,
    });
    assert.ok(reopenAction.id, 'reopen request accepted for posted-completion trip');

    // Debit-note issue still blocks (can't cleanly reverse a sent document).
    const issued = await createTrip('COMPLETED');
    const [document] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: issued.customer.id,
      entityName: 'Q18 issued customer',
      rangeFrom: '2026-07-01',
      rangeTo: '2026-07-31',
      debitNoteStatus: 'SENT',
    }).returning();
    billingDocumentIds.push(document.id);
    await db.insert(s.billingDocumentLines).values({
      documentId: document.id,
      sourceType: 'TRIP',
      sourceId: issued.trip.id,
      lineType: 'FREIGHT',
      typeLabel: 'Cước',
      description: 'Issued trip',
    });
    await expectApiError(
      requestTripReopen({
        tripId: issued.trip.id,
        reason: 'Must not reopen issued document',
        makerId: actors[1]!.id,
        makerRole: Role.MANAGER,
        expectedTripVersion: issued.trip.version,
      }),
      409,
      /đã hạch toán|đã phát hành|đã thanh toán/,
    );

    const paid = await createTrip('COMPLETED');
    await db.insert(s.paymentAllocations).values({
      receiptId: `Q18-${paid.trip.id}`,
      customerId: paid.customer.id,
      targetType: 'TRIP',
      targetId: paid.trip.id,
      amount: '1000',
      allocatedBy: actors[0]!.id,
    });
    await expectApiError(
      requestTripReopen({
        tripId: paid.trip.id,
        reason: 'Must not reopen paid trip',
        makerId: actors[1]!.id,
        makerRole: Role.MANAGER,
        expectedTripVersion: paid.trip.version,
      }),
      409,
      /đã hạch toán|đã phát hành|đã thanh toán/,
    );

    const [unchanged] = await db.select().from(s.trips)
      .where(eq(s.trips.id, posted.trip.id));
    assert.equal(unchanged.status, 'COMPLETED');
    assert.equal(unchanged.version, posted.trip.version);
  });

  it('O2C C2: reopen succeeds and reverses completion postings at approval', async () => {
    const { trip, customer } = await createTrip('COMPLETED');
    const action = await requestTripReopen({
      tripId: trip.id,
      reason: 'Pre-posting correction',
      makerId: actors[1]!.id,
      makerRole: Role.MANAGER,
      expectedTripVersion: trip.version,
    });
    const checked = await checkGovernanceAction({
      actionId: action.id,
      checkerId: actors[3]!.id,
      checkerRole: Role.MANAGER,
      expectedVersion: action.version,
    });
    await db.insert(s.ledger).values({
      txnType: 'TRIP_REVENUE',
      txnId: trip.id,
      entityType: 'CUSTOMER',
      entityId: customer.id,
      debit: '1000000',
      credit: '0',
      balance: '1000000',
      note: 'Posted after request',
    });
    // O2C C2: reopen now SUCCEEDS — the completion postings are reversed
    // inside the approval transaction (formerly blocked with "đã hạch toán").
    const approved = await approveGovernanceAction({
      actionId: action.id,
      approverId: actors[2]!.id,
      approverRole: Role.ADMIN,
      expectedVersion: checked.version,
    });
    assert.ok(approved, 'reopen approved');
    const [reopenedTrip] = await db.select().from(s.trips)
      .where(eq(s.trips.id, trip.id));
    assert.equal(reopenedTrip.status, 'IN_TRANSIT');
    assert.equal(reopenedTrip.completedAt, null);
  });

  it('serializes concurrent debit-note issue and reopen approval so exactly one wins', async () => {
    const { trip, customer } = await createTrip('COMPLETED');
    const action = await requestTripReopen({
      tripId: trip.id,
      reason: 'Concurrent issue/reopen authority',
      makerId: actors[1]!.id,
      makerRole: Role.MANAGER,
      expectedTripVersion: trip.version,
    });
    const checked = await checkGovernanceAction({
      actionId: action.id,
      checkerId: actors[3]!.id,
      checkerRole: Role.MANAGER,
      expectedVersion: action.version,
    });
    const [document] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityName: 'Q18 concurrent issue customer',
      rangeFrom: '2026-07-01',
      rangeTo: '2026-07-31',
      debitNoteStatus: 'DRAFT',
    }).returning();
    billingDocumentIds.push(document.id);
    await db.insert(s.billingDocumentLines).values({
      documentId: document.id,
      sourceType: 'TRIP',
      sourceId: trip.id,
      lineType: 'FREIGHT',
      typeLabel: 'Cước',
      description: 'Concurrent issue trip',
    });

    let releaseAuthorityLock!: () => void;
    let markAuthorityLockAcquired!: () => void;
    const authorityLockAcquired = new Promise<void>((resolve) => {
      markAuthorityLockAcquired = resolve;
    });
    const releaseAuthority = new Promise<void>((resolve) => {
      releaseAuthorityLock = resolve;
    });
    const authorityBlocker = db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          ${TRIP_FINANCIAL_AUTHORITY_LOCK_NAMESPACE},
          ${trip.id}
        )
      `);
      markAuthorityLockAcquired();
      await releaseAuthority;
    });
    await authorityLockAcquired;

    let raceSettled = false;
    const race = Promise.allSettled([
      approveGovernanceAction({
        actionId: action.id,
        approverId: actors[2]!.id,
        approverRole: Role.ADMIN,
        expectedVersion: checked.version,
      }),
      transitionDebitNoteStatus({
        documentId: document.id,
        targetStatus: 'SENT',
        actorUserId: actors[0]!.id,
      }),
    ]).finally(() => {
      raceSettled = true;
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(
      raceSettled,
      false,
      'both issue and reopen must wait for the shared trip authority lock',
    );
    releaseAuthorityLock();
    await authorityBlocker;
    const results = await race;
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);

    const [savedTrip] = await db.select().from(s.trips).where(eq(s.trips.id, trip.id));
    const [savedDocument] = await db.select().from(s.billingDocuments)
      .where(eq(s.billingDocuments.id, document.id));
    const [savedAction] = await db.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, action.id));
    const reopenWon = savedAction.status === 'APPROVED';
    assert.deepEqual(
      {
        tripStatus: savedTrip.status,
        documentStatus: savedDocument.debitNoteStatus,
        actionStatus: savedAction.status,
      },
      reopenWon
        ? {
            tripStatus: 'IN_TRANSIT',
            documentStatus: 'DRAFT',
            actionStatus: 'APPROVED',
          }
        : {
            tripStatus: 'COMPLETED',
            documentStatus: 'SENT',
            actionStatus: 'PENDING_APPROVAL',
          },
    );
  });

  it('serializes source-line replacement with issuance and never sends stale unvalidated lines', async () => {
    const { trip, customer } = await createTrip('COMPLETED');
    const [replacementTrip] = await db.insert(s.trips).values({
      tripCode: `Q18-REPLACEMENT-${Date.now()}`.slice(0, 50),
      customerId: customer.id,
      routeId: trip.routeId,
      cargoTypeId: trip.cargoTypeId,
      departureDate: trip.departureDate,
      status: 'COMPLETED',
      revenue: '1000000',
      carrierType: 'OWN',
    }).returning();
    tripIds.push(replacementTrip.id);
    const [document] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      entityName: 'Q18 line replacement customer',
      rangeFrom: '2026-08-01',
      rangeTo: '2026-08-31',
      debitNoteStatus: 'DRAFT',
      totalInclVat: '1000000',
    }).returning();
    billingDocumentIds.push(document.id);
    await db.insert(s.billingDocumentLines).values({
      documentId: document.id,
      sourceType: 'TRIP',
      sourceId: trip.id,
      lineType: 'FREIGHT',
      typeLabel: 'Cước',
      unit: 'chuyến',
      description: 'Nguồn hợp lệ trước khi phát hành',
      baseAmount: '1000000',
    });

    let releaseDocumentLock!: () => void;
    let markDocumentLockAcquired!: () => void;
    const documentLockAcquired = new Promise<void>((resolve) => {
      markDocumentLockAcquired = resolve;
    });
    const releaseDocument = new Promise<void>((resolve) => {
      releaseDocumentLock = resolve;
    });
    const documentBlocker = db.transaction(async (tx) => {
      await tx.select({ id: s.billingDocuments.id }).from(s.billingDocuments)
        .where(eq(s.billingDocuments.id, document.id))
        .for('update');
      markDocumentLockAcquired();
      await releaseDocument;
    });
    await documentLockAcquired;

    let raceSettled = false;
    const race = Promise.allSettled([
      updateDocument(document.id, {
        type: 'DEBIT_NOTE',
        entityType: 'CUSTOMER',
        entityId: customer.id,
        entityName: 'Q18 line replacement customer',
        rangeFrom: '2026-08-01',
        rangeTo: '2026-08-31',
        lines: [{
          sourceType: 'TRIP',
          sourceId: replacementTrip.id,
          lineType: 'FREIGHT',
          typeLabel: 'Cước',
          unit: 'chuyến',
          description: 'Nguồn thay thế chưa chốt',
          baseAmount: 1000000,
          amountOverride: null,
          excluded: false,
          sortOrder: 0,
        }],
      }),
      transitionDebitNoteStatus({
        documentId: document.id,
        targetStatus: 'SENT',
        actorUserId: actors[0]!.id,
      }),
    ]).finally(() => {
      raceSettled = true;
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(
      raceSettled,
      false,
      'line replacement and issuance must both wait for the document authority lock',
    );
    releaseDocumentLock();
    await documentBlocker;
    const results = await race;
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);

    const [savedDocument] = await db.select().from(s.billingDocuments)
      .where(eq(s.billingDocuments.id, document.id));
    const savedLines = await db.select().from(s.billingDocumentLines)
      .where(eq(s.billingDocumentLines.documentId, document.id));
    assert.equal(savedLines.length, 1);
    if (savedDocument.debitNoteStatus === 'SENT') {
      assert.equal(savedLines[0]!.sourceId, trip.id);
      assert.equal(trip.status, 'COMPLETED');
    } else {
      assert.equal(savedDocument.debitNoteStatus, 'DRAFT');
      assert.equal(savedLines[0]!.sourceId, replacementTrip.id);
    }
  });

  it('captures the trip-expense maker and prevents self-approval or approved rewrites', async () => {
    const { trip } = await createTrip();
    const expense = await db.transaction((tx) => createTripExpense(tx, {
      tripId: trip.id,
      forwarderId: null,
      createdBy: actors[0]!.id,
      expenseType: 'Q18_TEST',
      buyAmount: '50000',
      sellAmount: '60000',
      expenseDate: '2026-07-15',
      invoiceNumber: 'Q18-TEST-INVOICE',
      settlementMethod: 'COMPANY_DIRECT',
      note: 'Biên nhận thử nghiệm Q18',
    }));
    expenseIds.push(expense.id);
    assert.equal(expense.createdBy, actors[0]!.id);
    assert.equal(expense.approvalStatus, 'PENDING');

    await expectApiError(
      db.transaction((tx) => transitionApproval(tx, {
        table: 'trip_expenses',
        id: expense.id,
        toStatus: 'APPROVED',
        actorId: actors[0]!.id,
        actorRole: Role.ACCOUNTANT,
      })),
      403,
      /chính mình tạo/,
    );
    await db.transaction((tx) => transitionApproval(tx, {
      table: 'trip_expenses',
      id: expense.id,
      toStatus: 'APPROVED',
      actorId: actors[1]!.id,
      actorRole: Role.MANAGER,
    }));
    await expectApiError(
      db.transaction((tx) => updateTripExpense(tx, expense.id, { buyAmount: '70000' })),
      409,
      /không được sửa trực tiếp/,
    );
    const deletion = await deleteTripExpenseGuarded(trip.id, expense.id);
    assert.deepEqual(deletion, {
      error: 'Chi phí đã duyệt không được xóa trực tiếp; hãy lập yêu cầu điều chỉnh',
      status: 409,
    });
    const [persisted] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, expense.id));
    assert.equal(persisted.buyAmount, '50000');
    assert.equal(persisted.approvalStatus, 'APPROVED');
  });

  it('fails closed when a legacy trip expense has no attributable maker', async () => {
    const { trip } = await createTrip();
    const [legacyExpense] = await db.insert(s.tripExpenses).values({
      tripId: trip.id,
      createdBy: null,
      expenseType: 'Q18_LEGACY',
      buyAmount: '50000',
      sellAmount: '50000',
      settlementMethod: 'COMPANY_DIRECT',
      approvalStatus: 'PENDING',
      note: 'Legacy maker is unknown',
    }).returning();
    expenseIds.push(legacyExpense.id);
    await expectApiError(
      db.transaction((tx) => transitionApproval(tx, {
        table: 'trip_expenses',
        id: legacyExpense.id,
        toStatus: 'APPROVED',
        actorId: actors[1]!.id,
        actorRole: Role.MANAGER,
      })),
      409,
      /không xác định được người tạo|đối soát thủ công/,
    );
    const [unchanged] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, legacyExpense.id));
    assert.equal(unchanged.approvalStatus, 'PENDING');
  });
});
