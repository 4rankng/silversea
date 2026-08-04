import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { TripStatus, TxnType } from '@tingting/shared';
import {
  approveSalaryPeriodExclusion,
  checkSalaryPeriodExclusion,
  closeSalaryPeriod,
  completeSalaryPeriodExclusionFollowup,
  createSalaryPeriodExclusion,
  getSalaryPeriodReadiness,
  listSalaryPeriodExclusions,
  reopenSalaryPeriod,
} from '../services/salary-period-close.service';
import {
  batchUpsertWorkDays,
  confirmSalary,
  getWorkDays,
} from '../services/attendance.service';
import {
  approveSalaryPeriodAdjustment,
  checkSalaryPeriodAdjustment,
  requestSalaryPeriodAdjustment,
} from '../services/salary-period-adjustment.service';
import { syncAttendanceAfterStatusChange } from '../services/trip-attendance-sync.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const periodYear = 3600 + (Number(suffix.split('-')[0]) % 1000);
const periodMonth = (Number(suffix.split('-')[0]) % 12) + 1;
const PERIOD = `${periodYear}-${String(periodMonth).padStart(2, '0')}`;
const supplementaryDate = new Date(Date.UTC(periodYear, periodMonth, 1));
const SUPPLEMENTARY_YEAR = supplementaryDate.getUTCFullYear();
const SUPPLEMENTARY_MONTH = supplementaryDate.getUTCMonth() + 1;
const SUPPLEMENTARY_PERIOD = `${SUPPLEMENTARY_YEAR}-${String(SUPPLEMENTARY_MONTH).padStart(2, '0')}`;
const PERIOD_START = `${PERIOD}-01`;
const PREV_PERIOD_END = new Date(Date.UTC(periodYear, periodMonth - 1, 0)).toISOString().slice(0, 10);
const MID_PERIOD_DAY = `${PERIOD}-15`;
const MID_PERIOD_DAY_2 = `${PERIOD}-16`;

const createdUserIds: number[] = [];
const createdDriverIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdTripIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdGovernanceActionIds: number[] = [];
const createdClosePeriods = new Set<string>();
let testCatalogs: {
  customer: { id: number };
  route: { id: number };
  cargoType: { id: number };
} | null = null;

async function mkUser(role: 'ADMIN' | 'ACCOUNTANT' | 'MANAGER' | 'DRIVER', tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `m73-${role}-${tag}-${suffix}-${createdUserIds.length}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

async function mkDriver(tag: string) {
  const user = await mkUser('DRIVER', tag);
  const [driver] = await db.insert(s.drivers).values({
    name: `M73 driver ${tag} ${suffix}`,
    userId: user.id,
    status: 'ACTIVE',
    baseSalary: '12000000',
  }).returning();
  createdDriverIds.push(driver.id);
  return driver;
}

async function mkCatalogs() {
  if (testCatalogs) return testCatalogs;
  const [customer] = await db.insert(s.customers)
    .values({ name: `M73 customer ${suffix}` })
    .returning({ id: s.customers.id });
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `M73 route ${suffix}` })
    .returning({ id: s.routes.id });
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `M73 cargo ${suffix}` })
    .returning({ id: s.cargoTypes.id });
  createdCargoTypeIds.push(cargoType.id);
  testCatalogs = { customer, route, cargoType };
  return testCatalogs;
}

async function mkTrip(
  driverId: number,
  departureDate: string,
  completedAt: Date,
  tag: string,
  amounts: { salary: number },
) {
  const catalogs = await mkCatalogs();
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M73-${tag}-${suffix}`.slice(0, 50),
    customerId: catalogs.customer.id,
    routeId: catalogs.route.id,
    cargoTypeId: catalogs.cargoType.id,
    driverId,
    status: 'COMPLETED',
    departureDate,
    completedAt,
    carrierType: 'OWN',
    driverSalary: String(amounts.salary),
    revenue: '0',
    totalRoadAllowance: '0',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function postDriverSalary(tripId: number, driverId: number, amount: number, note: string) {
  const [entry] = await db.insert(s.ledger).values({
    entityType: 'DRIVER',
    entityId: driverId,
    txnType: TxnType.DRIVER_SALARY,
    txnId: tripId,
    debit: '0',
    credit: String(amount),
    balance: String(amount),
    timestamp: new Date(),
    note,
  }).returning();
  createdLedgerIds.push(entry.id);
  return entry;
}

after(async () => {
  try {
    if (createdGovernanceActionIds.length > 0) {
      await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, createdGovernanceActionIds));
    }
    if (createdClosePeriods.size > 0) {
      await db.delete(s.salaryPeriodCloses).where(inArray(s.salaryPeriodCloses.period, [...createdClosePeriods]));
      await db.delete(s.periodLocks).where(and(
        eq(s.periodLocks.domain, 'SALARY'),
        inArray(s.periodLocks.periodKey, [...createdClosePeriods]),
      ));
    }
    if (createdDriverIds.length > 0) {
      await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.driverId, createdDriverIds));
      await db.delete(s.salaryConfirmations).where(inArray(s.salaryConfirmations.driverId, createdDriverIds));
    }
    if (createdLedgerIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    }
    if (createdTripIds.length > 0) {
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
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
    if (createdDriverIds.length > 0) {
      await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (err) {
    console.warn('[m73] cleanup partial:', (err as Error).message);
  }
  await client.end();
});

