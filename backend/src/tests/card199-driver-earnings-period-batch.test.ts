/**
 * Card 20260928_199 — the per-period N+1 in the driver payslip list.
 *
 * `getDriverPayslipPeriods` looped over every closed period and awaited
 * `getDriverEarnings(driverId, month, year)`, which issued its own per-period
 * aggregates. The batch groups every period key up front, hoists the
 * driver-scoped ledger balance out of the loop and reduces the two
 * period-scoped aggregates (trips, ledger cash-out) from one query each.
 *
 * This suite pins the three things the card asks for:
 *   1. the query count, MEASURED — the postgres.js `unsafe` executor is wrapped
 *      so every Drizzle statement is captured and classified by table;
 *   2. per-driver results UNCHANGED — the batched result is deep-compared with
 *      `getDriverEarningsOracle` below, which is the pre-card implementation
 *      copied verbatim and frozen as the reference;
 *   3. the empty/missing-data path, which must behave as it did.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { round2dp, TxnType } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { getDriverPayslipPeriods } from '../services/driver-payslip.service';
import { getDriverEarnings, getDriverEarningsForPeriods } from '../services/driver-earnings.service';
import { computeSalary } from '../services/attendance.service';
import { computeLiveSalary } from '../services/salary-calculation.service';
import { getSalaryPeriodAdjustmentTotals } from '../services/salary-period-adjustment.service';
import { LedgerService } from '../services/ledger.service';
import { resolveSalaryPeriodDateRange } from '../services/salary-period.service';
import { insertTripComposite } from '../services/trip-composite.service';

// ─── query counting ─────────────────────────────────────────────────────────
// Drizzle issues every statement through postgres.js `client.unsafe`, so one
// wrapper counts one database round trip. No SQL parsing, no logger config.
type PgFn = { unsafe: (query: string, params?: unknown[], opts?: unknown) => unknown };
const pgClient = client as unknown as PgFn;
const realUnsafe = pgClient.unsafe;
let captured: string[] = [];
let counting = false;
pgClient.unsafe = function countedUnsafe(query: string, params?: unknown[], opts?: unknown) {
  if (counting) captured.push(query);
  return realUnsafe.call(client, query, params, opts);
} as PgFn['unsafe'];

async function measured<T>(fn: () => Promise<T>): Promise<{ value: T; queries: string[] }> {
  captured = [];
  counting = true;
  try {
    const value = await fn();
    return { value, queries: captured };
  } finally {
    counting = false;
    captured = [];
  }
}

const hits = (queries: string[], predicate: (q: string) => boolean) => queries.filter(predicate).length;
// The two period-scoped reads. The oracle issues them as `sum()` aggregates and
// the batch as a row read, so they are classified by their table, not by shape.
const tripsRead = (q: string) => /from "trips_composite"/.test(q);
const ledgerRead = (q: string) => /from "ledger"/.test(q);
const ledgerBalance = (q: string) => ledgerRead(q) && /"id" desc/.test(q);
const ledgerCashOut = (q: string) => ledgerRead(q) && !/"id" desc/.test(q);

/** Per-table statement counts — the evidence behind the before/after numbers. */
const byTable = (queries: string[]): Array<[string, number]> => {
  const counts = new Map<string, number>();
  for (const q of queries) {
    const match = /from "([a-z_]+)"/.exec(q);
    const table = match ? match[1] : 'other';
    counts.set(table, (counts.get(table) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};

// ─── ORACLE: the pre-card implementation, frozen ────────────────────────────
// Deliberately duplicated rather than imported: this is the reference the
// batched path is compared against, so it must not share the code under test.
const PAID_OR_ADVANCED: readonly TxnType[] = [TxnType.DRIVER_PAYOUT];

async function getDriverEarningsOracle(driverId: number, month: number, year: number) {
  const salaryData = await computeSalary(driverId, year, month);
  const periodKey = `${year}-${String(month).padStart(2, '0')}`;
  const postCloseAdjustment = (await getSalaryPeriodAdjustmentTotals(periodKey, [driverId])).get(driverId) ?? 0;

  const [tripAgg] = await db.select({
    productionSalary: sql<string>`coalesce(sum(${s.tripsComposite.driverSalary}::numeric), 0)`,
    roadAllowance: sql<string>`coalesce(sum(${s.tripsComposite.totalRoadAllowance}::numeric), 0)`,
  }).from(s.tripsComposite)
    .where(and(
      eq(s.tripsComposite.driverId, driverId),
      isNull(s.tripsComposite.deletedAt),
      ne(s.tripsComposite.status, 'CANCELED'),
      gte(s.tripsComposite.departureDate, salaryData.periodStart),
      lte(s.tripsComposite.departureDate, salaryData.periodEnd),
    ));
  const productionSalary = round2dp(parseFloat(tripAgg?.productionSalary ?? '0'));
  const roadAllowance = round2dp(parseFloat(tripAgg?.roadAllowance ?? '0'));

  const payableBalance = round2dp(await LedgerService.getBalance('DRIVER', driverId));

  const [driverLedgerAgg] = await db.select({
    paidOrAdvanced: sql<string>`coalesce(sum(
      case
        when ${inArray(s.ledger.txnType, [...PAID_OR_ADVANCED])}
        then ${s.ledger.debit}::numeric
        else 0
      end
    ), 0)`,
  }).from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'DRIVER'),
      eq(s.ledger.entityId, driverId),
      gte(sql`(${s.ledger.createdAt})::date`, salaryData.periodStart),
      lte(sql`(${s.ledger.createdAt})::date`, salaryData.periodEnd),
    ));
  const paidOrAdvanced = round2dp(parseFloat(driverLedgerAgg?.paidOrAdvanced ?? '0'));

  return {
    salarySnapshotState: salaryData.salarySnapshotState,
    salaryReconciliationRequired: salaryData.salaryReconciliationRequired,
    postCloseAdjustment,
    baseSalary: String(salaryData.baseSalary),
    tripIncome: String(salaryData.totalTripSalary),
    penalties: String(salaryData.totalPenalties),
    supplementPay: String(salaryData.supplementPay),
    leaveDeduction: String(salaryData.leaveDeduction),
    netIncome: String(salaryData.netSalary + postCloseAdjustment),
    netSalary: String(salaryData.netSalary + postCloseAdjustment),
    adjustment: salaryData.adjustment,
    standardWorkDays: salaryData.standardWorkDays,
    paidDays: salaryData.paidDays,
    dailyRate: salaryData.dailyRate,
    periodStart: salaryData.periodStart,
    periodEnd: salaryData.periodEnd,
    productionSalary: String(productionSalary),
    roadAllowance: String(roadAllowance),
    paidOrAdvanced: String(paidOrAdvanced),
    payableBalance: String(payableBalance),
  };
}

