import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';
import { FuelMode, Role, TripStatus, TxnType } from '@tingting/shared';

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  approveGovernanceAction,
  checkGovernanceAction,
  requestTripFinancialChange,
  requestTripFinancialClose,
} from '../services/adjustment-governance.service';
import { ApSnapshotService } from '../services/ap-snapshot.service';
import { SnapshotServices } from '../services/snapshot-services';
import { disconnectRedis } from '../lib/redis';
import {
  attachAcceptedTripCloseEvidence,
  cleanupTripCloseMilestones,
  cleanupTripCloseShipments,
} from './helpers/o2c-close-fixture';

const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdUserIds: number[] = [];
const createdShipmentIds: number[] = [];

before(async () => {
  const columns = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'trips'
      AND column_name IN ('ap_cost_hash', 'ap_snapshot_dirty', 'ap_snapshot_changed_at')
    ORDER BY column_name
  `);
  assert.equal(columns.length, 3, 'Phase 4 trip AP snapshot columns are missing in the dev DB');
});

after(async () => {
  if (createdTripIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.subjectId, createdTripIds));
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, [...createdTripIds, ...createdExpenseIds]));
    if (createdExpenseIds.length > 0) {
      await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    }
    await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.tripId, createdTripIds));
    await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.tripId, createdTripIds));
    await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.tripId, createdTripIds));
    await cleanupTripCloseMilestones(createdTripIds);
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  await cleanupTripCloseShipments(createdShipmentIds);
  if (createdUserIds.length > 0) {
    await db.delete(s.notifications).where(inArray(s.notifications.userId, createdUserIds));
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  if (createdSupplierIds.length > 0) {
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  await disconnectRedis();
  await client.end();
});

async function createTripFixture(overrides?: {
  buyAmount?: string;
  settlementMethod?: 'COMPANY_DIRECT' | 'FORWARDER_ADVANCE';
  approvalStatus?: 'APPROVED' | 'PENDING';
  sellAmount?: string;
  supplierId?: number | null;
}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [customer] = await db.insert(s.customers)
    .values({ name: `O2C AP customer ${suffix}` })
    .returning();
  const [supplier] = await db.insert(s.suppliers)
    .values({ name: `O2C AP supplier ${suffix}` })
    .returning();
  const [route] = await db.insert(s.routes)
    .values({ name: `O2C AP route ${suffix}` })
    .returning();
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `O2C AP cargo ${suffix}` })
    .returning();
  createdCustomerIds.push(customer.id);
  createdSupplierIds.push(supplier.id);
  createdRouteIds.push(route.id);
  createdCargoTypeIds.push(cargoType.id);

  const [trip] = await db.insert(s.trips).values({
    tripCode: `AP-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: TripStatus.IN_TRANSIT,
    departureDate: '2026-08-02',
    podRecoveredAt: new Date(),
    podRecoveredBy: 1,
    carrierType: 'OWN',
    revenue: '2000000',
    driverSalary: '0',
  }).returning();
  createdTripIds.push(trip.id);

  await db.insert(s.tripPhotos).values({
    tripId: trip.id,
    type: 'OTHER',
    storageKey: `test-photos/ap-${trip.id}-${suffix}.jpg`,
    uploadedBy: 1,
  });

  const [expense] = await db.insert(s.tripExpenses).values({
    tripId: trip.id,
    expenseType: 'CHI_HO',
    buyAmount: overrides?.buyAmount ?? '100000',
    sellAmount: overrides?.sellAmount ?? '120000',
    settlementMethod: overrides?.settlementMethod ?? 'COMPANY_DIRECT',
    supplierId: overrides?.supplierId === undefined ? supplier.id : overrides.supplierId,
    approvalStatus: overrides?.approvalStatus ?? 'APPROVED',
  }).returning();
  createdExpenseIds.push(expense.id);

  return { trip, supplier, expense };
}

