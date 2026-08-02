import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import {
  lockTripCloseAggregate,
  requireTripCloseReadiness,
} from '../services/trip-close-readiness.service';
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
    cargoMode: 'LCL',
    createdBy: userIds[1],
  }).returning();
  shipmentId = shipment.id;
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
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
  await db.delete(s.governanceActions).where(eq(s.governanceActions.subjectId, tripId));
  await db.delete(s.tripPhotos).where(eq(s.tripPhotos.tripId, tripId));
  await db.delete(s.tripPodSubmissions).where(eq(s.tripPodSubmissions.tripId, tripId));
  await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, tripId));
  await db.delete(s.tripContainers).where(eq(s.tripContainers.tripId, tripId));
  await db.delete(s.trips).where(eq(s.trips.id, tripId));
  await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentId));
  await db.delete(s.shipments).where(eq(s.shipments.id, shipmentId));
  await db.delete(s.routes).where(eq(s.routes.id, routeId));
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
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
});
