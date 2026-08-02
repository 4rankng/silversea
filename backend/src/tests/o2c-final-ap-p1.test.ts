import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';
import { Role, TripStatus, TxnType } from '@tingting/shared';

import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { requestTripExpenseDecision } from '../services/approval.service';
import {
  approveGovernanceAction,
  checkGovernanceAction,
  requestTripFinancialClose,
} from '../services/adjustment-governance.service';
import { ApSnapshotService } from '../services/ap-snapshot.service';
import { SnapshotServices } from '../services/snapshot-services';

const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdExpenseTypeIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdUserIds: number[] = [];
const createdDriverIds: number[] = [];

before(async () => {
  const columns = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'trips'
      AND column_name IN ('ap_cost_hash', 'ap_snapshot_dirty', 'ap_snapshot_changed_at')
  `);
  assert.equal(columns.length, 3);
});

after(async () => {
  if (createdExpenseIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.subjectId, createdExpenseIds));
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.tripGpsCaptureJobs).where(inArray(s.tripGpsCaptureJobs.tripId, createdTripIds));
    await db.delete(s.notifications).where(inArray(s.notifications.relatedEntityId, createdTripIds));
    await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.tripId, createdTripIds));
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.subjectId, createdTripIds));
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, [...createdTripIds, ...createdExpenseIds]));
    await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.tripId, createdTripIds));
    await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.tripId, createdTripIds));
    await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
    await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.tripId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdExpenseTypeIds.length > 0) {
    await db.delete(s.forwarderExpenseTypes)
      .where(inArray(s.forwarderExpenseTypes.id, createdExpenseTypeIds));
  }
  if (createdDriverIds.length > 0) {
    await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
  }
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

async function createDriverFixture(suffix: string) {
  const [driverUser] = await db.insert(s.users).values({
    username: `o2c-ap-driver-${suffix}`,
    passwordHash: 'x',
    role: Role.DRIVER,
  }).returning();
  createdUserIds.push(driverUser.id);
  const [driver] = await db.insert(s.drivers).values({
    userId: driverUser.id,
    name: `O2C AP driver ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  createdDriverIds.push(driver.id);
  return { driver, driverUser };
}

async function createActors(prefix: string) {
  const suffix = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const actors = await db.insert(s.users).values([
    { username: `${suffix}-maker`, passwordHash: 'x', role: Role.MANAGER },
    { username: `${suffix}-checker`, passwordHash: 'x', role: Role.ACCOUNTANT },
    { username: `${suffix}-approver-a`, passwordHash: 'x', role: Role.ADMIN },
    { username: `${suffix}-approver-b`, passwordHash: 'x', role: Role.ADMIN },
  ]).returning({ id: s.users.id, role: s.users.role });
  createdUserIds.push(...actors.map((actor) => actor.id));
  return {
    makerId: actors[0]!.id,
    checkerId: actors[1]!.id,
    approverAId: actors[2]!.id,
    approverBId: actors[3]!.id,
  };
}

async function createTripFixture(input?: {
  carrierType?: 'OWN' | 'EXTERNAL';
  fuelCost?: string;
  externalFreightCost?: string;
  expenseApprovalStatus?: 'APPROVED' | 'PENDING';
}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [customer] = await db.insert(s.customers).values({
    name: `O2C AP customer ${suffix}`,
  }).returning();
  const [fuelSupplier] = await db.insert(s.suppliers).values({
    name: `O2C AP fuel supplier ${suffix}`,
  }).returning();
  const [expenseSupplier] = await db.insert(s.suppliers).values({
    name: `O2C AP expense supplier ${suffix}`,
  }).returning();
  const [route] = await db.insert(s.routes).values({
    name: `O2C AP route ${suffix}`,
  }).returning();
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `O2C AP cargo ${suffix}`,
  }).returning();
  createdCustomerIds.push(customer.id);
  createdSupplierIds.push(fuelSupplier.id, expenseSupplier.id);
  createdRouteIds.push(route.id);
  createdCargoTypeIds.push(cargoType.id);

  const { driver, driverUser } = await createDriverFixture(suffix);
  const carrierType = input?.carrierType ?? 'OWN';
  const [trip] = await db.insert(s.trips).values({
    tripCode: `AP-P1-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    driverId: driver.id,
    status: TripStatus.IN_TRANSIT,
    departureDate: '2026-08-02',
    revenue: '2100000',
    driverSalary: '120000',
    carrierType,
    externalEntityId: carrierType === 'EXTERNAL' ? customer.id : null,
    externalEntityType: carrierType === 'EXTERNAL' ? 'CUSTOMER' : null,
    externalFreightCost: carrierType === 'EXTERNAL' ? (input?.externalFreightCost ?? '900000') : null,
    fuelSupplierId: fuelSupplier.id,
    totalFuelCost: input?.fuelCost ?? '500000',
    podRecoveredAt: new Date(),
    podRecoveredBy: driverUser.id,
  }).returning();
  createdTripIds.push(trip.id);

  await db.insert(s.tripPhotos).values({
    tripId: trip.id,
    type: 'OTHER',
    storageKey: `test-photos/o2c-final-ap-p1-${trip.id}-${suffix}.jpg`,
    uploadedBy: driverUser.id,
  });

  const [expenseType] = await db.insert(s.forwarderExpenseTypes).values({
    code: `O2C-AP-${suffix}`.slice(0, 50),
    name: `O2C AP expense type ${suffix}`,
    requiresInvoice: false,
    substituteEvidenceAllowed: true,
    noInvoiceEvidenceTypes: ['RECEIPT'],
  }).returning();
  createdExpenseTypeIds.push(expenseType.id);

  const [expense] = await db.insert(s.tripExpenses).values({
    tripId: trip.id,
    createdBy: driverUser.id,
    expenseType: expenseType.code,
    buyAmount: '300000',
    sellAmount: '360000',
    settlementMethod: 'COMPANY_DIRECT',
    supplierId: expenseSupplier.id,
    expenseDate: '2026-08-02',
    payeeName: `O2C AP payee ${suffix}`,
    note: 'Chi hộ NCC cần theo dõi AP',
    noInvoiceEvidenceTypes: ['RECEIPT'],
    approvalStatus: input?.expenseApprovalStatus ?? 'APPROVED',
  }).returning();
  createdExpenseIds.push(expense.id);

  return { trip, customer, fuelSupplier, expenseSupplier, expense };
}

async function completeTripGoverned(tripId: number, expectedVersion: number) {
  const actors = await createActors('trip-close');
  const action = await requestTripFinancialClose({
    tripId,
    reason: 'Hoàn thành chuyến để chụp AP snapshot',
    makerId: actors.makerId,
    makerRole: Role.MANAGER,
    expectedTripVersion: expectedVersion,
  });
  const checked = await checkGovernanceAction({
    actionId: action.id,
    checkerId: actors.checkerId,
    checkerRole: Role.ACCOUNTANT,
    expectedVersion: action.version,
  });
  await approveGovernanceAction({
    actionId: action.id,
    approverId: actors.approverAId,
    approverRole: Role.ADMIN,
    expectedVersion: checked.version,
  });
}

async function governTripExpenseApproval(tripId: number, expenseId: number, expectedVersion: number) {
  const actors = await createActors('expense-approve');
  const action = await requestTripExpenseDecision({
    tripId,
    expenseId,
    decision: 'APPROVED',
    reason: 'Duyệt chi phí NCC cho chuyến đã hoàn thành',
    evidence: {
      reviewNote: 'Đã đối chiếu chứng từ và số tiền chi hộ',
      attachmentRefs: ['O2C-AP-P1'],
    },
    expectedExpenseVersion: expectedVersion,
    makerId: actors.makerId,
    makerRole: Role.MANAGER,
  });
  const checked = await checkGovernanceAction({
    actionId: action.id,
    checkerId: actors.checkerId,
    checkerRole: Role.ACCOUNTANT,
    expectedVersion: action.version,
  });

  const approve = async (approverId: number) => {
    try {
      await approveGovernanceAction({
        actionId: action.id,
        approverId,
        approverRole: Role.ADMIN,
        expectedVersion: checked.version,
      });
      return { ok: true as const };
    } catch (error) {
      const err = error as Error & { statusCode?: number };
      return { ok: false as const, status: err.statusCode ?? 500, message: err.message };
    }
  };

  return Promise.all([
    approve(actors.approverAId),
    approve(actors.approverBId),
  ]);
}

describe('O2C final AP P1 fixes', () => {
  test('external-trip AP hash includes fuel and approved supplier payables', async () => {
    const { trip, expense } = await createTripFixture({
      carrierType: 'EXTERNAL',
      expenseApprovalStatus: 'APPROVED',
    });
    await completeTripGoverned(trip.id, trip.version);

    await db.transaction(async (tx) => {
      await tx.update(s.tripExpenses)
        .set({ buyAmount: '355000' })
        .where(eq(s.tripExpenses.id, expense.id));
      await SnapshotServices.markBothDirty(trip.id, tx);
    });

    const [updated] = await db.select({
      apSnapshotDirty: s.trips.apSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(updated?.apSnapshotDirty, true);

    await ApSnapshotService.recapture(trip.id);
    await db.transaction(async (tx) => {
      await tx.update(s.trips)
        .set({ totalFuelCost: '650000' })
        .where(eq(s.trips.id, trip.id));
      await SnapshotServices.markBothDirty(trip.id, tx);
    });

    const [fuelUpdated] = await db.select({
      apSnapshotDirty: s.trips.apSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(fuelUpdated?.apSnapshotDirty, true);
  });

  test('late approval on a completed trip posts one vendor payable and dirties both snapshots', async () => {
    const { trip, expense, expenseSupplier } = await createTripFixture({
      expenseApprovalStatus: 'PENDING',
    });
    await completeTripGoverned(trip.id, trip.version);

    const results = await governTripExpenseApproval(trip.id, expense.id, expense.version);
    assert.deepEqual(
      results.map((result) => result.ok).sort(),
      [false, true],
    );
    const rejected = results.find((result) => !result.ok);
    assert.equal(rejected?.status, 409);

    const vendorRows = await db.select().from(s.ledger).where(eq(s.ledger.txnId, expense.id));
    const vendorExpenseRows = vendorRows.filter((row) => (
      row.txnType === TxnType.VENDOR_EXPENSE
      && row.entityType === 'VENDOR'
      && row.entityId === expenseSupplier.id
    ));
    const serviceFeeRows = vendorRows.filter((row) => row.txnType === TxnType.SERVICE_FEE);
    assert.equal(vendorExpenseRows.length, 1);
    assert.equal(vendorExpenseRows[0]?.credit, '300000');
    assert.ok(vendorExpenseRows[0]?.financialPostingId, 'late vendor AP row should keep the active financial posting id');
    assert.equal(serviceFeeRows.length, 1);
    assert.equal(serviceFeeRows[0]?.debit, '360000');

    const [updatedExpense] = await db.select({
      approvalStatus: s.tripExpenses.approvalStatus,
    }).from(s.tripExpenses).where(eq(s.tripExpenses.id, expense.id)).limit(1);
    assert.equal(updatedExpense?.approvalStatus, 'APPROVED');

    const [updatedTrip] = await db.select({
      arSnapshotDirty: s.trips.arSnapshotDirty,
      apSnapshotDirty: s.trips.apSnapshotDirty,
    }).from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(updatedTrip?.arSnapshotDirty, true);
    assert.equal(updatedTrip?.apSnapshotDirty, true);
  });
});