async function completeTripGoverned(tripId: number, expectedVersion: number) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const actors = await db.insert(s.users).values([
    { username: `ap-close-maker-${suffix}`, passwordHash: 'x', role: Role.MANAGER },
    { username: `ap-close-checker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT },
    { username: `ap-close-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN },
  ]).returning({ id: s.users.id });
  createdUserIds.push(...actors.map((actor) => actor.id));

  const [trip] = await db.select({ customerId: s.trips.customerId })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  const closeEvidence = await attachAcceptedTripCloseEvidence({
    tripId,
    tripVersion: expectedVersion,
    customerId: trip.customerId,
    submittedBy: actors[0]!.id,
    reviewedBy: actors[1]!.id,
  });
  createdShipmentIds.push(closeEvidence.shipmentId);

  const action = await requestTripFinancialClose({
    tripId,
    reason: 'Hoàn thành chuyến để kiểm tra AP snapshot',
    makerId: actors[1]!.id,
    makerRole: Role.ACCOUNTANT,
    expectedTripVersion: expectedVersion,
  });
  const checked = await checkGovernanceAction({
    actionId: action.id,
    checkerId: actors[0]!.id,
    checkerRole: Role.MANAGER,
    expectedVersion: action.version,
  });
  await approveGovernanceAction({
    actionId: action.id,
    approverId: actors[2]!.id,
    approverRole: Role.ADMIN,
    expectedVersion: checked.version,
  });

  const [completed] = await db.select().from(s.trips)
    .where(eq(s.trips.id, tripId))
    .limit(1);
  assert.ok(completed);
  return completed;
}