test('M7.3 payroll close enforces readiness, approved exclusions, completion-period totals, actual-date attendance, and payout-gated reopen', async () => {
  const admin = await mkUser('ADMIN', 'admin');
  const accountant = await mkUser('ACCOUNTANT', 'acct');
  const manager = await mkUser('MANAGER', 'mgr');
  const readyDriver = await mkDriver('ready');
  const excludedDriver = await mkDriver('excluded');
  const crossMidnightDriver = await mkDriver('cross-midnight');

  const readyTrip = await mkTrip(
    readyDriver.id,
    MID_PERIOD_DAY,
    new Date(`${MID_PERIOD_DAY}T05:00:00.000Z`),
    'ready',
    { salary: 3_000_000 },
  );
  const excludedTrip = await mkTrip(
    excludedDriver.id,
    MID_PERIOD_DAY_2,
    new Date(`${MID_PERIOD_DAY_2}T07:00:00.000Z`),
    'excluded',
    { salary: 2_500_000 },
  );
  const crossMidnightTrip = await mkTrip(
    crossMidnightDriver.id,
    PREV_PERIOD_END,
    new Date(`${PREV_PERIOD_END}T18:30:00.000Z`),
    'cross',
    { salary: 1_700_000 },
  );

  await postDriverSalary(readyTrip.id, readyDriver.id, 3_000_000, 'm73 ready');
  await postDriverSalary(excludedTrip.id, excludedDriver.id, 2_500_000, 'm73 excluded');
  await postDriverSalary(crossMidnightTrip.id, crossMidnightDriver.id, 1_700_000, 'm73 cross midnight');

  await confirmSalary(readyDriver.id, periodYear, periodMonth, accountant.id);
  await confirmSalary(crossMidnightDriver.id, periodYear, periodMonth, accountant.id);
  await syncAttendanceAfterStatusChange(
    readyTrip.id,
    TripStatus.COMPLETED,
    readyDriver.id,
    MID_PERIOD_DAY,
    null,
    admin.id,
  );
  await syncAttendanceAfterStatusChange(
    excludedTrip.id,
    TripStatus.COMPLETED,
    excludedDriver.id,
    MID_PERIOD_DAY_2,
    null,
    admin.id,
  );

  const invalidLeave = await batchUpsertWorkDays(readyDriver.id, [
    { date: MID_PERIOD_DAY, status: 'PERSONAL_LEAVE', note: null },
    { date: MID_PERIOD_DAY_2, status: 'TRIP_DAY', note: 'manual' },
  ], accountant.id);
  assert.equal(invalidLeave[0]?.action, 'rejected');
  assert.equal(invalidLeave[1]?.action, 'rejected');

  await syncAttendanceAfterStatusChange(
    crossMidnightTrip.id,
    TripStatus.COMPLETED,
    crossMidnightDriver.id,
    PREV_PERIOD_END,
    null,
    admin.id,
  );
  const crossMidnightDays = await getWorkDays(crossMidnightDriver.id, PREV_PERIOD_END, PERIOD_START);
  assert.deepEqual(
    crossMidnightDays.map((row) => row.date),
    [PREV_PERIOD_END, PERIOD_START],
    'attendance sync records both actual trip dates across midnight',
  );
  assert.ok(crossMidnightDays.every((row) => row.status === 'TRIP_DAY'));

  const readiness = await getSalaryPeriodReadiness(PERIOD);
  const readyEntry = readiness.drivers.find((driver) => driver.driverId === readyDriver.id);
  const excludedEntry = readiness.drivers.find((driver) => driver.driverId === excludedDriver.id);
  const crossEntry = readiness.drivers.find((driver) => driver.driverId === crossMidnightDriver.id);
  assert.equal(readyEntry?.status, 'READY');
  assert.equal(crossEntry?.status, 'READY');
  assert.equal(excludedEntry?.status, 'PENDING');
  assert.ok(excludedEntry?.issues.some((issue) => issue.code === 'UNCONFIRMED_SALARY'));

  await assert.rejects(
      () => closeSalaryPeriod({ period: PERIOD, actorId: accountant.id, actorRole: 'ACCOUNTANT', note: `m73 close blocked ${suffix}` }),
    (err: Error & { statusCode?: number }) => err.statusCode === 409 && /chờ xử lý/i.test(err.message),
  );

  const pendingDrivers = readiness.drivers.filter((driver) => driver.status === 'PENDING');
  const approvedExclusions = [];
  for (const pendingDriver of pendingDrivers) {
    const requested = await createSalaryPeriodExclusion({
      period: PERIOD,
      driverId: pendingDriver.driverId,
      actorId: accountant.id,
      actorRole: 'ACCOUNTANT',
      reason: `Thiếu xác nhận hoặc còn lỗi tiền cho ${pendingDriver.driverName}`,
      handlingMode: 'SUPPLEMENTARY_PERIOD',
      targetPeriod: SUPPLEMENTARY_PERIOD,
      note: 'm73 supplementary',
    });
    createdGovernanceActionIds.push(requested.actionId);
    assert.equal(requested.status, 'PENDING_CHECK');

    const checked = await checkSalaryPeriodExclusion({
      actionId: requested.actionId,
      actorId: manager.id,
      actorRole: 'MANAGER',
      expectedVersion: requested.version,
    });
    assert.equal(checked.status, 'PENDING_APPROVAL');

    const approved = await approveSalaryPeriodExclusion({
      actionId: requested.actionId,
      actorId: admin.id,
      actorRole: 'ADMIN',
      expectedVersion: checked.version,
    });
    assert.equal(approved.status, 'APPROVED');
    approvedExclusions.push(approved);
  }
  assert.ok(approvedExclusions.some((item) => item.driverId === excludedDriver.id));

  const closed = await closeSalaryPeriod({
    period: PERIOD,
    actorId: accountant.id,
    actorRole: 'ACCOUNTANT',
    note: `m73 close ${suffix}`,
  });
  createdClosePeriods.add(PERIOD);
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.scope, 'COMPANY');
  assert.equal(closed.periodTotalSalary, 7_200_000, 'salary close sums by trip completion period, not departure date');
  assert.equal(closed.excludedDriverIds?.includes(excludedDriver.id), true);

  const excludedAction = approvedExclusions.find((item) => item.driverId === excludedDriver.id)!;
  assert.equal(excludedAction.followupStatus, 'PENDING');
  await assert.rejects(
    () => completeSalaryPeriodExclusionFollowup({
      actionId: excludedAction.actionId,
      actorId: admin.id,
      actorRole: 'ADMIN',
    }),
    (err: Error & { statusCode?: number }) => err.statusCode === 409 && /chưa sẵn sàng/i.test(err.message),
  );
  await confirmSalary(
    excludedDriver.id,
    SUPPLEMENTARY_YEAR,
    SUPPLEMENTARY_MONTH,
    accountant.id,
  );
  const completedFollowup = await completeSalaryPeriodExclusionFollowup({
    actionId: excludedAction.actionId,
    actorId: admin.id,
    actorRole: 'ADMIN',
  });
  assert.equal(completedFollowup.followupStatus, 'COMPLETED');
  assert.ok(completedFollowup.followupCompletedAt);
  const replayedFollowup = await completeSalaryPeriodExclusionFollowup({
    actionId: excludedAction.actionId,
    actorId: manager.id,
    actorRole: 'MANAGER',
  });
  assert.equal(replayedFollowup.followupCompletedAt, completedFollowup.followupCompletedAt);
  const [raceAction] = await db.insert(s.governanceActions).values({
    subjectType: 'SALARY_PERIOD',
    subjectKey: `${PERIOD}:${excludedDriver.id}`,
    actionKind: 'FINANCIAL_EXCEPTION',
    status: 'APPROVED',
    reason: `m73 first-completion race ${suffix}`,
    originalVersion: 1,
    beforeSnapshot: {},
    afterSnapshot: {
      handlingMode: 'SUPPLEMENTARY_PERIOD',
      targetPeriod: SUPPLEMENTARY_PERIOD,
      note: 'Race first completion',
    },
    applicationResult: {
      followupStatus: 'PENDING',
      handlingMode: 'SUPPLEMENTARY_PERIOD',
      targetPeriod: SUPPLEMENTARY_PERIOD,
    },
    makerId: accountant.id,
    makerRole: 'ACCOUNTANT',
    checkerId: manager.id,
    checkerRole: 'MANAGER',
    approverId: admin.id,
    approverRole: 'ADMIN',
    checkedAt: new Date(),
    approvedAt: new Date(),
    version: 3,
  }).returning();
  createdGovernanceActionIds.push(raceAction.id);
  const firstCompletionRace = await Promise.all([
    completeSalaryPeriodExclusionFollowup({
      actionId: raceAction.id,
      actorId: admin.id,
      actorRole: 'ADMIN',
    }),
    completeSalaryPeriodExclusionFollowup({
      actionId: raceAction.id,
      actorId: manager.id,
      actorRole: 'MANAGER',
    }),
  ]);
  assert.ok(firstCompletionRace[0].followupCompletedAt);
  assert.equal(firstCompletionRace[1].followupCompletedAt, firstCompletionRace[0].followupCompletedAt);
  const [completedAction] = await db.select({
    applicationResult: s.governanceActions.applicationResult,
    version: s.governanceActions.version,
  }).from(s.governanceActions)
    .where(eq(s.governanceActions.id, raceAction.id))
    .limit(1);
  assert.equal(completedAction?.version, raceAction.version + 1);
  assert.equal(
    [admin.id, manager.id].includes(
      Number((completedAction?.applicationResult as Record<string, unknown>)?.followupCompletedBy),
    ),
    true,
  );
  const persistedExclusion = (await listSalaryPeriodExclusions(PERIOD))
    .find((item) => item.driverId === excludedDriver.id);
  assert.equal(persistedExclusion?.followupStatus, 'COMPLETED');

  await assert.rejects(
    () => reopenSalaryPeriod({ period: PERIOD, actorId: accountant.id, actorRole: 'ACCOUNTANT', note: `m73 accountant reopen ${suffix}` }),
    (err: Error & { statusCode?: number }) => err.statusCode === 403,
  );

  const [payout] = await db.insert(s.ledger).values({
    entityType: 'DRIVER',
    entityId: readyDriver.id,
    txnType: TxnType.DRIVER_PAYOUT,
    txnId: readyTrip.id,
    debit: '1000000',
    credit: '0',
    balance: '0',
    timestamp: new Date(`${MID_PERIOD_DAY}T10:00:00.000Z`),
    note: 'm73 payout',
  }).returning();
  createdLedgerIds.push(payout.id);

  await assert.rejects(
    () => reopenSalaryPeriod({ period: PERIOD, actorId: admin.id, actorRole: 'ADMIN', note: `m73 payout reopen ${suffix}` }),
    (err: Error & { statusCode?: number }) => err.statusCode === 409 && /thanh toán/i.test(err.message),
  );

  const [lock] = await db.select({ status: s.periodLocks.status })
    .from(s.periodLocks)
    .where(and(
      eq(s.periodLocks.domain, 'SALARY'),
      eq(s.periodLocks.periodKey, PERIOD),
    ))
    .limit(1);
  assert.equal(lock?.status, 'CLOSED');

  const [closeRow] = await db.select({
    note: s.salaryPeriodCloses.note,
    status: s.salaryPeriodCloses.status,
  }).from(s.salaryPeriodCloses)
    .where(eq(s.salaryPeriodCloses.period, PERIOD))
    .limit(1);
  assert.equal(closeRow?.status, 'CLOSED');
  assert.match(closeRow?.note ?? '', /m73 close/);

  const [governanceRow] = await db.select({
    status: s.governanceActions.status,
    approverId: s.governanceActions.approverId,
    checkerId: s.governanceActions.checkerId,
  }).from(s.governanceActions)
    .where(eq(s.governanceActions.id, approvedExclusions.find((item) => item.driverId === excludedDriver.id)!.actionId))
    .limit(1);
  assert.equal(governanceRow?.status, 'APPROVED');
  assert.equal(governanceRow?.checkerId, manager.id);
  assert.equal(governanceRow?.approverId, admin.id);
});

