import { db } from '../db';
import * as s from '../db/schema';
import { eq, ne, and, or, isNull, gte, lte, sql } from 'drizzle-orm';
import { round2dp, TxnType } from '@tingting/shared';
import { computeSalary, type ConfirmationMap } from './attendance.service';
import { getSalaryPeriodAdjustmentTotals } from './salary-period-adjustment.service';
import { LedgerService } from './ledger.service';

/**
 * Ledger txn types that count as cash the company has actually paid out / advanced
 * to a driver in a period ("Đã thanh toán / đã tạm ứng").
 *
 * Allow-list, not a blacklist: only DRIVER_PAYOUT represents cash leaving the
 * company on the DRIVER ledger. PENALTY is a non-cash deduction (shown separately
 * as "Khấu trừ kỷ luật") — including it here double-counted and overstated cash
 * paid. ADJUSTMENT on the DRIVER ledger is a reconciliation credit, never a cash
 * debit. UNLOCK_REVERSAL reverses a DRIVER_SALARY credit and is excluded.
 *
 * Exported so the SQL filter and the regression test reference one source of
 * truth (driver-earnings-paid-or-advanced.test.ts).
 */
export const PAID_OR_ADVANCED_TXN_TYPES: readonly TxnType[] = [
  TxnType.DRIVER_PAYOUT,
] as const;

/** Row-level counterpart of the `txn_type IN (...)` allow-list above. */
const PAID_OR_ADVANCED_SET: ReadonlySet<string> = new Set<string>(PAID_OR_ADVANCED_TXN_TYPES);

/** One salary period of the driver-earnings breakdown. */
export interface DriverEarningsPeriod {
  year: number;
  month: number;
}

const periodKeyOf = (period: DriverEarningsPeriod): string =>
  `${period.year}-${String(period.month).padStart(2, '0')}`;

/**
 * Exact decimal → BigInt hundredths.
 *
 * A row-level reduce has to agree with the `sum()` it replaces, and every money
 * column summed here is `numeric(15, 0)`, so the values are integral. Parsing to
 * hundredths keeps the door open for a future scale change and — more to the
 * point — keeps floating point out of the accumulation, where adding thousands
 * of small per-trip amounts would drift. NULL is 0 because `sum()` skips NULLs.
 */
function toHundredths(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  const raw = String(value).trim();
  if (raw === '') return 0n;
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
  const scaled = BigInt(`${whole || '0'}${(fraction + '00').slice(0, 2)}`);
  return negative ? -scaled : scaled;
}

/** BigInt hundredths → number, without ever adding a float to a running total. */
function fromHundredths(value: bigint): number {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const total = Number(abs / 100n) + Number(abs % 100n) / 100;
  return negative ? -total : total;
}

type SalaryData = Awaited<ReturnType<typeof computeSalary>>;

/** The shape every earnings read returns — one place, so batch and single agree. */
function assembleEarnings(args: {
  salaryData: SalaryData;
  postCloseAdjustment: number;
  productionSalary: number;
  roadAllowance: number;
  paidOrAdvanced: number;
  payableBalance: number;
}) {
  const { salaryData } = args;
  return {
    salarySnapshotState: salaryData.salarySnapshotState,
    salaryReconciliationRequired: salaryData.salaryReconciliationRequired,
    postCloseAdjustment: args.postCloseAdjustment,
    baseSalary: String(salaryData.baseSalary),
    tripIncome: String(salaryData.totalTripSalary),
    penalties: String(salaryData.totalPenalties),
    supplementPay: String(salaryData.supplementPay),
    leaveDeduction: String(salaryData.leaveDeduction),
    netIncome: String(salaryData.netSalary + args.postCloseAdjustment),
    netSalary: String(salaryData.netSalary + args.postCloseAdjustment),
    adjustment: salaryData.adjustment,
    standardWorkDays: salaryData.standardWorkDays,
    paidDays: salaryData.paidDays,
    dailyRate: salaryData.dailyRate,
    periodStart: salaryData.periodStart,
    periodEnd: salaryData.periodEnd,
    productionSalary: String(args.productionSalary),
    roadAllowance: String(args.roadAllowance),
    paidOrAdvanced: String(args.paidOrAdvanced),
    payableBalance: String(args.payableBalance),
  };
}

export type DriverEarnings = ReturnType<typeof assembleEarnings>;

/** One period's salary plus the accumulators its aggregates are reduced into. */
interface PeriodBucket {
  key: string;
  salaryData: SalaryData;
  tripSalary: bigint;
  tripRoadAllowance: bigint;
  paidOrAdvanced: bigint;
}

