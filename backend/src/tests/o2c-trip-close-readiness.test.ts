import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { applyTripPatch, insertTripComposite } from '../services/trip-composite.service';
import {
  lockTripCloseAggregate,
  requireTripCloseReadiness,
} from '../services/trip-close-readiness.service';
import {
  completeShipmentDirect,
  recomputeShipmentCompletion,
} from '../services/shipment.service';
import { SnapshotServices } from '../services/snapshot-services';
import { setTripExpenseCompletion } from '../services/forwarder.service';
import { requestTripFinancialClose } from '../services/adjustment-governance.service';

let userIds: number[] = [];
let customerId = 0;
let routeId = 0;
let shipmentId = 0;
let fulfillmentId = 0;
let tripId = 0;
let containerId = 0;

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const users = await db.insert(s.users).values([
    { username: `close-driver-${suffix}`.slice(0, 50), passwordHash: 'x', fullName: 'Close Driver', role: 'DRIVER', status: 'ACTIVE' },
    { username: `close-reviewer-${suffix}`.slice(0, 50), passwordHash: 'x', fullName: 'Close Reviewer', role: 'ACCOUNTANT', status: 'ACTIVE' },
    { username: `close-checker-${suffix}`.slice(0, 50), passwordHash: 'x', fullName: 'Close Checker', role: 'CUS', status: 'ACTIVE' },
  ]).returning();
  userIds = users.map((user) => user.id);
  const [customer] = await db.insert(s.customers).values({ name: `Close readiness ${suffix}` }).returning();
  customerId = customer.id;
  const [route] = await db.insert(s.routes).values({ name: `Close route ${suffix}` }).returning();
  routeId = route.id;
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `CLOSE-${suffix}`.slice(0, 50),
    customerId,
    status: 'IN_TRANSIT',
    cargoMode: 'FCL',
    createdBy: userIds[1],
  }).returning();
  shipmentId = shipment.id;
  const [shipmentContainer] = await db.insert(s.shipmentContainers).values({
    shipmentId,
    containerNumber: `BASE${String(Date.now()).slice(-7)}0`,
    createdBy: userIds[1],
  }).returning();
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: shipmentContainer.id,
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
    createdBy: userIds[1],
  }).returning();
  fulfillmentId = fulfillment.id;
  const trip = await insertTripComposite(db, {
    tripCode: `CLOSE-TRIP-${suffix}`.slice(0, 50),
    customerId,
    routeId,
    departureDate: '2026-08-02',
    shipmentId,
    fulfillmentId,
    status: 'IN_TRANSIT',
    carrierType: 'OWN',
  });
  tripId = trip.id;
  const [container] = await db.insert(s.tripContainers).values({
    tripId,
    containerNumber: `TCLU${String(Date.now()).slice(-7)}0`,
  }).returning();
  containerId = container.id;
});

after(async () => {
  await db.delete(s.customerVisibleEvents).where(eq(s.customerVisibleEvents.shipmentId, shipmentId));
  const postingRows = await db.select({ id: s.tripFinancialPostings.id })
    .from(s.tripFinancialPostings)
    .where(eq(s.tripFinancialPostings.tripId, tripId));
  const postingIds = postingRows.map((row) => row.id);
  if (postingIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.financialPostingId, postingIds));
    await db.delete(s.profitabilitySnapshotDimensions)
      .where(sql`${s.profitabilitySnapshotDimensions.snapshotId} in (
        select ${s.profitabilitySnapshots.id}
        from ${s.profitabilitySnapshots}
        where ${s.profitabilitySnapshots.tripId} = ${tripId}
      )`);
    await db.delete(s.profitabilitySnapshots).where(eq(s.profitabilitySnapshots.tripId, tripId));
    await db.delete(s.tripFinancialPostings).where(eq(s.tripFinancialPostings.tripId, tripId));
  }
  await db.delete(s.tripPhotos).where(eq(s.tripPhotos.tripId, tripId));
  await db.delete(s.tripPodSubmissions).where(eq(s.tripPodSubmissions.tripId, tripId));
  const milestones = await db.select({ id: s.shipmentMilestones.id })
    .from(s.shipmentMilestones)
    .where(eq(s.shipmentMilestones.tripId, tripId));
  if (milestones.length > 0) {
    await db.delete(s.customerVisibleEvents)
      .where(inArray(s.customerVisibleEvents.milestoneId, milestones.map((row) => row.id)));
  }
  await db.delete(s.shipmentMilestones).where(eq(s.shipmentMilestones.tripId, tripId));
  await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, tripId));
  await db.delete(s.tripContainers).where(eq(s.tripContainers.tripId, tripId));
  await db.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, tripId));
  await db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, tripId));
  await db.delete(s.trips).where(eq(s.trips.id, tripId));
  await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentId));
  await db.delete(s.shipments).where(eq(s.shipments.id, shipmentId));
  await db.delete(s.routes).where(eq(s.routes.id, routeId));
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, userIds));
  for (const userId of userIds) await db.delete(s.users).where(eq(s.users.id, userId));
  await client.end();
});

