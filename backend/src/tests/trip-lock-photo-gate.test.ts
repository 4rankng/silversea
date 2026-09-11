import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role, TripStatus } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import {
  autoApplyGovernanceAction,
  requestTripFinancialClose,
} from '../services/adjustment-governance.service';

/**
 * Photo evidence gate on COMPLETION — migrated from the former LOCK transition
 * (O2C reconciliation, 01/08/2026).
 *
 * Completing a trip (IN_TRANSIT → COMPLETED, driven by the governed TRIP_FINANCIAL_CLOSE
 * close) requires, on top of `podRecoveredAt` (POD-recovery gate):
 *   - baseline: ≥1 photo of any type, AND
 *   - if the trip's cargo type has requires_photos=true: additionally ≥1
 *     CONTAINER and ≥1 SEAL photo.
 * confirmNoPhoto:true overrides the photo gate (but the governed close path
 * passes confirmNoPhoto=false, so the gate is enforced here).
 *
 * Pattern mirrors ledger.service.chiho.test.ts: real Postgres, insert rows
 * directly, drive the transition through the governed close workflow, clean up
 * in `after`.
 */

const createdTripIds: number[] = [];
const createdPhotoIds: number[] = [];
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdFulfillmentIds: number[] = [];

after(async () => {
  // Ledger rows for a trip are keyed by txnId=tripId (TRIP_REVENUE etc.).
  if (createdTripIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, createdTripIds));
    await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.tripId, createdTripIds));
    await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.tripId, createdTripIds));
    const milestones = await db.select({ id: s.shipmentMilestones.id })
      .from(s.shipmentMilestones)
      .where(inArray(s.shipmentMilestones.tripId, createdTripIds));
    if (milestones.length > 0) {
      await db.delete(s.customerVisibleEvents)
        .where(inArray(s.customerVisibleEvents.milestoneId, milestones.map((row) => row.id)));
    }
    await db.delete(s.shipmentMilestones).where(inArray(s.shipmentMilestones.tripId, createdTripIds));
  }
  if (createdPhotoIds.length > 0) {
    await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.id, createdPhotoIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdFulfillmentIds.length > 0) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
  }
  if (createdShipmentIds.length > 0) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
  }
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.notifications).where(inArray(s.notifications.userId, createdUserIds));
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await client.end();
});

interface SetupOptions {
  /** cargoTypes.requires_photos — default false (baseline gate only). */
  requiresPhotos?: boolean;
}

/**
 * Creates admin user + customer + route + cargoType + an IN_TRANSIT trip with
 * revenue 5,000,000 (passes the zero-revenue guard) and `podRecoveredAt` set
 * (satisfies the POD-recovery gate). Returns all rows so the caller can add
 * photos and drive the governed completion.
 */