/**
 * Confirmation rows are driver × period scoped and `computeSalary` re-reads them
 * twice per period, so one query for every requested period feeds the existing
 * `confirmationMap` batch hook instead. A period with no confirmation row has no
 * map entry, and `computeSalary` falls back to its own read — the same answer it
 * produced before, one query fewer when a row does exist.
 */
async function batchConfirmationMaps(
  driverId: number,
  periods: readonly DriverEarningsPeriod[],
): Promise<Map<string, ConfirmationMap>> {
  const maps = new Map<string, ConfirmationMap>();
  for (const period of periods) {
    const map: ConfirmationMap = new Map();
    maps.set(periodKeyOf(period), map);
  }
  const rows = await db.select({
    driverId: s.salaryConfirmations.driverId,
    year: s.salaryConfirmations.year,
    month: s.salaryConfirmations.month,
    status: s.salaryConfirmations.status,
    confirmedBy: s.salaryConfirmations.confirmedBy,
    confirmedAt: s.salaryConfirmations.confirmedAt,
    salarySnapshot: s.salaryConfirmations.salarySnapshot,
  }).from(s.salaryConfirmations).where(and(
    eq(s.salaryConfirmations.driverId, driverId),
    or(...periods.map(period => and(
      eq(s.salaryConfirmations.year, period.year),
      eq(s.salaryConfirmations.month, period.month),
    ))),
  ));
  for (const row of rows) {
    maps.get(`${row.year}-${String(row.month).padStart(2, '0')}`)?.set(row.driverId, row);
  }
  return maps;
}

/** Inclusive `[start, end]` test on the `YYYY-MM-DD` strings both sides use. */
function withinRange(day: string, start: string, end: string): boolean {
  return day >= start && day <= end;
}

/**
 * Per-period earnings for ONE driver across many salary periods — the batched
 * form of the driver payslip list (card 20260928_199).
 *
 * The rule is the wave-147 one: every period key is collected and de-duplicated
 * before the first query, each key group is then resolved by a single query and
 * reduced in memory. Concretely:
 *
 *   • `LedgerService.getBalance('DRIVER', driverId)` is driver-scoped, never
 *     period-scoped, so it was identical for every iteration — now read once.
 *   • the two period-scoped aggregates (trip income, cash paid out) become one
 *     query each, reduced per period's own date range.
 *   • confirmation rows go through `computeSalary`'s existing `confirmationMap`
 *     hook instead of being read twice per period.
 *
 * Deliberately still per period: `computeSalary` itself — its live-salary reads
 * live in attendance.service / salary-calculation.service, and re-deriving them
 * here would duplicate salary logic — and the post-close adjustment total, whose
 * owner already takes a driver array but is keyed by a single period.
 *
 * Returns one entry per distinct requested period, keyed `${year}-${MM}`. An
 * empty period list issues no queries at all.
 */