async function replacePod(
  status: 'DRAFT' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED',
  version = 1,
  reviewedBy = userIds[2] ?? null,
) {
  await db.delete(s.tripPodSubmissions).where(eq(s.tripPodSubmissions.tripId, tripId));
  const submitted = status !== 'DRAFT';
  const reviewed = status === 'ACCEPTED' || status === 'REJECTED';
  const [row] = await db.insert(s.tripPodSubmissions).values({
    tripId,
    fulfillmentId,
    submissionVersion: version,
    sourceTripVersion: 1,
    status,
    submittedBy: submitted ? userIds[0] : null,
    submittedAt: submitted ? new Date() : null,
    reviewedBy: reviewed ? reviewedBy : null,
    reviewedAt: reviewed ? new Date() : null,
    rejectionReason: status === 'REJECTED' ? 'Thiếu chứng từ' : null,
  }).returning();
  return row;
}

async function prepareReadyForDirectClose() {
  await db.delete(s.customerVisibleEvents).where(eq(s.customerVisibleEvents.shipmentId, shipmentId));
  await db.delete(s.tripPhotos).where(eq(s.tripPhotos.tripId, tripId));
  await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, tripId));
  await replacePod('ACCEPTED');
  await db.update(s.shipments).set({
    status: 'IN_TRANSIT',
    updatedAt: new Date(),
  }).where(eq(s.shipments.id, shipmentId));
  await applyTripPatch(db, tripId, {
    status: 'IN_TRANSIT',
    version: 1,
    podRecoveredAt: new Date(),
    podRecoveredBy: userIds[1],
    completedAt: null,
    vatRate: '0',
    revenue: '40000000',
    revenueOriginal: '40000000',
    revenueEmptyReturn: '40000000',
    arCostHash: null,
    arSnapshotDirty: false,
    arSnapshotChangedAt: null,
    pnlSnapshotGrossProfit: null,
  });
  await db.insert(s.tripExpenseCompletionScopes).values([
    {
      tripId,
      tripContainerId: null,
      status: 'COMPLETED',
      completedBy: userIds[1],
      completedAt: new Date(),
    },
    {
      tripId,
      tripContainerId: containerId,
      status: 'COMPLETED',
      completedBy: userIds[1],
      completedAt: new Date(),
    },
  ]);
  await db.insert(s.tripPhotos).values([
    {
      tripId,
      type: 'CONTAINER',
      storageKey: `close-container-${tripId}.jpg`,
      uploadedBy: userIds[0],
    },
    {
      tripId,
      type: 'SEAL',
      storageKey: `close-seal-${tripId}.jpg`,
      uploadedBy: userIds[0],
    },
  ]);
}