// ─── fixture ────────────────────────────────────────────────────────────────
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Far-future periods so a global salary_period_closes row cannot collide with
// another suite's data.
const PERIODS = [
  { year: 2031, month: 3, period: '2031-03' },
  { year: 2031, month: 4, period: '2031-04' },
  { year: 2031, month: 5, period: '2031-05' },
] as const;

const created: {
  userIds: number[]; driverIds: number[]; customerIds: number[];
  routeIds: number[]; cargoTypeIds: number[]; tripIds: number[];
  ledgerIds: number[]; penaltyIds: number[]; adjustmentIds: number[];
  confirmationIds: number[]; workDayIds: number[]; periods: string[];
} = {
  userIds: [], driverIds: [], customerIds: [], routeIds: [], cargoTypeIds: [], tripIds: [],
  ledgerIds: [], penaltyIds: [], adjustmentIds: [], confirmationIds: [], workDayIds: [], periods: [],
};

let driverId = 0;

async function seedFixture() {
  const [user] = await db.insert(s.users).values({
    username: `card199-${suffix}`, passwordHash: 'x', role: 'DRIVER', fullName: `Card199 closer ${suffix}`,
  }).returning();
  created.userIds.push(user.id);
  const [driver] = await db.insert(s.drivers).values({
    name: `Card199 driver ${suffix}`, userId: user.id, baseSalary: '5000000', socialInsurance: '0',
  }).returning();
  created.driverIds.push(driver.id);
  driverId = driver.id;

  const [customer] = await db.insert(s.customers).values({ name: `Card199 cust ${suffix}` }).returning();
  created.customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Card199 route ${suffix}` }).returning();
  created.routeIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `Card199 cargo ${suffix}` }).returning();
  created.cargoTypeIds.push(cargoType.id);

  for (const p of PERIODS) {
    const range = await resolveSalaryPeriodDateRange(p.month, p.year);
    const midDate = range.start;
    const outsideDate = p === PERIODS[0] ? '2030-01-15' : '2032-01-15';

    await db.insert(s.salaryPeriodCloses).values({
      period: p.period, status: p === PERIODS[1] ? 'REOPENED' : 'CLOSED',
      closedBy: user.id, closedAt: new Date(), payslipIssuedAt: new Date(), note: `card199 ${suffix}`,
    }).onConflictDoNothing({ target: s.salaryPeriodCloses.period });
    created.periods.push(p.period);

    // A real trip inside the period, a CANCELED one and a soft-deleted one:
    // both must stay excluded by the batched aggregate exactly as the per-period
    // aggregate excluded them.
    const live = await insertTripComposite(db, {
      tripCode: `C199-live-${suffix}-${p.period}`.slice(0, 50),
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      status: 'COMPLETED', departureDate: midDate,
      driverSalary: '700000', totalRoadAllowance: '123456',
    });
    created.tripIds.push(live.id);
    const canceled = await insertTripComposite(db, {
      tripCode: `C199-cxl-${suffix}-${p.period}`.slice(0, 50),
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      status: 'CANCELED', departureDate: midDate,
      driverSalary: '999999', totalRoadAllowance: '999999',
    });
    created.tripIds.push(canceled.id);
    const deleted = await insertTripComposite(db, {
      tripCode: `C199-del-${suffix}-${p.period}`.slice(0, 50),
      driverId: driver.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      status: 'COMPLETED', departureDate: midDate,
      driverSalary: '888888', totalRoadAllowance: '888888',
    });
    created.tripIds.push(deleted.id);
    await db.update(s.trips).set({ deletedAt: new Date() }).where(eq(s.trips.id, deleted.id));

    // Cash out inside the period + a payout outside every period.
    const [paid] = await db.insert(s.ledger).values({
      txnType: TxnType.DRIVER_PAYOUT, entityType: 'DRIVER', entityId: driver.id,
      credit: '0', debit: '450000', balance: '450000', note: `card199 in ${p.period}`,
      createdAt: new Date(`${midDate}T09:00:00Z`),
    }).returning();
    created.ledgerIds.push(paid.id);
    // A DRIVER_SALARY credit in the period: not cash out, must not be counted.
    const [credit] = await db.insert(s.ledger).values({
      txnType: TxnType.DRIVER_SALARY, entityType: 'DRIVER', entityId: driver.id,
      credit: '5000000', debit: '0', balance: '0', note: `card199 salary ${p.period}`,
      createdAt: new Date(`${midDate}T09:30:00Z`),
    }).returning();
    created.ledgerIds.push(credit.id);
    const [outside] = await db.insert(s.ledger).values({
      txnType: TxnType.DRIVER_PAYOUT, entityType: 'DRIVER', entityId: driver.id,
      credit: '0', debit: '777777', balance: '777777', note: `card199 out ${p.period}`,
      createdAt: new Date(`${outsideDate}T09:00:00Z`),
    }).returning();
    created.ledgerIds.push(outside.id);

    const [penalty] = await db.insert(s.penalties).values({
      driverId: driver.id, amount: '120000', customReason: `card199 ${p.period}`,
      date: midDate, status: 'ACTIVE',
    }).returning();
    created.penaltyIds.push(penalty.id);

    const [adjustment] = await db.insert(s.salaryPeriodAdjustments).values({
      driverId: driver.id, targetPeriod: p.period, sourcePeriod: p.period,
      amount: p === PERIODS[2] ? '-50000' : '25000', reason: `card199 adj ${p.period}`,
      approvedBy: user.id, approvedAt: new Date(),
    }).returning();
    created.adjustmentIds.push(adjustment.id);

    const [workDay] = await db.insert(s.driverWorkDays).values({
      driverId: driver.id, date: midDate, status: 'TRIP_DAY', createdBy: user.id,
    }).returning();
    created.workDayIds.push(workDay.id);
  }

  // Periods the unparsable/month-out-of-range guard must skip: a month past 12
  // and a period that is not a date at all. They are global rows, so every
  // payslip list sees them — exactly as before the batching.
  for (const bogus of ['2031-13', 'abcd']) {
    await db.insert(s.salaryPeriodCloses).values({
      period: bogus, status: 'CLOSED', closedBy: user.id, closedAt: new Date(),
      payslipIssuedAt: new Date(), note: `card199 guard ${suffix}`,
    }).onConflictDoNothing({ target: s.salaryPeriodCloses.period });
    created.periods.push(bogus);
  }

  // One CONFIRMED period (frozen snapshot path) and one LIVE period, so both
  // computeSalary branches are compared.
  const confirmed = PERIODS[0];
  const live = await computeLiveSalary(driver.id, confirmed.year, confirmed.month);
  const snapshot = JSON.parse(JSON.stringify({ ...live, snapshotVersion: 1 }));
  const [confirmation] = await db.insert(s.salaryConfirmations).values({
    driverId: driver.id, year: confirmed.year, month: confirmed.month,
    status: 'CONFIRMED', salarySnapshot: snapshot, confirmedBy: user.id, confirmedAt: new Date(),
  }).onConflictDoNothing({ target: [s.salaryConfirmations.driverId, s.salaryConfirmations.year, s.salaryConfirmations.month] })
    .returning();
  if (confirmation) created.confirmationIds.push(confirmation.id);
}

const batchKeys = PERIODS.map(p => ({ year: p.year, month: p.month }));

describe('card 20260928_199 — driver payslip period earnings are batched', () => {
  before(async () => { await seedFixture(); });

  test('AC2 — batched result is deep-equal to the pre-card per-period loop', async () => {
    const oracle = new Map<string, unknown>();
    for (const p of PERIODS) {
      oracle.set(p.period, await getDriverEarningsOracle(driverId, p.month, p.year));
    }

    const { value: batched } = await measured(() => getDriverEarningsForPeriods(driverId, batchKeys));

    assert.equal(batched.size, PERIODS.length, 'one entry per requested period');
    for (const p of PERIODS) {
      assert.deepEqual(
        batched.get(p.period),
        oracle.get(p.period),
        `earnings for ${p.period} are unchanged`,
      );
      // The single-period entry point the earnings route uses delegates to the
      // batch, so the route's answer must match the loop's too.
      assert.deepEqual(
        await getDriverEarnings(driverId, p.month, p.year),
        oracle.get(p.period),
        `getDriverEarnings(${p.month}, ${p.year}) is unchanged`,
      );
    }
  });

  test('AC1 — query count: one per key group, measured', async () => {
    const oracleRun = await measured(async () => {
      for (const p of PERIODS) await getDriverEarningsOracle(driverId, p.month, p.year);
    });
    const batchRun = await measured(() => getDriverEarningsForPeriods(driverId, batchKeys));

    // Per-key-group groups: the whole point of the card.
    assert.equal(hits(batchRun.queries, tripsRead), 1, 'trips read: 1 query for all periods');
    assert.equal(hits(batchRun.queries, ledgerCashOut), 1, 'cash-out read: 1 query for all periods');
    assert.equal(hits(batchRun.queries, ledgerBalance), 1, 'driver balance: 1 query for the whole call');
    assert.equal(hits(oracleRun.queries, tripsRead), PERIODS.length, 'oracle issued one trips query per period');
    assert.equal(hits(oracleRun.queries, ledgerCashOut), PERIODS.length, 'oracle issued one cash-out query per period');
    assert.equal(hits(oracleRun.queries, ledgerBalance), PERIODS.length, 'oracle issued one balance query per period');

    console.warn(`[card199] oracle queries=${oracleRun.queries.length} batch queries=${batchRun.queries.length} periods=${PERIODS.length}`);
    console.warn(`[card199] oracle byTable=${JSON.stringify(byTable(oracleRun.queries))}`);
    console.warn(`[card199] batch  byTable=${JSON.stringify(byTable(batchRun.queries))}`);
    assert.ok(
      batchRun.queries.length < oracleRun.queries.length,
      `batch (${batchRun.queries.length}) must issue fewer queries than the loop (${oracleRun.queries.length})`,
    );
  });

  test('AC1/AC2 — getDriverPayslipPeriods uses the batched path and returns the same rows', async () => {
    const oracleRun = await measured(async () => {
      const perPeriod = new Map<string, Awaited<ReturnType<typeof getDriverEarningsOracle>>>();
      for (const p of PERIODS) perPeriod.set(p.period, await getDriverEarningsOracle(driverId, p.month, p.year));
      return perPeriod;
    });
    const payslipRun = await measured(() => getDriverPayslipPeriods(driverId));

    assert.equal(hits(payslipRun.queries, tripsRead), 1, 'payslip list reads trips once');
    assert.equal(hits(payslipRun.queries, ledgerBalance), 1, 'payslip list reads the driver balance once');
    assert.equal(hits(payslipRun.queries, ledgerCashOut), 1, 'payslip list sums cash out once');
    console.warn(`[card199] payslip queries=${payslipRun.queries.length} oracle-for-same-periods=${oracleRun.queries.length}`);

    let compared = 0;
    for (const row of payslipRun.value) {
      const expected = oracleRun.value.get(row.period);
      if (!expected) continue;
      compared += 1;
      assert.equal(row.earnings.netIncome, expected.netIncome, `netIncome ${row.period}`);
      assert.equal(row.earnings.productionSalary, expected.productionSalary, `productionSalary ${row.period}`);
      assert.equal(row.earnings.roadAllowance, expected.roadAllowance, `roadAllowance ${row.period}`);
      assert.equal(row.earnings.paidOrAdvanced, expected.paidOrAdvanced, `paidOrAdvanced ${row.period}`);
      assert.equal(row.earnings.payableBalance, expected.payableBalance, `payableBalance ${row.period}`);
      assert.equal(row.earnings.penalties, expected.penalties, `penalties ${row.period}`);
      assert.equal(row.earnings.periodStart, expected.periodStart, `periodStart ${row.period}`);
      assert.equal(row.earnings.periodEnd, expected.periodEnd, `periodEnd ${row.period}`);
    }
    assert.equal(compared, PERIODS.length, 'every fixture period came back and was compared');
  });

  test('AC4 — the unparsable / out-of-range period guard still skips', async () => {
    const periods = (await getDriverPayslipPeriods(driverId)).map(row => row.period);
    assert.ok(!periods.includes('2031-13'), 'month 13 is not a salary period — skipped');
    assert.ok(!periods.includes('abcd'), 'unparsable period — skipped');
    for (const p of PERIODS) {
      assert.ok(periods.includes(p.period), `${p.period} is still returned`);
    }
  });

  test('AC4 — empty and missing data behave as before', async () => {
    const empty = await measured(() => getDriverEarningsForPeriods(driverId, []));
    assert.equal(empty.value.size, 0, 'no periods → empty map');
    assert.equal(empty.queries.length, 0, 'no periods → no queries at all');

    const duplicated = await measured(() => getDriverEarningsForPeriods(driverId, [
      ...batchKeys, { year: batchKeys[0].year, month: batchKeys[0].month },
    ]));
    assert.equal(duplicated.value.size, PERIODS.length, 'duplicate keys collapse to one entry');
    assert.deepEqual(duplicated.value.get('2031-03'), (await getDriverEarningsOracle(driverId, 3, 2031)));
    assert.ok(duplicated.queries.length > 0);

    // A driver with no rows anywhere: zero-value earnings, no throw.
    const [loner] = await db.insert(s.drivers).values({ name: `Card199 loner ${suffix}` }).returning();
    created.driverIds.push(loner.id);
    const { value: lonerEarnings } = await measured(() => getDriverEarningsForPeriods(loner.id, batchKeys));
    assert.equal(lonerEarnings.size, PERIODS.length);
    for (const p of PERIODS) {
      const e = lonerEarnings.get(p.period)!;
      assert.equal(e.productionSalary, '0');
      assert.equal(e.roadAllowance, '0');
      assert.equal(e.paidOrAdvanced, '0');
      assert.equal(e.payableBalance, '0');
    }
  });
});

after(async () => {
  try {
    if (created.tripIds.length) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, created.tripIds));
      await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, created.tripIds));
      await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, created.tripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, created.tripIds));
    }
    if (created.ledgerIds.length) await db.delete(s.ledger).where(inArray(s.ledger.id, created.ledgerIds));
    if (created.penaltyIds.length) await db.delete(s.penalties).where(inArray(s.penalties.id, created.penaltyIds));
    if (created.adjustmentIds.length) await db.delete(s.salaryPeriodAdjustments).where(inArray(s.salaryPeriodAdjustments.id, created.adjustmentIds));
    if (created.confirmationIds.length) await db.delete(s.salaryConfirmations).where(inArray(s.salaryConfirmations.id, created.confirmationIds));
    if (created.workDayIds.length) await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.id, created.workDayIds));
    if (created.periods.length) await db.delete(s.salaryPeriodCloses).where(inArray(s.salaryPeriodCloses.period, created.periods));
    if (created.cargoTypeIds.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, created.cargoTypeIds));
    if (created.routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, created.routeIds));
    if (created.driverIds.length) await db.delete(s.drivers).where(inArray(s.drivers.id, created.driverIds));
    if (created.customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, created.customerIds));
    if (created.userIds.length) await db.delete(s.users).where(inArray(s.users.id, created.userIds));
  } catch (err) {
    console.warn('[card199] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
