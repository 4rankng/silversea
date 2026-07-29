import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { TripStatus, TxnType } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { confirmSalary } from '../services/attendance.service';
import {
  approveSalaryPeriodClose,
  approveSalaryPeriodExclusion,
  approveSalaryPeriodReopen,
  checkSalaryPeriodClose,
  checkSalaryPeriodExclusion,
  checkSalaryPeriodReopen,
  closeSalaryPeriod,
  createSalaryPeriodExclusion,
  getSalaryPeriodReadiness,
  issueSalaryPeriodPayslips,
  requestSalaryPeriodClose,
  requestSalaryPeriodReopen,
  reopenSalaryPeriod,
} from '../services/salary-period-close.service';
import {
  approveSalaryPeriodAdjustment,
  checkSalaryPeriodAdjustment,
  getSalaryPeriodAdjustmentTotals,
  listSalaryPeriodAdjustments,
  requestSalaryPeriodAdjustment,
} from '../services/salary-period-adjustment.service';
import { getDriverPayslipPeriods } from '../services/driver.service';
import { syncAttendanceAfterStatusChange } from '../services/trip-attendance-sync.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const periodYear = 6200 + (Number(suffix.split('-')[0]) % 500);
const SOURCE_PERIOD = `${periodYear}-11`;
const TARGET_PERIOD = `${periodYear}-12`;
const UNISSUED_PERIOD = `${periodYear + 1}-01`;
const GOVERNED_PERIOD = `${periodYear}-10`;
const GOVERNED_EXCLUSION_TARGET_PERIOD = `${periodYear}-09`;
const SOURCE_EXCLUSION_TARGET_PERIOD = `${periodYear + 1}-02`;
const GOVERNED_DAY = `${GOVERNED_PERIOD}-08`;
const SOURCE_DAY = `${SOURCE_PERIOD}-12`;
const SOURCE_DAY_2 = `${SOURCE_PERIOD}-14`;
const [, sourceMonth] = SOURCE_PERIOD.split('-').map(Number);

const createdUserIds: number[] = [];
const createdDriverIds: number[] = [];
const createdTripIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdActionIds: number[] = [];
const closePeriods = new Set<string>([GOVERNED_PERIOD, SOURCE_PERIOD, UNISSUED_PERIOD]);
const adjustmentIds: number[] = [];

before(async () => {
  await db.delete(s.salaryPeriodCloses).where(inArray(s.salaryPeriodCloses.period, [...closePeriods]));
  await db.delete(s.periodLocks).where(and(
    eq(s.periodLocks.domain, 'SALARY'),
    inArray(s.periodLocks.periodKey, [...closePeriods]),
  ));
});

async function mkUser(role: 'ADMIN' | 'ACCOUNTANT' | 'MANAGER' | 'DRIVER', tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `q11-${role}-${tag}-${suffix}-${createdUserIds.length}`,
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
    name: `Q11 driver ${tag} ${suffix}`,
    userId: user.id,
    status: 'ACTIVE',
    baseSalary: '12000000',
  }).returning();
  createdDriverIds.push(driver.id);
  return driver;
}

async function mkCatalogs() {
  const [customer] = await db.select({ id: s.customers.id }).from(s.customers).limit(1);
  const [route] = await db.select({ id: s.routes.id }).from(s.routes).limit(1);
  const [cargoType] = await db.select({ id: s.cargoTypes.id }).from(s.cargoTypes).limit(1);
  if (!customer || !route || !cargoType) {
    throw new Error('Missing seeded catalogs for q11 salary post-close test');
  }
  return { customer, route, cargoType };
}