async function createExpenseScopeRecomputeFixture(args: {
  cargoMode: 'LCL' | 'FCL';
  submissionStatus: 'SUBMITTED' | 'ACCEPTED';
}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `SCOPE-${args.cargoMode}-${suffix}`.slice(0, 50),
    customerId,
    status: 'IN_TRANSIT',
    cargoMode: args.cargoMode,
    createdBy: userIds[1],
  }).returning();
  let shipmentContainerId: number | null = null;
  if (args.cargoMode === 'FCL') {
    const [shipmentContainer] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerNumber: `TC${String(Date.now()).slice(-8)}`.slice(0, 20),
      createdBy: userIds[1],
    }).returning();
    shipmentContainerId = shipmentContainer.id;
  }
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: args.cargoMode === 'LCL' ? 'LCL_SHIPMENT' : 'FCL_CONTAINER',
    cargoMode: args.cargoMode,
    shipmentContainerId,
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
    dispatchClassification: args.cargoMode === 'LCL' ? 'LCL' : 'SINGLE',
    createdBy: userIds[1],
  }).returning();
  const trip = await insertTripComposite(db, {
    tripCode: `SCOPE-TRIP-${args.cargoMode}-${suffix}`.slice(0, 50),
    customerId,
    routeId,
    departureDate: '2026-08-03',
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    status: 'IN_TRANSIT',
    carrierType: args.cargoMode === 'LCL' ? 'EXTERNAL' : 'OWN',
  });
  const [container] = await db.insert(s.tripContainers).values({
    tripId: trip.id,
    sourceShipmentId: shipment.id,
    sourceShipmentContainerId: shipmentContainerId,
    sourceShipmentVersion: shipment.version,
    containerNumber: args.cargoMode === 'FCL' ? `TRIP${String(Date.now()).slice(-8)}`.slice(0, 20) : null,
    notes: args.cargoMode === 'LCL'
      ? `__fulfillment_lcl:${fulfillment.id}`
      : null,
    createdBy: userIds[1],
  }).returning();
  await db.insert(s.tripPodSubmissions).values({
    tripId: trip.id,
    fulfillmentId: fulfillment.id,
    submissionVersion: 1,
    sourceTripVersion: 1,
    status: args.submissionStatus,
    submittedBy: userIds[0],
    submittedAt: new Date(),
    reviewedBy: args.submissionStatus === 'ACCEPTED' ? userIds[2] : null,
    reviewedAt: args.submissionStatus === 'ACCEPTED' ? new Date() : null,
  });
  await db.insert(s.tripExpenseCompletionScopes).values({
    tripId: trip.id,
    tripContainerId: container.id,
    status: 'COMPLETED',
    completedBy: userIds[1],
    completedAt: new Date(),
  });

  const cleanup = async () => {
    await db.delete(s.customerVisibleEvents).where(eq(s.customerVisibleEvents.shipmentId, shipment.id));
    const postingRows = await db.select({ id: s.tripFinancialPostings.id })
      .from(s.tripFinancialPostings)
      .where(eq(s.tripFinancialPostings.tripId, trip.id));
    const postingIds = postingRows.map((row) => row.id);
    if (postingIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.financialPostingId, postingIds));
      await db.delete(s.profitabilitySnapshotDimensions)
        .where(sql`${s.profitabilitySnapshotDimensions.snapshotId} in (
          select ${s.profitabilitySnapshots.id}
          from ${s.profitabilitySnapshots}
          where ${s.profitabilitySnapshots.tripId} = ${trip.id}
        )`);
      await db.delete(s.profitabilitySnapshots).where(eq(s.profitabilitySnapshots.tripId, trip.id));
      await db.delete(s.tripFinancialPostings).where(eq(s.tripFinancialPostings.tripId, trip.id));
    }
    await db.delete(s.tripPhotos).where(eq(s.tripPhotos.tripId, trip.id));
    await db.delete(s.tripPodSubmissions).where(eq(s.tripPodSubmissions.tripId, trip.id));
    const milestones = await db.select({ id: s.shipmentMilestones.id })
      .from(s.shipmentMilestones)
      .where(eq(s.shipmentMilestones.tripId, trip.id));
    if (milestones.length > 0) {
      await db.delete(s.customerVisibleEvents)
        .where(inArray(s.customerVisibleEvents.milestoneId, milestones.map((row) => row.id)));
    }
    await db.delete(s.shipmentMilestones).where(eq(s.shipmentMilestones.tripId, trip.id));
    await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, trip.id));
    await db.delete(s.tripContainers).where(eq(s.tripContainers.tripId, trip.id));
    await db.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, trip.id));
    await db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, trip.id));
    await db.delete(s.trips).where(eq(s.trips.id, trip.id));
    await db.delete(s.shipmentStatusHistory).where(eq(s.shipmentStatusHistory.shipmentId, shipment.id));
    await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id));
    if (shipmentContainerId != null) {
      await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.id, shipmentContainerId));
    }
    await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id));
  };

  return { shipment, trip, cleanup };
}

async function prepareFixtureForDirectClose(shipmentIdForFixture: number, tripIdForFixture: number) {
  await db.update(s.shipments).set({
    status: 'IN_TRANSIT',
    updatedAt: new Date(),
  }).where(eq(s.shipments.id, shipmentIdForFixture));
  await applyTripPatch(db, tripIdForFixture, {
    status: 'IN_TRANSIT',
    version: 1,
    podRecoveredAt: new Date(),
    podRecoveredBy: userIds[1],
    completedAt: null,
    vatRate: '0',
    revenue: '40000000',
    revenueOriginal: '40000000',
    revenueEmptyReturn: '40000000',
    arCostHash: null,
    arSnapshotDirty: false,
    arSnapshotChangedAt: null,
    pnlSnapshotGrossProfit: null,
  });
}

