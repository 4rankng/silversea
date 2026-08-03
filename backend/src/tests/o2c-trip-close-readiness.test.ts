import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import {
  lockTripCloseAggregate,
  requireTripCloseReadiness,
} from '../services/trip-close-readiness.service';
import { completeShipmentDirect } from '../services/shipment.service';
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
  const [trip] = await db.insert(s.trips).values({
    tripCode: `CLOSE-TRIP-${suffix}`.slice(0, 50),
    customerId,
    routeId,
    departureDate: '2026-08-02',
    shipmentId,
    fulfillmentId,
    status: 'IN_TRANSIT',
    carrierType: 'OWN',
  }).returning();
  tripId = trip.id;
  const [container] = await db.insert(s.tripContainers).values({
    tripId,
    containerNumber: `TCLU${String(Date.now()).slice(-7)}0`,
  }).returning();
  containerId = container.id;
});

after(async () => {
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
  await db.delete(s.governanceActions).where(eq(s.governanceActions.subjectId, tripId));
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
  await db.delete(s.trips).where(eq(s.trips.id, tripId));
  await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentId));
  await db.delete(s.shipments).where(eq(s.shipments.id, shipmentId));
  await db.delete(s.routes).where(eq(s.routes.id, routeId));
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, userIds));
  for (const userId of userIds) await db.delete(s.users).where(eq(s.users.id, userId));
  await client.end();
});

async function replacePod(status: 'DRAFT' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED', version = 1) {
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
    reviewedBy: reviewed ? userIds[1] : null,
    reviewedAt: reviewed ? new Date() : null,
    rejectionReason: status === 'REJECTED' ? 'Thiếu chứng từ' : null,
  }).returning();
  return row;
}

async function prepareReadyForDirectClose() {
  await db.delete(s.governanceActions).where(eq(s.governanceActions.subjectId, tripId));
  await db.delete(s.tripPhotos).where(eq(s.tripPhotos.tripId, tripId));
  await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, tripId));
  await replacePod('ACCEPTED');
  await db.update(s.shipments).set({
    status: 'PENDING_EXPENSE_APPROVAL',
    updatedAt: new Date(),
  }).where(eq(s.shipments.id, shipmentId));
  await db.update(s.trips).set({
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
  }).where(eq(s.trips.id, tripId));
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

describe('O2C trip close readiness authority', () => {
  test('rejects no e-POD and every non-accepted current e-POD state', async () => {
    await assert.rejects(() => db.transaction((tx) => requireTripCloseReadiness(tx, tripId)), /e-POD hiện tại chưa được duyệt/);
    for (const status of ['DRAFT', 'SUBMITTED', 'REJECTED'] as const) {
      await replacePod(status);
      await assert.rejects(() => db.transaction((tx) => requireTripCloseReadiness(tx, tripId)), /e-POD hiện tại chưa được duyệt/);
    }
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
    await assert.rejects(() => db.transaction((tx) => requireTripCloseReadiness(tx, tripId)), /e-POD hiện tại chưa được duyệt/);
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
    const [secondTrip] = await db.insert(s.trips).values({
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
    }).returning();
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
      reviewedBy: userIds[1],
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
    await db.update(s.trips).set({
      revenue: '0',
      revenueOriginal: '0',
      revenueEmptyReturn: '0',
    }).where(eq(s.trips.id, tripId));
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
    await db.update(s.trips).set({
      revenue: '0',
      revenueOriginal: '0',
      revenueEmptyReturn: '0',
    }).where(eq(s.trips.id, tripId));
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

    const [governanceCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(s.governanceActions)
      .where(eq(s.governanceActions.subjectId, tripId));
    assert.equal(governanceCount.count, 0);

    const [postingCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(s.tripFinancialPostings)
      .where(eq(s.tripFinancialPostings.tripId, tripId));
    assert.equal(postingCount.count, 1);

    const [trip] = await db.select({
      status: s.trips.status,
      vatRate: s.trips.vatRate,
      arCostHash: s.trips.arCostHash,
      arSnapshotDirty: s.trips.arSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
    assert.equal(trip.status, 'COMPLETED');
    assert.equal(trip.vatRate, '0.080');
    assert.ok(trip.arCostHash);
    assert.equal(trip.arSnapshotDirty, false);
  });
});
