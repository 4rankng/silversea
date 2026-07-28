import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { TxnType, type AppSettings } from '@tingting/shared';
import { getAppSettings, saveAppSettings } from '../services/app-settings.service';
import {
  closeSalaryPeriod,
  getSalaryPeriodReadiness,
} from '../services/salary-period-close.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const year = 4200 + (Date.now() % 500);
const month = (Date.now() % 12) + 1;
const period = `${year}-${String(month).padStart(2, '0')}`;
const workDate = `${period}-12`;

const userIds: number[] = [];
const driverIds: number[] = [];
const tripIds: number[] = [];
const ledgerIds: number[] = [];
let businessUnitId: number | null = null;
let originalSettings: AppSettings | null = null;

after(async () => {
  try {
    if (originalSettings) await saveAppSettings(originalSettings);
    await db.delete(s.salaryPeriodCloses).where(eq(s.salaryPeriodCloses.period, period));
    await db.delete(s.periodLocks).where(and(
      eq(s.periodLocks.domain, 'SALARY'),
      eq(s.periodLocks.periodKey, period),
    ));
    if (ledgerIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
    }
    if (driverIds.length > 0) {
      await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.driverId, driverIds));
      await db.delete(s.salaryConfirmations).where(inArray(s.salaryConfirmations.driverId, driverIds));
    }
    if (tripIds.length > 0) {
      await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    }
    if (driverIds.length > 0) {
      await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
    }
    if (businessUnitId != null) {
      await db.delete(s.userBusinessUnitLinks)
        .where(eq(s.userBusinessUnitLinks.businessUnitId, businessUnitId));
      await db.delete(s.businessUnits).where(eq(s.businessUnits.id, businessUnitId));
    }
    if (userIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, userIds));
    }
  } finally {
    await client.end();
  }
});