describe('O2C trip close readiness authority', () => {
  test('rejects missing, draft, and rejected e-POD; a saved submission passes the gate', async () => {
    await assert.rejects(() => db.transaction((tx) => requireTripCloseReadiness(tx, tripId)), /Chưa có e-POD hợp lệ/);
    for (const status of ['DRAFT', 'REJECTED'] as const) {
      await replacePod(status);
      await assert.rejects(() => db.transaction((tx) => requireTripCloseReadiness(tx, tripId)), /Chưa có e-POD hợp lệ/);
    }
    // Internal approval removed: a saved submission clears the e-POD gate —
    // the flow proceeds to the next precondition (Ops expense scopes).
    await replacePod('SUBMITTED');
    await assert.rejects(() => db.transaction((tx) => requireTripCloseReadiness(tx, tripId)), /Ops chưa xác nhận/);
  });

  test('accepted e-POD still requires general and every container expense scope', async () => {
    await replacePod('ACCEPTED');
    await assert.rejects(() => db.transaction((tx) => requireTripCloseReadiness(tx, tripId)), /Ops chưa xác nhận/);
    await db.insert(s.tripExpenseCompletionScopes).values({
      tripId,
      tripContainerId: null,
      status: 'COMPLETED',
      completedBy: userIds[1],
      completedAt: new Date(),
    });
    await assert.rejects(() => db.transaction((tx) => requireTripCloseReadiness(tx, tripId)), /Ops chưa xác nhận/);
    await db.insert(s.tripExpenseCompletionScopes).values({
      tripId,
      tripContainerId: containerId,
      status: 'COMPLETED',
      completedBy: userIds[1],
      completedAt: new Date(),
    });
    const snapshot = await db.transaction((tx) => requireTripCloseReadiness(tx, tripId));
    assert.equal(snapshot.acceptedPodSubmissionVersion, 1);
  });

  test('a later rejected version supersedes an older accepted version for close readiness', async () => {
    const accepted = await replacePod('ACCEPTED');
    await db.insert(s.tripPodSubmissions).values({
      tripId,
      fulfillmentId,
      submissionVersion: 2,
      sourceTripVersion: 1,
      status: 'REJECTED',
      supersedesSubmissionId: accepted.id,
      submittedBy: userIds[0],
      submittedAt: new Date(),
      reviewedBy: userIds[1],
      reviewedAt: new Date(),
      rejectionReason: 'Phiên mới bị từ chối',
    });
    await assert.rejects(() => db.transaction((tx) => requireTripCloseReadiness(tx, tripId)), /Chưa có e-POD hợp lệ/);
  });

  test('synthetic LCL scope completion keeps submitted or accepted e-POD trips running (expense stage retired)', async () => {
    // 2026-09-05: the PENDING_EXPENSE_APPROVAL stage is retired. A trip that
    // submitted its e-POD but has not been driver-full-closed keeps the
    // shipment IN_TRANSIT — mirroring the FCL skip-kế toán contract above.
    for (const submissionStatus of ['SUBMITTED', 'ACCEPTED'] as const) {
      const fixture = await createExpenseScopeRecomputeFixture({ cargoMode: 'LCL', submissionStatus });
      try {
        const recomputed = await recomputeShipmentCompletion(fixture.shipment.id, { changedBy: userIds[1] });
        assert.equal(recomputed.status, 'IN_TRANSIT');
        const [persisted] = await db.select({ status: s.shipments.status })
          .from(s.shipments)
          .where(eq(s.shipments.id, fixture.shipment.id))
          .limit(1);
        assert.equal(persisted?.status, 'IN_TRANSIT');
      } finally {
        await fixture.cleanup();
      }
    }
  });

  test('synthetic LCL direct close completes without requiring a hidden general scope', async () => {
    const fixture = await createExpenseScopeRecomputeFixture({ cargoMode: 'LCL', submissionStatus: 'ACCEPTED' });
    try {
      await prepareFixtureForDirectClose(fixture.shipment.id, fixture.trip.id);
      const result = await completeShipmentDirect({
        shipmentId: fixture.shipment.id,
        expectedVersion: fixture.shipment.version,
        vatRate: 0.1,
        confirmNoPhoto: true,
        trips: [{ tripId: fixture.trip.id, expectedVersion: fixture.trip.version }],
        idempotencyKey: `lcl-direct-close-${Date.now()}`,
        actor: {
          userId: userIds[1],
          username: 'close-reviewer',
          email: null,
          fullName: 'Close Reviewer',
          role: Role.ACCOUNTANT,
        },
      });

      assert.equal(result.shipment.status, 'COMPLETED');
      assert.deepEqual(result.completedTripIds, [fixture.trip.id]);

      const [completedTrip] = await db.select({ status: s.tripsComposite.status, vatRate: s.tripsComposite.vatRate })
        .from(s.tripsComposite)
        .where(eq(s.tripsComposite.id, fixture.trip.id))
        .limit(1);
      assert.equal(completedTrip?.status, 'COMPLETED');
      assert.equal(completedTrip?.vatRate, '0.100');
    } finally {
      await fixture.cleanup();
    }
  });

  // User instruction 2026-08-29 "skip kế toán for now, we build later":
  // while the accountant review flow is offline, a trip that has submitted
  // its e-POD but not yet been driver-full-closed should NOT advance the
  // shipment to PENDING_EXPENSE_APPROVAL — there is nobody to approve the
  // expense right now and showing a phantom "Chờ duyệt phí" state would
  // confuse CUS and Dispatcher. The shipment stays IN_TRANSIT until the
  // driver hits "HOÀN THÀNH CHUYẾN" (which flips trip → COMPLETED via
  // driverOwnedFulfillmentClose, then shipment → COMPLETED via
  // allCompletedViaDriverClose). When the accountant flow is reintroduced,
  // this branch must be re-enabled.
  test('FCL snapshot fulfillments stay IN_TRANSIT after e-POD submit (skip kế toán)', async () => {
    for (const submissionStatus of ['SUBMITTED', 'ACCEPTED'] as const) {
      const fixture = await createExpenseScopeRecomputeFixture({ cargoMode: 'FCL', submissionStatus });
      try {
        const recomputed = await recomputeShipmentCompletion(fixture.shipment.id, { changedBy: userIds[1] });
        assert.equal(recomputed.status, 'IN_TRANSIT');
        const [persisted] = await db.select({ status: s.shipments.status })
          .from(s.shipments)
          .where(eq(s.shipments.id, fixture.shipment.id))
          .limit(1);
        assert.equal(persisted?.status, 'IN_TRANSIT');
      } finally {
        await fixture.cleanup();
      }
    }
  });

  test('scope completion racing a close request settles without a lock-order deadlock', async () => {
    await replacePod('ACCEPTED');
    await db.update(s.tripExpenseCompletionScopes).set({
      status: 'COMPLETED',
      completedBy: userIds[1],
      completedAt: new Date(),
    }).where(eq(s.tripExpenseCompletionScopes.tripContainerId, containerId));
    await db.insert(s.tripPhotos).values({
      tripId,
      type: 'OTHER',
      storageKey: `close-race-${tripId}.jpg`,
      uploadedBy: userIds[0],
    });

    let releaseScopeTransaction!: () => void;
    let announceScopeLocks!: () => void;
    const scopeLocksHeld = new Promise<void>((resolve) => { announceScopeLocks = resolve; });
    const scopeMayCommit = new Promise<void>((resolve) => { releaseScopeTransaction = resolve; });
    const scopeCompletion = db.transaction(async (tx) => {
      await lockTripCloseAggregate(tx, tripId);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${containerId})`);
      announceScopeLocks();
      await scopeMayCommit;
      return setTripExpenseCompletion(tripId, containerId, true, userIds[1], tx);
    });
    await scopeLocksHeld;
    const closeRequest = requestTripFinancialClose({
        tripId,
        reason: 'Kiểm tra thứ tự khóa khi Ops hoàn tất đồng thời',
        makerId: userIds[1],
        makerRole: 'ACCOUNTANT',
        expectedTripVersion: 1,
      });
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseScopeTransaction();
    const [scopeOutcome, closeOutcome] = await Promise.all([scopeCompletion, closeRequest]);
    assert.equal(scopeOutcome.status, 'COMPLETED');
    assert.equal(closeOutcome.actionKind, 'TRIP_FINANCIAL_CLOSE');
    const [scope] = await db.select().from(s.tripExpenseCompletionScopes)
      .where(eq(s.tripExpenseCompletionScopes.tripContainerId, containerId));
    assert.equal(scope.status, 'COMPLETED');
  });

  test('direct shipment close rejects stale shipment and trip versions with 409', async () => {
    await prepareReadyForDirectClose();
    const [currentShipment] = await db.select({ version: s.shipments.version })
      .from(s.shipments)
      .where(eq(s.shipments.id, shipmentId))
      .limit(1);
    await assert.rejects(() => completeShipmentDirect({
      shipmentId,
      expectedVersion: currentShipment.version + 1,
      vatRate: 0.08,
      trips: [{ tripId, expectedVersion: 1 }],
      idempotencyKey: `shipment-stale-${Date.now()}`,
      actor: {
        userId: userIds[1],
        username: 'close-reviewer',
        email: null,
        fullName: 'Close Reviewer',
        role: Role.ACCOUNTANT,
      },
    }), /Lô hàng đã bị người khác cập nhật/);

    const [shipment] = await db.select({ version: s.shipments.version })
      .from(s.shipments)
      .where(eq(s.shipments.id, shipmentId))
      .limit(1);
    await assert.rejects(() => completeShipmentDirect({
      shipmentId,
      expectedVersion: shipment.version,
      vatRate: 0.08,
      trips: [{ tripId, expectedVersion: 2 }],
      idempotencyKey: `trip-stale-${Date.now()}`,
      actor: {
        userId: userIds[1],
        username: 'close-reviewer',
        email: null,
        fullName: 'Close Reviewer',
        role: Role.ACCOUNTANT,
      },
    }), /Chuyến đi đã được thay đổi/);
  });

  test('direct shipment close rejects duplicate and oversized trip-version payloads', async () => {
    const actor = {
      userId: userIds[1],
      username: 'close-reviewer',
      email: null,
      fullName: 'Close Reviewer',
      role: Role.ACCOUNTANT,
    };

    await assert.rejects(() => completeShipmentDirect({
      shipmentId,
      expectedVersion: 1,
      vatRate: 0.08,
      trips: [
        { tripId, expectedVersion: 1 },
        { tripId, expectedVersion: 1 },
      ],
      idempotencyKey: `duplicate-trips-${Date.now()}`,
      actor,
    }), /bị trùng/);

    await assert.rejects(() => completeShipmentDirect({
      shipmentId,
      expectedVersion: 1,
      vatRate: 0.08,
      trips: Array.from({ length: 101 }, (_, index) => ({
        tripId: index + 1,
        expectedVersion: 1,
      })),
      idempotencyKey: `oversized-trips-${Date.now()}`,
      actor,
    }), /không được vượt quá 100/);
  });

  test('direct shipment close needs no second actor but retains physical POD and expense readiness', async () => {
    for (const submissionStatus of ['SUBMITTED', 'ACCEPTED'] as const) {
      const fixture = await createExpenseScopeRecomputeFixture({ cargoMode: 'LCL', submissionStatus });
      try {
        await prepareFixtureForDirectClose(fixture.shipment.id, fixture.trip.id);
        await db.update(s.tripPodSubmissions).set({
          reviewedBy: submissionStatus === 'ACCEPTED' ? userIds[1] : null,
          reviewedAt: submissionStatus === 'ACCEPTED' ? new Date() : null,
        }).where(eq(s.tripPodSubmissions.tripId, fixture.trip.id));
        const args = {
          shipmentId: fixture.shipment.id,
          expectedVersion: fixture.shipment.version,
          vatRate: 0.08,
          confirmNoPhoto: true,
          trips: [{ tripId: fixture.trip.id, expectedVersion: fixture.trip.version }],
          idempotencyKey: `direct-no-checker-${submissionStatus}-${fixture.trip.id}`,
          actor: { userId: userIds[1], username: 'close-accountant', email: null, fullName: 'Close Accountant', role: Role.ACCOUNTANT },
        };
        await applyTripPatch(db, fixture.trip.id, { podRecoveredAt: null });
        await assert.rejects(() => completeShipmentDirect(args), /Chưa thu hồi POD gốc/);
        await applyTripPatch(db, fixture.trip.id, { podRecoveredAt: new Date() });
        await db.update(s.tripExpenseCompletionScopes).set({ status: 'IN_PROGRESS' })
          .where(eq(s.tripExpenseCompletionScopes.tripId, fixture.trip.id));
        await assert.rejects(() => completeShipmentDirect(args), /Ops chưa xác nhận/);
        await db.update(s.tripExpenseCompletionScopes).set({ status: 'COMPLETED' })
          .where(eq(s.tripExpenseCompletionScopes.tripId, fixture.trip.id));
        const result = await completeShipmentDirect(args);
        assert.equal(result.shipment.status, 'COMPLETED');
        assert.deepEqual(result.completedTripIds, [fixture.trip.id]);
        const [pod] = await db.select().from(s.tripPodSubmissions)
          .where(eq(s.tripPodSubmissions.tripId, fixture.trip.id));
        assert.equal(pod.status, submissionStatus, 'completion does not fabricate an approval');
        assert.equal(pod.reviewedBy, submissionStatus === 'ACCEPTED' ? userIds[1] : null);
      } finally { await fixture.cleanup(); }
    }
  });

  test('direct multi-trip close rolls back every posting when strict AP capture fails', async () => {
    await prepareReadyForDirectClose();
    const [shipment] = await db.select({ version: s.shipments.version })
      .from(s.shipments)
      .where(eq(s.shipments.id, shipmentId))
      .limit(1);
    const [shipmentContainer] = await db.insert(s.shipmentContainers).values({
      shipmentId,
      containerNumber: `MSCU${String(Date.now()).slice(-7)}0`,
      createdBy: userIds[1],
    }).returning();
    const [secondFulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: shipmentContainer.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      createdBy: userIds[1],
    }).returning();
    const secondTrip = await insertTripComposite(db, {
      tripCode: `CLOSE-TRIP-SECOND-${Date.now()}`.slice(0, 50),
      customerId,
      routeId,
      departureDate: '2026-08-02',
      shipmentId,
      fulfillmentId: secondFulfillment.id,
      status: 'IN_TRANSIT',
      carrierType: 'OWN',
      podRecoveredAt: new Date(),
      podRecoveredBy: userIds[1],
      revenue: '40000000',
      revenueOriginal: '40000000',
      revenueEmptyReturn: '40000000',
    });
    const [secondContainer] = await db.insert(s.tripContainers).values({
      tripId: secondTrip.id,
      containerNumber: `APRB${String(Date.now()).slice(-7)}0`,
    }).returning();
    await db.insert(s.tripPodSubmissions).values({
      tripId: secondTrip.id,
      fulfillmentId: secondFulfillment.id,
      submissionVersion: 1,
      sourceTripVersion: secondTrip.version,
      status: 'ACCEPTED',
      submittedBy: userIds[0],
      submittedAt: new Date(),
      reviewedBy: userIds[2],
      reviewedAt: new Date(),
    });
    await db.insert(s.tripExpenseCompletionScopes).values([
      {
        tripId: secondTrip.id,
        tripContainerId: null,
        status: 'COMPLETED',
        completedBy: userIds[1],
        completedAt: new Date(),
      },
      {
        tripId: secondTrip.id,
        tripContainerId: secondContainer.id,
        status: 'COMPLETED',
        completedBy: userIds[1],
        completedAt: new Date(),
      },
    ]);
    await db.insert(s.tripPhotos).values([
      { tripId: secondTrip.id, type: 'CONTAINER', storageKey: `ap-rollback-container-${secondTrip.id}.jpg`, uploadedBy: userIds[0] },
      { tripId: secondTrip.id, type: 'SEAL', storageKey: `ap-rollback-seal-${secondTrip.id}.jpg`, uploadedBy: userIds[0] },
    ]);

    const originalCaptureAp = SnapshotServices.captureApWithDegradation;
    SnapshotServices.captureApWithDegradation = async (candidateTripId, tx) => (
      candidateTripId === secondTrip.id
        ? false
        : originalCaptureAp.call(SnapshotServices, candidateTripId, tx)
    );
    try {
      await assert.rejects(() => completeShipmentDirect({
        shipmentId,
        expectedVersion: shipment.version,
        vatRate: 0.08,
        trips: [
          { tripId, expectedVersion: 1 },
          { tripId: secondTrip.id, expectedVersion: secondTrip.version },
        ],
        idempotencyKey: `strict-ap-rollback-${Date.now()}`,
        actor: {
          userId: userIds[1],
          username: 'close-reviewer',
          email: null,
          fullName: 'Close Reviewer',
          role: Role.ACCOUNTANT,
        },
      }), /Không thể ghi nhận AP/);

      const tripRows = await db.select({ id: s.trips.id, status: s.trips.status })
        .from(s.trips)
        .where(inArray(s.trips.id, [tripId, secondTrip.id]));
      assert.deepEqual(
        tripRows.sort((left, right) => left.id - right.id).map((row) => row.status),
        ['IN_TRANSIT', 'IN_TRANSIT'],
      );
      const postingRows = await db.select({ id: s.tripFinancialPostings.id })
        .from(s.tripFinancialPostings)
        .where(inArray(s.tripFinancialPostings.tripId, [tripId, secondTrip.id]));
      assert.equal(postingRows.length, 0);
    } finally {
      SnapshotServices.captureApWithDegradation = originalCaptureAp;
      await db.delete(s.tripPhotos).where(eq(s.tripPhotos.tripId, secondTrip.id));
      await db.delete(s.tripPodSubmissions).where(eq(s.tripPodSubmissions.tripId, secondTrip.id));
      await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, secondTrip.id));
      await db.delete(s.tripContainers).where(eq(s.tripContainers.tripId, secondTrip.id));
      await db.delete(s.trips).where(eq(s.trips.id, secondTrip.id));
      await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, secondFulfillment.id));
      await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.id, shipmentContainer.id));
    }
  });

  test('zero-revenue direct close requires explicit confirmation', async () => {
    await prepareReadyForDirectClose();
    await applyTripPatch(db, tripId, {
      revenue: '0',
      revenueOriginal: '0',
      revenueEmptyReturn: '0',
    });
    const [shipment] = await db.select({ version: s.shipments.version })
      .from(s.shipments)
      .where(eq(s.shipments.id, shipmentId))
      .limit(1);

    await assert.rejects(() => completeShipmentDirect({
      shipmentId,
      expectedVersion: shipment.version,
      vatRate: 0.08,
      confirmZeroRevenue: false,
      trips: [{ tripId, expectedVersion: 1 }],
      idempotencyKey: `zero-revenue-rejected-${Date.now()}`,
      actor: {
        userId: userIds[1],
        username: 'close-reviewer',
        email: null,
        fullName: 'Close Reviewer',
        role: Role.ACCOUNTANT,
      },
    }), /Doanh thu bằng 0/);

    const [unchangedTrip] = await db.select({ status: s.trips.status })
      .from(s.trips)
      .where(eq(s.trips.id, tripId))
      .limit(1);
    assert.equal(unchangedTrip.status, 'IN_TRANSIT');
  });

  test('confirmed zero-revenue direct close applies VAT once and completes exactly once', async () => {
    await prepareReadyForDirectClose();
    await applyTripPatch(db, tripId, {
      revenue: '0',
      revenueOriginal: '0',
      revenueEmptyReturn: '0',
    });
    const [shipment] = await db.select({ version: s.shipments.version })
      .from(s.shipments)
      .where(eq(s.shipments.id, shipmentId))
      .limit(1);
    const replayKey = `shipment-complete-${Date.now()}`;
    const first = await completeShipmentDirect({
      shipmentId,
      expectedVersion: shipment.version,
      vatRate: 0.08,
      confirmZeroRevenue: true,
      trips: [{ tripId, expectedVersion: 1 }],
      idempotencyKey: replayKey,
      actor: {
        userId: userIds[1],
        username: 'close-reviewer',
        email: null,
        fullName: 'Close Reviewer',
        role: Role.ACCOUNTANT,
      },
    });
    assert.equal(first.replayed, false);
    assert.equal(first.shipment.status, 'COMPLETED');
    assert.deepEqual(first.completedTripIds, [tripId]);
    assert.equal(first.vatRate, 0.08);

    const second = await completeShipmentDirect({
      shipmentId,
      expectedVersion: shipment.version,
      vatRate: 0.08,
      confirmZeroRevenue: true,
      trips: [{ tripId, expectedVersion: 1 }],
      idempotencyKey: replayKey,
      actor: {
        userId: userIds[1],
        username: 'close-reviewer',
        email: null,
        fullName: 'Close Reviewer',
        role: Role.ACCOUNTANT,
      },
    });
    assert.equal(second.replayed, true);
    assert.deepEqual(second.completedTripIds, [tripId]);
    assert.equal(second.vatRate, 0.08);

    const deliveredEvents = await db.select({
      id: s.customerVisibleEvents.id,
      title: s.customerVisibleEvents.contentSnapshot,
    })
      .from(s.customerVisibleEvents)
      .where(eq(s.customerVisibleEvents.shipmentId, shipmentId));
    assert.equal(
      deliveredEvents.filter((event) => event.title.title === 'Đã giao hàng').length,
      1,
    );

    const [postingCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(s.tripFinancialPostings)
      .where(eq(s.tripFinancialPostings.tripId, tripId));
    assert.equal(postingCount.count, 1);

    const [trip] = await db.select({
      status: s.tripsComposite.status,
      vatRate: s.tripsComposite.vatRate,
      arCostHash: s.tripsComposite.arCostHash,
      arSnapshotDirty: s.tripsComposite.arSnapshotDirty,
    }).from(s.tripsComposite).where(eq(s.tripsComposite.id, tripId)).limit(1);
    assert.equal(trip.status, 'COMPLETED');
    assert.equal(trip.vatRate, '0.080');
    assert.ok(trip.arCostHash);
    assert.equal(trip.arSnapshotDirty, false);
  });

  // P2-001 regression: a PENDING_EXPENSE_APPROVAL shipment whose trip has no
  // CONTAINER/SEAL photo evidence must still be closable when the actor passes
  // confirmNoPhoto=true (mirrors the per-trip override). Without the fix, the
  // routine close hardcoded confirmNoPhoto=false and could never complete a
  // photo-less trip even though PRD Bước 5 only requires e-POD + POD paper +
  // expense scope + VAT.
  test('direct close blocks on missing photo evidence unless confirmNoPhoto is set', async () => {
    await prepareReadyForDirectClose();
    // Strip every trip photo so the photo-evidence gate is the only blocker.
    await db.delete(s.tripPhotos).where(eq(s.tripPhotos.tripId, tripId));
    const [shipment] = await db.select({ version: s.shipments.version })
      .from(s.shipments)
      .where(eq(s.shipments.id, shipmentId))
      .limit(1);

    const actor = {
      userId: userIds[1],
      username: 'close-reviewer',
      email: null,
      fullName: 'Close Reviewer',
      role: Role.ACCOUNTANT,
    };

    // Without override: blocked by the photo-evidence gate.
    await assert.rejects(() => completeShipmentDirect({
      shipmentId,
      expectedVersion: shipment.version,
      vatRate: 0.1,
      confirmNoPhoto: false,
      trips: [{ tripId, expectedVersion: 1 }],
      idempotencyKey: `no-photo-blocked-${Date.now()}`,
      actor,
    }), /Chưa có ảnh bằng chứng/);

    const [stillInTransit] = await db.select({ status: s.trips.status })
      .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
    assert.equal(stillInTransit.status, 'IN_TRANSIT');

    // With override: completes exactly once.
    const result = await completeShipmentDirect({
      shipmentId,
      expectedVersion: shipment.version,
      vatRate: 0.1,
      confirmNoPhoto: true,
      trips: [{ tripId, expectedVersion: 1 }],
      idempotencyKey: `no-photo-override-${Date.now()}`,
      actor,
    });
    assert.deepEqual(result.completedTripIds, [tripId]);
    assert.equal(result.vatRate, 0.1);

    const [completed] = await db.select({ status: s.tripsComposite.status, vatRate: s.tripsComposite.vatRate })
      .from(s.tripsComposite).where(eq(s.tripsComposite.id, tripId)).limit(1);
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.vatRate, '0.100');
  });
});