describe('O2C rev1 Phase 4 — AP snapshot dirtying', () => {
  test('internal-only completed-trip cost changes dirty AR but keep AP clean', async () => {
    const { trip } = await createTripFixture();
    await completeTripGoverned(trip.id, trip.version);

    await db.update(s.trips)
      .set({ driverSalary: '345000' })
      .where(eq(s.trips.id, trip.id));
    await SnapshotServices.markBothDirty(trip.id, db);

    const [updated] = await db.select({
      arSnapshotDirty: s.trips.arSnapshotDirty,
      apSnapshotDirty: s.trips.apSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(updated?.arSnapshotDirty, true);
    assert.equal(updated?.apSnapshotDirty, false);

    const ledgerRows = await db.select().from(s.ledger)
      .where(eq(s.ledger.txnId, trip.id));
    assert.equal(
      ledgerRows.filter((row) => row.txnType === TxnType.TRIP_REVENUE).length,
      1,
      'dirtying snapshots alone must not repost revenue',
    );
    assert.equal(
      ledgerRows.filter((row) => row.txnType === TxnType.UNLOCK_REVERSAL).length,
      0,
      'internal-only completed edits should mark AR dirty without emitting reversals',
    );
  });

  test('supplier-tagged but non-payable fees do not dirty AP when they change', async () => {
    const { trip, expense } = await createTripFixture({
      settlementMethod: 'FORWARDER_ADVANCE',
    });
    await completeTripGoverned(trip.id, trip.version);

    await db.transaction(async (tx) => {
      await tx.update(s.tripExpenses)
        .set({ buyAmount: '155000' })
        .where(eq(s.tripExpenses.id, expense.id));
      await SnapshotServices.markBothDirty(trip.id, tx);
    });

    const [updated] = await db.select({
      arSnapshotDirty: s.trips.arSnapshotDirty,
      apSnapshotDirty: s.trips.apSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(updated?.arSnapshotDirty, true);
    assert.equal(updated?.apSnapshotDirty, false);
  });

  test('supplier-payable cost changes inside an existing tx dirty both AR and AP', async () => {
    const { trip, expense } = await createTripFixture();
    await completeTripGoverned(trip.id, trip.version);

    await db.transaction(async (tx) => {
      await tx.update(s.tripExpenses)
        .set({ buyAmount: '175000' })
        .where(eq(s.tripExpenses.id, expense.id));
      await SnapshotServices.markBothDirty(trip.id, tx);
    });

    const [updated] = await db.select({
      arSnapshotDirty: s.trips.arSnapshotDirty,
      apSnapshotDirty: s.trips.apSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(updated?.arSnapshotDirty, true);
    assert.equal(updated?.apSnapshotDirty, true);

    await ApSnapshotService.recapture(trip.id);
    const [recaptured] = await db.select({
      apCostHash: s.trips.apCostHash,
      apSnapshotDirty: s.trips.apSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.ok(recaptured?.apCostHash, 'AP recapture should store a fresh hash');
    assert.equal(recaptured?.apSnapshotDirty, false);
  });

  test('changing the fuel supplier identity dirties AP even when the amount is unchanged', async () => {
    const { trip, supplier } = await createTripFixture();
    await db.update(s.trips).set({
      fuelSupplierId: supplier.id,
      totalFuelCost: '500000',
    }).where(eq(s.trips.id, trip.id));
    await completeTripGoverned(trip.id, trip.version);

    const [replacementSupplier] = await db.insert(s.suppliers)
      .values({ name: `O2C AP replacement fuel supplier ${Date.now()}` })
      .returning();
    createdSupplierIds.push(replacementSupplier.id);
    await db.transaction(async (tx) => {
      await tx.update(s.trips).set({ fuelSupplierId: replacementSupplier.id })
        .where(eq(s.trips.id, trip.id));
      await ApSnapshotService.markDirty(trip.id, tx);
    });

    const [updated] = await db.select({ apSnapshotDirty: s.trips.apSnapshotDirty })
      .from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(updated?.apSnapshotDirty, true);
  });

  test('a governed completed-trip correction reconciles the dirty fuel surcharge and reposts AR', async () => {
    const { trip } = await createTripFixture();
    const historicalComputedAt = new Date(0).toISOString();
    await db.update(s.trips).set({
      fuelSurchargeAmount: '321000',
      fuelSurchargeSnapshot: {
        currentFuelPrice: 25000,
        baseFuelPrice: 20000,
        quotaLiters: 128.4,
        customerSharePct: 50,
        customerId: trip.customerId,
        computedAt: historicalComputedAt,
      },
    }).where(eq(s.trips.id, trip.id));
    const completed = await completeTripGoverned(trip.id, trip.version);
    await db.update(s.trips).set({ fuelSurchargeSnapshotDirty: true })
      .where(eq(s.trips.id, trip.id));

    const actorSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const actors = await db.insert(s.users).values([
      { username: `ap-edit-maker-${actorSuffix}`, passwordHash: 'x', role: Role.MANAGER },
      { username: `ap-edit-checker-${actorSuffix}`, passwordHash: 'x', role: Role.ACCOUNTANT },
      { username: `ap-edit-approver-${actorSuffix}`, passwordHash: 'x', role: Role.ADMIN },
    ]).returning({ id: s.users.id });
    createdUserIds.push(...actors.map((actor) => actor.id));

    const action = await requestTripFinancialChange({
      tripId: trip.id,
      reason: 'Đối soát lại phụ phí nhiên liệu đã thay đổi',
      figures: {
        legs: [],
        fuelMode: FuelMode.AUTO,
        fuelSupplementLiters: 0,
        tollsDiscount: 0,
        tollsAddition: 0,
        tollsStations: 0,
        hasReturnCargo: false,
        revenue: 2_100_000,
      },
      makerId: actors[0]!.id,
      makerRole: Role.MANAGER,
      expectedTripVersion: completed.version,
    });
    const checked = await checkGovernanceAction({
      actionId: action.id,
      checkerId: actors[1]!.id,
      checkerRole: Role.ACCOUNTANT,
      expectedVersion: action.version,
    });
    await approveGovernanceAction({
      actionId: action.id,
      approverId: actors[2]!.id,
      approverRole: Role.ADMIN,
      expectedVersion: checked.version,
    });

    const [updated] = await db.select({
      fuelSurchargeAmount: s.trips.fuelSurchargeAmount,
      fuelSurchargeSnapshot: s.trips.fuelSurchargeSnapshot,
      fuelSurchargeSnapshotDirty: s.trips.fuelSurchargeSnapshotDirty,
      arSnapshotDirty: s.trips.arSnapshotDirty,
      apSnapshotDirty: s.trips.apSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    // This fixture has no configured customer share, so the governed correction
    // recomputes to zero. The prior 321,000 remains auditable in the reversal
    // ledger entry while the fresh posting carries the reconciled amount.
    assert.equal(updated?.fuelSurchargeAmount, '0');
    assert.notEqual(updated?.fuelSurchargeSnapshot?.computedAt, historicalComputedAt);
    assert.equal(updated?.fuelSurchargeSnapshotDirty, false);
    assert.equal(updated?.arSnapshotDirty, true);
    assert.equal(updated?.apSnapshotDirty, false);
  });

  test('a real PostgreSQL statement failure during AP capture degrades without aborting completion', async () => {
    const { trip } = await createTripFixture();
    const originalCapture = ApSnapshotService.captureSnapshot;
    ApSnapshotService.captureSnapshot = (async (
      _tripId: number,
      tx: Parameters<typeof originalCapture>[1],
    ) => {
      await tx.execute(sql`SELECT 1 / 0`);
    }) as typeof ApSnapshotService.captureSnapshot;

    try {
      const completed = await completeTripGoverned(trip.id, trip.version);
      assert.equal(completed.status, TripStatus.COMPLETED);

      const [updated] = await db.select({
        status: s.trips.status,
        apCostHash: s.trips.apCostHash,
        apSnapshotDirty: s.trips.apSnapshotDirty,
      }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
      assert.equal(updated?.status, TripStatus.COMPLETED);
      assert.equal(updated?.apCostHash, null);
      assert.equal(updated?.apSnapshotDirty, true);
    } finally {
      ApSnapshotService.captureSnapshot = originalCapture;
    }
  });
});