async function setupTrip(opts: SetupOptions = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const actors = await db.insert(s.users).values([
    { username: `photo-admin-${suffix}`.slice(0, 50), passwordHash: 'x', fullName: `PhotoGate admin ${suffix}`, role: 'ADMIN', status: 'ACTIVE' },
    { username: `photo-maker-${suffix}`.slice(0, 50), passwordHash: 'x', fullName: `PhotoGate maker ${suffix}`, role: Role.ACCOUNTANT, status: 'ACTIVE' },
    { username: `photo-checker-${suffix}`.slice(0, 50), passwordHash: 'x', fullName: `PhotoGate checker ${suffix}`, role: Role.MANAGER, status: 'ACTIVE' },
    { username: `photo-approver-${suffix}`.slice(0, 50), passwordHash: 'x', fullName: `PhotoGate approver ${suffix}`, role: 'ADMIN', status: 'ACTIVE' },
  ]).returning();
  const [admin, maker, checker, approver] = actors;
  createdUserIds.push(admin.id, maker.id, checker.id, approver.id);

  const [customer] = await db.insert(s.customers)
    .values({ name: `PhotoGate customer ${suffix}` }).returning();
  const [route] = await db.insert(s.routes)
    .values({ name: `PhotoGate route ${suffix}` }).returning();
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `PhotoGate cargo ${suffix}`,
    requiresPhotos: opts.requiresPhotos ?? false,
  }).returning();
  createdCustomerIds.push(customer.id);
  createdRouteIds.push(route.id);
  createdCargoTypeIds.push(cargoType.id);

  const trip = await insertTripComposite(db, {
    tripCode: `PG-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: TripStatus.IN_TRANSIT,
    departureDate: '2026-06-20',
    revenue: '5000000',
    carrierType: 'OWN',
    // POD-recovery gate (O2C): must be recorded before completion.
    podRecoveredAt: new Date(),
    podRecoveredBy: admin.id,
  });
  createdTripIds.push(trip.id);
  await attachCloseReadiness(trip.id, trip.version, customer.id, maker.id, checker.id);

  return { admin, maker, checker, approver, customer, route, cargoType, trip };
}

async function attachCloseReadiness(
  tripId: number,
  tripVersion: number,
  customerId: number,
  submittedBy: number,
  reviewedBy: number,
) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId,
    status: 'IN_TRANSIT',
    cargoMode: 'LCL',
  }).returning();
  createdShipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
  }).returning();
  createdFulfillmentIds.push(fulfillment.id);
  await db.update(s.trips).set({
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
  }).where(eq(s.trips.id, tripId));
  await db.insert(s.tripPodSubmissions).values({
    tripId,
    fulfillmentId: fulfillment.id,
    submissionVersion: 1,
    sourceTripVersion: tripVersion,
    status: 'ACCEPTED',
    submittedBy,
    submittedAt: new Date(),
    reviewedBy,
    reviewedAt: new Date(),
  });
  await db.insert(s.tripExpenseCompletionScopes).values({
    tripId,
    tripContainerId: null,
    status: 'COMPLETED',
    completedBy: submittedBy,
    completedAt: new Date(),
  });
}

async function insertPhoto(tripId: number, uploadedBy: number, type: 'CONTAINER' | 'SEAL' | 'OTHER') {
  const [photo] = await db.insert(s.tripPhotos).values({
    tripId,
    type,
    storageKey: `test-photos/${tripId}-${type}-${Date.now()}.jpg`,
    uploadedBy,
  }).returning();
  createdPhotoIds.push(photo.id);
  return photo;
}

async function reloadTripStatus(tripId: number): Promise<TripStatus> {
  const [row] = await db.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  return row.status as TripStatus;
}

/**
 * Drive IN_TRANSIT → COMPLETED through the governed TRIP_FINANCIAL_CLOSE path
 * (the sole non-e-POD completion route). 2026-09-11 maker-checker removal:
 * the request applies directly in-request via autoApplyGovernanceAction —
 * the ACCOUNTANT makes, the MANAGER actor runs the check+approve stages.
 * The photo / zero-revenue / POD-recovery gates fire inside the make stage
 * (fail-fast) and inside transitionTripStatus during in-request application.
 */
async function completeGoverned(
  trip: { id: number; version: number },
  maker: { id: number },
  checker: { id: number },
) {
  return autoApplyGovernanceAction({
    make: () => requestTripFinancialClose({
      tripId: trip.id,
      reason: 'Hoàn thành chuyến (photo gate test)',
      makerId: maker.id,
      makerRole: Role.ACCOUNTANT,
      expectedTripVersion: trip.version,
    }),
    actorId: checker.id,
    actorRole: Role.MANAGER,
  });
}

describe('completion photo-evidence gate', () => {
  test('rejects completing an IN_TRANSIT trip with zero photos (baseline)', async () => {
    const { maker, checker, trip } = await setupTrip();
    await assert.rejects(
      () => completeGoverned(trip, maker, checker),
      /ảnh bằng chứng/,
    );
  });

  test('one OTHER photo satisfies the baseline gate when cargoType.requires_photos=false', async () => {
    const { admin, maker, checker, trip } = await setupTrip({ requiresPhotos: false });
    await insertPhoto(trip.id, admin.id, 'OTHER');

    await completeGoverned(trip, maker, checker);

    assert.equal(await reloadTripStatus(trip.id), TripStatus.COMPLETED);
  });

  test('requires_photos cargo type with only an OTHER photo rejects with CONTAINER/SEAL message', async () => {
    const { admin, maker, checker, trip } = await setupTrip({ requiresPhotos: true });
    await insertPhoto(trip.id, admin.id, 'OTHER');

    await assert.rejects(
      () => completeGoverned(trip, maker, checker),
      /CONTAINER.*SEAL/,
    );
  });

  test('missing podRecoveredAt blocks completion with the POD-recovery message', async () => {
    const { admin, maker, checker, customer, route, cargoType } = await setupTrip({ requiresPhotos: false });
    // Insert a fresh IN_TRANSIT trip without podRecoveredAt to isolate the POD gate.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const noPodTrip = await insertTripComposite(db, {
      tripCode: `PG-NPOD-${suffix}`.slice(0, 50),
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      status: TripStatus.IN_TRANSIT,
      departureDate: '2026-06-20',
      revenue: '5000000',
      carrierType: 'OWN',
      // podRecoveredAt deliberately omitted.
    });
    createdTripIds.push(noPodTrip.id);
    await attachCloseReadiness(noPodTrip.id, noPodTrip.version, customer.id, maker.id, checker.id);
    await insertPhoto(noPodTrip.id, admin.id, 'OTHER');

    await assert.rejects(
      () => completeGoverned(noPodTrip, maker, checker),
      /Chưa thu hồi POD gốc/,
    );
    assert.equal(await reloadTripStatus(noPodTrip.id), TripStatus.IN_TRANSIT);
  });
});