test('Q10 adjustment-mode exclusions stay completable after the approved adjustment exists', async () => {
  const admin = await mkUser('ADMIN', 'adj-admin');
  const accountant = await mkUser('ACCOUNTANT', 'adj-acct');
  const manager = await mkUser('MANAGER', 'adj-mgr');
  const driver = await mkDriver('adj-driver');
  const sourcePeriod = `${periodYear + 2}-03`;
  const sourceDay = `${sourcePeriod}-15`;
  const targetPeriod = `${periodYear + 2}-04`;

  const trip = await mkTrip(
    driver.id,
    sourceDay,
    new Date(`${sourceDay}T05:00:00.000Z`),
    'adj',
    { salary: 2_200_000 },
  );

  await postDriverSalary(trip.id, driver.id, 2_200_000, 'm73 adjustment');
  await syncAttendanceAfterStatusChange(
    trip.id,
    TripStatus.COMPLETED,
    driver.id,
    sourceDay,
    null,
    admin.id,
  );

  const requestedExclusion = await createSalaryPeriodExclusion({
    period: sourcePeriod,
    driverId: driver.id,
    actorId: accountant.id,
    actorRole: 'ACCOUNTANT',
    reason: 'Chuyển xử lý vào khoản điều chỉnh kỳ sau',
    handlingMode: 'ADJUSTMENT',
    note: 'm73 adjustment follow-up',
  });
  createdGovernanceActionIds.push(requestedExclusion.actionId);

  const checkedExclusion = await checkSalaryPeriodExclusion({
    actionId: requestedExclusion.actionId,
    actorId: manager.id,
    actorRole: 'MANAGER',
    expectedVersion: requestedExclusion.version,
  });
  const approvedExclusion = await approveSalaryPeriodExclusion({
    actionId: requestedExclusion.actionId,
    actorId: admin.id,
    actorRole: 'ADMIN',
    expectedVersion: checkedExclusion.version,
  });
  assert.equal(approvedExclusion.followupStatus, 'PENDING');

  await db.insert(s.salaryPeriodCloses).values({
    period: sourcePeriod,
    status: 'CLOSED',
    version: 1,
    closedBy: accountant.id,
    note: `m73 adjustment close ${suffix}`,
  });
  createdClosePeriods.add(sourcePeriod);

  const requestedAdjustment = await requestSalaryPeriodAdjustment({
    sourcePeriod,
    targetPeriod,
    driverId: driver.id,
    amount: 500_000,
    reason: 'Bổ sung điều chỉnh cho lái xe bị loại trừ khỏi kỳ chính',
    actorId: accountant.id,
    actorRole: 'ACCOUNTANT',
    expectedVersion: 1,
  });
  createdGovernanceActionIds.push(requestedAdjustment.actionId);

  const checkedAdjustment = await checkSalaryPeriodAdjustment({
    period: sourcePeriod,
    actionId: requestedAdjustment.actionId,
    actorId: manager.id,
    actorRole: 'MANAGER',
    expectedVersion: requestedAdjustment.version,
  });
  const approvedAdjustment = await approveSalaryPeriodAdjustment({
    period: sourcePeriod,
    actionId: requestedAdjustment.actionId,
    actorId: admin.id,
    actorRole: 'ADMIN',
    expectedVersion: checkedAdjustment.version,
  });
  assert.equal(approvedAdjustment.status, 'APPROVED');

  const completed = await completeSalaryPeriodExclusionFollowup({
    actionId: approvedExclusion.actionId,
    actorId: admin.id,
    actorRole: 'ADMIN',
  });
  assert.equal(completed.followupStatus, 'COMPLETED');
  assert.ok(completed.followupCompletedAt);
});