async function createDriver(tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `q09-${tag}-${suffix}`,
    passwordHash: 'x',
    role: 'DRIVER',
    status: 'ACTIVE',
  }).returning();
  userIds.push(user.id);
  const [driver] = await db.insert(s.drivers).values({
    userId: user.id,
    name: `Q09 ${tag} ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  driverIds.push(driver.id);
  return { user, driver };
}

async function createCompletedSalaryTrip(
  driverId: number,
  amount: number,
  tag: string,
) {
  const [customer] = await db.select({ id: s.customers.id }).from(s.customers).limit(1);
  const [route] = await db.select({ id: s.routes.id }).from(s.routes).limit(1);
  const [cargoType] = await db.select({ id: s.cargoTypes.id }).from(s.cargoTypes).limit(1);
  if (!customer || !route || !cargoType) throw new Error('Thiếu dữ liệu danh mục kiểm thử Q09');

  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q09-${tag}-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    driverId,
    status: 'COMPLETED',
    departureDate: workDate,
    completedAt: new Date(`${workDate}T08:00:00.000Z`),
    carrierType: 'OWN',
    revenue: '0',
    driverSalary: String(amount),
    totalRoadAllowance: '0',
  }).returning();
  tripIds.push(trip.id);

  const [ledger] = await db.insert(s.ledger).values({
    entityType: 'DRIVER',
    entityId: driverId,
    txnType: TxnType.DRIVER_SALARY,
    txnId: trip.id,
    debit: '0',
    credit: String(amount),
    balance: String(amount),
    timestamp: new Date(`${workDate}T08:00:00.000Z`),
    note: `Q09 ${tag}`,
  }).returning();
  ledgerIds.push(ledger.id);

  await db.insert(s.salaryConfirmations).values({
    driverId,
    year,
    month,
    status: 'CONFIRMED',
  });
  await db.insert(s.driverWorkDays).values({
    driverId,
    date: workDate,
    status: 'TRIP_DAY',
    tripId: trip.id,
  });
}

test('Q09 configured payroll unit scopes readiness and close totals to linked drivers', async () => {
  originalSettings = await getAppSettings();
  const [unit] = await db.insert(s.businessUnits).values({
    code: `Q09-${suffix}`.slice(0, 50),
    name: `Đơn vị tính lương Q09 ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  businessUnitId = unit.id;

  const scoped = await createDriver('scoped');
  const outside = await createDriver('outside');
  await db.insert(s.userBusinessUnitLinks).values({
    userId: scoped.user.id,
    businessUnitId: unit.id,
  });
  await createCompletedSalaryTrip(scoped.driver.id, 3_200_000, 'scoped');
  await createCompletedSalaryTrip(outside.driver.id, 8_900_000, 'outside');

  await saveAppSettings({
    ...originalSettings,
    salaryPayrollBusinessUnitId: unit.id,
  });

  const readiness = await getSalaryPeriodReadiness(period);
  assert.equal(readiness.scope, 'BUSINESS_UNIT');
  assert.equal(readiness.businessUnitId, unit.id);
  assert.equal(readiness.businessUnitName, unit.name);
  assert.deepEqual(
    readiness.drivers.map((driver) => driver.driverId),
    [scoped.driver.id],
    'driver outside the configured payroll unit is not silently included',
  );
  assert.equal(readiness.canClose, true);

  const [accountant] = await db.insert(s.users).values({
    username: `q09-accountant-${suffix}`,
    passwordHash: 'x',
    role: 'ACCOUNTANT',
    status: 'ACTIVE',
  }).returning();
  userIds.push(accountant.id);

  await db.delete(s.userBusinessUnitLinks).where(and(
    eq(s.userBusinessUnitLinks.userId, scoped.user.id),
    eq(s.userBusinessUnitLinks.businessUnitId, unit.id),
  ));
  const emptyReadiness = await getSalaryPeriodReadiness(period);
  assert.equal(emptyReadiness.scope, 'BUSINESS_UNIT');
  assert.equal(emptyReadiness.businessUnitId, unit.id);
  assert.equal(emptyReadiness.canClose, false);
  assert.deepEqual(emptyReadiness.drivers, []);
  assert.match(String(emptyReadiness.blockingReason ?? ''), /chưa có lái xe đang hoạt động/i);
  await assert.rejects(
    () => closeSalaryPeriod({
      period,
      actorId: accountant.id,
      actorRole: 'ACCOUNTANT',
      expectedVersion: 0,
    }),
    (error: Error & { statusCode?: number }) => (
      error.statusCode === 409 && /chưa có lái xe đang hoạt động/i.test(error.message)
    ),
  );
  await assert.rejects(
    () => saveAppSettings({
      ...originalSettings!,
      salaryPayrollBusinessUnitId: unit.id,
    }),
    (error: Error & { statusCode?: number }) => (
      error.statusCode === 400 && /ít nhất một lái xe đang hoạt động/i.test(error.message)
    ),
  );
  await db.insert(s.userBusinessUnitLinks).values({
    userId: scoped.user.id,
    businessUnitId: unit.id,
  });

  const closed = await closeSalaryPeriod({
    period,
    actorId: accountant.id,
    actorRole: 'ACCOUNTANT',
    expectedVersion: 0,
    note: `Q09 payroll unit ${unit.id}`,
  });
  assert.equal(closed.scope, 'BUSINESS_UNIT');
  assert.equal(closed.businessUnitId, unit.id);
  assert.deepEqual(closed.includedDriverIds, [scoped.driver.id]);
  assert.deepEqual(closed.excludedDriverIds, []);
  assert.ok(closed.payrollProvenanceCapturedAt);
  assert.equal(closed.periodTotalSalary, 3_200_000);
  if (closed.ledgerEntryId != null) ledgerIds.push(closed.ledgerEntryId);

  await saveAppSettings({
    ...originalSettings,
    salaryPayrollBusinessUnitId: null,
  });
  const replayed = await closeSalaryPeriod({
    period,
    actorId: accountant.id,
    actorRole: 'ACCOUNTANT',
    expectedVersion: closed.version,
  });
  assert.equal(replayed.idempotentNoop, true);
  assert.equal(replayed.scope, 'BUSINESS_UNIT');
  assert.equal(replayed.businessUnitId, unit.id);
  assert.equal(replayed.businessUnitName, unit.name);
  assert.deepEqual(replayed.includedDriverIds, [scoped.driver.id]);
  assert.deepEqual(replayed.excludedDriverIds, []);
  assert.equal(replayed.payrollProvenanceCapturedAt, closed.payrollProvenanceCapturedAt);
  assert.equal(replayed.periodTotalSalary, 3_200_000);

  await assert.rejects(
    () => saveAppSettings({
      ...originalSettings!,
      salaryPayrollBusinessUnitId: 2_147_483_647,
    }),
    (error: Error & { statusCode?: number }) => (
      error.statusCode === 400 && /không tồn tại|ngừng hoạt động/i.test(error.message)
    ),
  );
});