export async function getDriverEarningsForPeriods(
  driverId: number,
  periods: readonly DriverEarningsPeriod[],
): Promise<Map<string, DriverEarnings>> {
  const unique: DriverEarningsPeriod[] = [];
  const seen = new Set<string>();
  for (const period of periods) {
    const key = periodKeyOf(period);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(period);
  }
  if (unique.length === 0) return new Map();

  const confirmationMaps = await batchConfirmationMaps(driverId, unique);

  // computeSalary owns the authoritative period date range, so it has to resolve
  // before the range-scoped aggregates can be batched. Sequential on purpose: the
  // per-period caller threw on the first failing period and that must not change.
  const buckets: PeriodBucket[] = [];
  for (const period of unique) {
    const key = periodKeyOf(period);
    buckets.push({
      key,
      salaryData: await computeSalary(driverId, period.year, period.month, confirmationMaps.get(key)),
      tripSalary: 0n,
      tripRoadAllowance: 0n,
      paidOrAdvanced: 0n,
    });
  }

  // `YYYY-MM-DD` strings sort chronologically, so the envelope of the requested
  // periods bounds the two range-scoped reads.
  const span = buckets.reduce(
    (acc, b) => ({
      start: b.salaryData.periodStart < acc.start ? b.salaryData.periodStart : acc.start,
      end: b.salaryData.periodEnd > acc.end ? b.salaryData.periodEnd : acc.end,
    }),
    { start: buckets[0].salaryData.periodStart, end: buckets[0].salaryData.periodEnd },
  );

  // F2 / B2 — trip-based income for the salary period:
  //   • Lương SX (production pay)      = Σ trip.driverSalary
  //   • Tiền đi đường (road allowance) = Σ trip.totalRoadAllowance
  // over the driver's non-canceled trips departing within the period.
  //
  // One read for every requested period. trips_composite is one row per trip and
  // the WHERE is driver-scoped, so the batch is bounded by this one driver's
  // trips inside the span rather than by the table, and only the three columns
  // the reduce needs come back.
  const tripRows = await db.select({
    departureDate: s.tripsComposite.departureDate,
    driverSalary: s.tripsComposite.driverSalary,
    totalRoadAllowance: s.tripsComposite.totalRoadAllowance,
  }).from(s.tripsComposite)
    .where(and(
      eq(s.tripsComposite.driverId, driverId),
      isNull(s.tripsComposite.deletedAt),
      ne(s.tripsComposite.status, 'CANCELED'),
      gte(s.tripsComposite.departureDate, span.start),
      lte(s.tripsComposite.departureDate, span.end),
    ));
  for (const row of tripRows) {
    for (const bucket of buckets) {
      if (!withinRange(row.departureDate, bucket.salaryData.periodStart, bucket.salaryData.periodEnd)) continue;
      bucket.tripSalary += toHundredths(row.driverSalary);
      bucket.tripRoadAllowance += toHundredths(row.totalRoadAllowance);
    }
  }

  // "Đã thanh toán / đã tạm ứng" = actual cash the company has paid out to the
  // driver in the period. Only true cash-out ledger debits count.
  //
  // Allow-list (see PAID_OR_ADVANCED_TXN_TYPES): DRIVER_PAYOUT is the only
  // DRIVER-ledger debit that represents cash leaving the company. PENALTY is
  // explicitly EXCLUDED — it posts a debit too, but it is a non-cash deduction
  // already shown separately as "Khấu trừ kỷ luật"; counting it here would
  // double-count and overstate cash paid. ADJUSTMENT on the DRIVER ledger is a
  // reconciliation credit (penalty cancellation), never a cash debit.
  // UNLOCK_REVERSAL reverses a DRIVER_SALARY credit and is also excluded.
  //
  // No separate driver-advance txn type exists (advances are recorded as
  // DRIVER_PAYOUT with method=CASH; forwarder advances are OPS_ADVANCE on
  // the FORWARDER ledger, not this one).
  //
  // One read for every requested period, over exactly the rows the per-period
  // aggregate saw: this driver's DRIVER-ledger entries inside the span. The
  // `(createdAt)::date` cast is the same expression the WHERE compares on, so a
  // row is bucketed by the very day that filtered it.
  const ledgerDay = () => sql<string>`(${s.ledger.createdAt})::date`;
  const ledgerRows = await db.select({
    day: ledgerDay().as('day'),
    txnType: s.ledger.txnType,
    debit: s.ledger.debit,
  }).from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'DRIVER'),
      eq(s.ledger.entityId, driverId),
      gte(ledgerDay(), span.start),
      lte(ledgerDay(), span.end),
    ));
  for (const row of ledgerRows) {
    if (!PAID_OR_ADVANCED_SET.has(row.txnType)) continue;
    const debit = toHundredths(row.debit);
    if (debit === 0n) continue;
    for (const bucket of buckets) {
      if (!withinRange(row.day, bucket.salaryData.periodStart, bucket.salaryData.periodEnd)) continue;
      bucket.paidOrAdvanced += debit;
    }
  }

  // F2 / B2 — outstanding payable: what the company still owes this driver,
  // read from the DRIVER ledger (Σ DRIVER_SALARY credits − reversals − payouts).
  // Customer chose "show payable balance" over a new advance-tracking model.
  // Driver-scoped, not period-scoped — one read for the whole call.
  const payableBalance = round2dp(await LedgerService.getBalance('DRIVER', driverId));

  const result = new Map<string, DriverEarnings>();
  for (const bucket of buckets) {
    const postCloseAdjustment = (await getSalaryPeriodAdjustmentTotals(bucket.key, [driverId])).get(driverId) ?? 0;
    result.set(bucket.key, assembleEarnings({
      salaryData: bucket.salaryData,
      postCloseAdjustment,
      productionSalary: round2dp(fromHundredths(bucket.tripSalary)),
      roadAllowance: round2dp(fromHundredths(bucket.tripRoadAllowance)),
      paidOrAdvanced: round2dp(fromHundredths(bucket.paidOrAdvanced)),
      payableBalance,
    }));
  }

  return result;
}

/**
 * Earnings for a single salary period — the entry point for callers holding one
 * period (the driver earnings route). It now runs the batched path with one key,
 * so there is exactly one implementation of the rule.
 */
export async function getDriverEarnings(driverId: number, month: number, year: number) {
  const key = periodKeyOf({ year, month });
  const earnings = (await getDriverEarningsForPeriods(driverId, [{ year, month }])).get(key);
  if (!earnings) {
    // Unreachable: the batch returns one entry per requested key.
    throw new Error(`getDriverEarnings: no earnings computed for ${key}`);
  }
  return earnings;
}