async function mkTrip(input: {
  driverId: number;
  departureDate: string;
  completedAt: Date | null;
  status: TripStatus;
  salary: number;
  tag: string;
}) {
  const catalogs = await mkCatalogs();
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q11-${input.tag}-${suffix}`.slice(0, 50),
    customerId: catalogs.customer.id,
    routeId: catalogs.route.id,
    cargoTypeId: catalogs.cargoType.id,
    driverId: input.driverId,
    status: input.status,
    departureDate: input.departureDate,
    completedAt: input.completedAt,
    carrierType: 'OWN',
    driverSalary: String(input.salary),
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
    if (adjustmentIds.length > 0) {
      await db.delete(s.salaryPeriodAdjustments).where(inArray(s.salaryPeriodAdjustments.id, adjustmentIds));
    }
    if (createdActionIds.length > 0) {
      await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, createdActionIds));
    }
    if (closePeriods.size > 0) {
      await db.delete(s.salaryPeriodCloses).where(inArray(s.salaryPeriodCloses.period, [...closePeriods]));
      await db.delete(s.periodLocks).where(and(
        eq(s.periodLocks.domain, 'SALARY'),
        inArray(s.periodLocks.periodKey, [...closePeriods]),
      ));
    }
    if (createdLedgerIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    }
    if (createdDriverIds.length > 0) {
      await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.driverId, createdDriverIds));
      await db.delete(s.salaryConfirmations).where(inArray(s.salaryConfirmations.driverId, createdDriverIds));
    }
    if (createdTripIds.length > 0) {
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdDriverIds.length > 0) {
      await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (err) {
    console.warn('[q11-salary-post-close] cleanup partial:', (err as Error).message);
  }
  await client.end();
});

test('Q15 salary period close and reopen require three distinct actors before the period state changes', async () => {
  const admin = await mkUser('ADMIN', 'gov-admin');
  const admin2 = await mkUser('ADMIN', 'gov-admin2');
  const accountant = await mkUser('ACCOUNTANT', 'gov-acct');
  const manager = await mkUser('MANAGER', 'gov-mgr');
  const manager2 = await mkUser('MANAGER', 'gov-mgr2');
  const driver = await mkDriver('governed');

  const trip = await mkTrip({
    driverId: driver.id,
    departureDate: GOVERNED_DAY,
    completedAt: new Date(`${GOVERNED_DAY}T10:00:00.000Z`),
    status: TripStatus.COMPLETED,
    salary: 1_800_000,
    tag: 'governed',
  });

  await postDriverSalary(trip.id, driver.id, 1_800_000, 'q15 governed salary');
  await confirmSalary(driver.id, periodYear, 10, accountant.id);
  await syncAttendanceAfterStatusChange(
    trip.id,
    TripStatus.COMPLETED,
    driver.id,
    GOVERNED_DAY,
    null,
    admin.id,
  );

  const readiness = await getSalaryPeriodReadiness(GOVERNED_PERIOD);
  const unrelatedPendingDrivers = readiness.drivers.filter((item) =>
    item.driverId !== driver.id && item.status === 'PENDING' && item.exclusion == null);
  for (const pendingDriver of unrelatedPendingDrivers) {
    const requested = await createSalaryPeriodExclusion({
      period: GOVERNED_PERIOD,
      driverId: pendingDriver.driverId,
      actorId: accountant.id,
      actorRole: 'ACCOUNTANT',
      reason: `Loại trừ tạm để cô lập ca kiểm thử Q15 cho ${pendingDriver.driverName}`,
      handlingMode: 'SUPPLEMENTARY_PERIOD',
      targetPeriod: GOVERNED_EXCLUSION_TARGET_PERIOD,
      note: 'q15 isolation supplementary',
    });
    createdActionIds.push(requested.actionId);
    const checked = await checkSalaryPeriodExclusion({
      actionId: requested.actionId,
      actorId: manager.id,
      actorRole: 'MANAGER',
      expectedVersion: requested.version,
    });
    const approved = await approveSalaryPeriodExclusion({
      actionId: checked.actionId,
      actorId: admin.id,
      actorRole: 'ADMIN',
      expectedVersion: checked.version,
    });
    assert.equal(approved.status, 'APPROVED');
  }

  const closeRequest = await requestSalaryPeriodClose({
    period: GOVERNED_PERIOD,
    actorId: accountant.id,
    actorRole: 'ACCOUNTANT',
    note: 'q15 close request',
  });
  createdActionIds.push(closeRequest.id);

  const [beforeCheckClose] = await db.select()
    .from(s.salaryPeriodCloses)
    .where(eq(s.salaryPeriodCloses.period, GOVERNED_PERIOD))
    .limit(1);
  assert.equal(beforeCheckClose, undefined, 'maker request must not close the period directly');

  await assert.rejects(
    () => checkSalaryPeriodClose({
      period: GOVERNED_PERIOD,
      actionId: closeRequest.id,
      actorId: accountant.id,
      actorRole: 'ACCOUNTANT',
      expectedVersion: closeRequest.version,
    }),
    (err: Error & { statusCode?: number }) => err.statusCode === 403,
  );

  const checkedClose = await checkSalaryPeriodClose({
    period: GOVERNED_PERIOD,
    actionId: closeRequest.id,
    actorId: manager.id,
    actorRole: 'MANAGER',
    expectedVersion: closeRequest.version,
  });
  assert.equal(checkedClose.status, 'PENDING_APPROVAL');

  const [afterCheckClose] = await db.select()
    .from(s.salaryPeriodCloses)
    .where(eq(s.salaryPeriodCloses.period, GOVERNED_PERIOD))
    .limit(1);
  assert.equal(afterCheckClose, undefined, 'checker step must not close the period directly');

  await assert.rejects(
    () => approveSalaryPeriodClose({
      period: GOVERNED_PERIOD,
      actionId: closeRequest.id,
      actorId: manager.id,
      actorRole: 'MANAGER',
      expectedVersion: checkedClose.version,
    }),
    (err: Error & { statusCode?: number }) => err.statusCode === 403,
  );

  await assert.rejects(
    () => approveSalaryPeriodClose({
      period: GOVERNED_PERIOD,
      actionId: closeRequest.id,
      actorId: admin.id,
      actorRole: 'ADMIN',
      expectedVersion: closeRequest.version,
    }),
    (err: Error & { statusCode?: number }) => err.statusCode === 409,
  );

  const approvedClose = await approveSalaryPeriodClose({
    period: GOVERNED_PERIOD,
    actionId: closeRequest.id,
    actorId: admin.id,
    actorRole: 'ADMIN',
    expectedVersion: checkedClose.version,
  });
  assert.equal(approvedClose.status, 'APPROVED');

  const [closedRow] = await db.select({
    status: s.salaryPeriodCloses.status,
    version: s.salaryPeriodCloses.version,
  })
    .from(s.salaryPeriodCloses)
    .where(eq(s.salaryPeriodCloses.period, GOVERNED_PERIOD))
    .limit(1);
  assert.equal(closedRow?.status, 'CLOSED');
  closePeriods.add(GOVERNED_PERIOD);

  await assert.rejects(
    () => requestSalaryPeriodReopen({
      period: GOVERNED_PERIOD,
      actorId: manager2.id,
      actorRole: 'MANAGER',
      expectedVersion: closedRow!.version,
      reason: '   ',
      note: '   ',
    }),
    (err: Error & { statusCode?: number }) => err.statusCode === 400,
  );

  await assert.rejects(
    () => requestSalaryPeriodReopen({
      period: GOVERNED_PERIOD,
      actorId: accountant.id,
      actorRole: 'ACCOUNTANT',
      expectedVersion: closedRow!.version,
      note: 'accountant cannot request reopen',
    }),
    (err: Error & { statusCode?: number }) => err.statusCode === 403,
  );

  const reopenRequest = await requestSalaryPeriodReopen({
    period: GOVERNED_PERIOD,
    actorId: manager2.id,
    actorRole: 'MANAGER',
    expectedVersion: closedRow!.version,
    note: 'q15 reopen request',
  });
  createdActionIds.push(reopenRequest.id);

  await assert.rejects(
    () => checkSalaryPeriodReopen({
      period: GOVERNED_PERIOD,
      actionId: reopenRequest.id,
      actorId: manager2.id,
      actorRole: 'MANAGER',
      expectedVersion: reopenRequest.version,
    }),
    (err: Error & { statusCode?: number }) => err.statusCode === 403,
  );

  const checkedReopen = await checkSalaryPeriodReopen({
    period: GOVERNED_PERIOD,
    actionId: reopenRequest.id,
    actorId: admin2.id,
    actorRole: 'ADMIN',
    expectedVersion: reopenRequest.version,
  });
  assert.equal(checkedReopen.status, 'PENDING_APPROVAL');

  const [stillClosedRow] = await db.select({ status: s.salaryPeriodCloses.status })
    .from(s.salaryPeriodCloses)
    .where(eq(s.salaryPeriodCloses.period, GOVERNED_PERIOD))
    .limit(1);
  assert.equal(stillClosedRow?.status, 'CLOSED', 'reopen request and check must not reopen directly');

  await assert.rejects(
    () => approveSalaryPeriodReopen({
      period: GOVERNED_PERIOD,
      actionId: reopenRequest.id,
      actorId: admin2.id,
      actorRole: 'ADMIN',
      expectedVersion: checkedReopen.version,
    }),
    (err: Error & { statusCode?: number }) => err.statusCode === 403,
  );

  await assert.rejects(
    () => approveSalaryPeriodReopen({
      period: GOVERNED_PERIOD,
      actionId: reopenRequest.id,
      actorId: manager.id,
      actorRole: 'MANAGER',
      expectedVersion: reopenRequest.version,
    }),
    (err: Error & { statusCode?: number }) => err.statusCode === 409,
  );

  const approvedReopen = await approveSalaryPeriodReopen({
    period: GOVERNED_PERIOD,
    actionId: reopenRequest.id,
    actorId: manager.id,
    actorRole: 'MANAGER',
    expectedVersion: checkedReopen.version,
  });
  assert.equal(approvedReopen.status, 'APPROVED');

  const [reopenedRow] = await db.select({ status: s.salaryPeriodCloses.status })
    .from(s.salaryPeriodCloses)
    .where(eq(s.salaryPeriodCloses.period, GOVERNED_PERIOD))
    .limit(1);
  assert.equal(reopenedRow?.status, 'REOPENED');
});

test('Q11 post-close issue/adjustment flow and Q20 readiness regression stay green', async () => {
  const admin = await mkUser('ADMIN', 'admin');
  const accountant = await mkUser('ACCOUNTANT', 'acct');
  const manager = await mkUser('MANAGER', 'mgr');
  const driver = await mkDriver('source');

  const completedTrip = await mkTrip({
    driverId: driver.id,
    departureDate: SOURCE_DAY,
    completedAt: new Date(`${SOURCE_DAY}T10:00:00.000Z`),
    status: TripStatus.COMPLETED,
    salary: 2_400_000,
    tag: 'completed',
  });
  const inTransitTrip = await mkTrip({
    driverId: driver.id,
    departureDate: SOURCE_DAY_2,
    completedAt: null,
    status: TripStatus.CREATED,
    salary: 9_999_999,
    tag: 'created-should-not-count',
  });

  await postDriverSalary(completedTrip.id, driver.id, 2_400_000, 'q11 completed salary');
  await confirmSalary(driver.id, periodYear, sourceMonth, accountant.id);
  await syncAttendanceAfterStatusChange(
    completedTrip.id,
    TripStatus.COMPLETED,
    driver.id,
    SOURCE_DAY,
    null,
    admin.id,
  );

  const readiness = await getSalaryPeriodReadiness(SOURCE_PERIOD);
  const driverReadiness = readiness.drivers.find((item) => item.driverId === driver.id);
  assert.equal(driverReadiness?.status, 'READY');
  assert.equal(
    driverReadiness?.issues.some((issue) => issue.code === 'MISSING_TRIP_DAY'),
    false,
    'CREATED / non-completed trips must not be treated as completed-period blockers',
  );

  const unrelatedPendingDrivers = readiness.drivers.filter((item) =>
    item.driverId !== driver.id && item.status === 'PENDING' && item.exclusion == null);
  for (const pendingDriver of unrelatedPendingDrivers) {
    const requested = await createSalaryPeriodExclusion({
      period: SOURCE_PERIOD,
      driverId: pendingDriver.driverId,
      actorId: accountant.id,
      actorRole: 'ACCOUNTANT',
      reason: `Loại trừ tạm để cô lập ca kiểm thử Q11 cho ${pendingDriver.driverName}`,
      handlingMode: 'SUPPLEMENTARY_PERIOD',
      targetPeriod: SOURCE_EXCLUSION_TARGET_PERIOD,
      note: 'q11 isolation supplementary',
    });
    createdActionIds.push(requested.actionId);

    await checkSalaryPeriodExclusion({
      actionId: requested.actionId,
      actorId: manager.id,
      actorRole: 'MANAGER',
      expectedVersion: requested.version,
    });

    await approveSalaryPeriodExclusion({
      actionId: requested.actionId,
      actorId: admin.id,
      actorRole: 'ADMIN',
      expectedVersion: requested.version + 1,
    });
  }

  const closed = await closeSalaryPeriod({
    period: SOURCE_PERIOD,
    actorId: accountant.id,
    actorRole: 'ACCOUNTANT',
    note: `q11 close ${suffix}`,
  });
  closePeriods.add(SOURCE_PERIOD);
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.periodTotalSalary, 2_400_000);

  const issued = await issueSalaryPeriodPayslips({
    period: SOURCE_PERIOD,
    actorId: accountant.id,
    actorRole: 'ACCOUNTANT',
    expectedVersion: closed.version,
    note: `Phát hành phiếu lương kỳ ${SOURCE_PERIOD}`,
  });
  assert.ok(issued.payslipIssuedAt);
  assert.ok(issued.version > closed.version);

  await assert.rejects(
    () => reopenSalaryPeriod({
      period: SOURCE_PERIOD,
      actorId: manager.id,
      actorRole: 'MANAGER',
      expectedVersion: issued.version,
      note: 'giamdoc reopen after issue',
    }),
    (err: Error & { statusCode?: number }) =>
      err.statusCode === 409 && /phát hành phiếu lương/i.test(err.message),
  );

  const requested = await requestSalaryPeriodAdjustment({
    sourcePeriod: SOURCE_PERIOD,
    targetPeriod: TARGET_PERIOD,
    driverId: driver.id,
    amount: 450_000,
    reason: `Bổ sung công chuyến sau khi đã phát hành phiếu lương kỳ ${SOURCE_PERIOD}`,
    actorId: accountant.id,
    actorRole: 'ACCOUNTANT',
    expectedVersion: issued.version,
  });
  createdActionIds.push(requested.actionId);
  assert.equal(requested.status, 'PENDING_CHECK');

  const checked = await checkSalaryPeriodAdjustment({
    period: SOURCE_PERIOD,
    actionId: requested.actionId,
    actorId: manager.id,
    actorRole: 'MANAGER',
    expectedVersion: requested.version,
  });
  assert.equal(checked.status, 'PENDING_APPROVAL');

  const approved = await approveSalaryPeriodAdjustment({
    period: SOURCE_PERIOD,
    actionId: requested.actionId,
    actorId: admin.id,
    actorRole: 'ADMIN',
    expectedVersion: checked.version,
  });
  assert.equal(approved.status, 'APPROVED');
  assert.ok(approved.adjustmentId);
  adjustmentIds.push(approved.adjustmentId!);

  const totals = await getSalaryPeriodAdjustmentTotals(TARGET_PERIOD, [driver.id]);
  assert.equal(totals.get(driver.id), 450_000);

  const targetItems = await listSalaryPeriodAdjustments({ period: TARGET_PERIOD, driverId: driver.id });
  assert.equal(targetItems.length, 1);
  assert.equal(targetItems[0]?.relationship, 'TARGET');
  assert.equal(targetItems[0]?.sourcePeriod, SOURCE_PERIOD);
  assert.equal(targetItems[0]?.targetPeriod, TARGET_PERIOD);
  assert.equal(targetItems[0]?.status, 'APPROVED');

  const [unissuedClose] = await db.insert(s.salaryPeriodCloses).values({
    period: UNISSUED_PERIOD,
    status: 'CLOSED',
    closedBy: accountant.id,
    note: 'unissued should stay hidden from driver payslips',
  }).returning();
  closePeriods.add(UNISSUED_PERIOD);
  assert.equal(unissuedClose.payslipIssuedAt, null);

  const payslips = await getDriverPayslipPeriods(driver.id);
  assert.deepEqual(
    payslips.map((item) => item.period),
    [SOURCE_PERIOD],
    'driver payslip list should expose only issued salary periods',
  );

  // Keep the created-but-not-completed trip alive through the whole flow so the
  // Q20 regression stays covered after issue/reopen/adjustment changes.
  assert.equal(inTransitTrip.status, TripStatus.CREATED);
});
