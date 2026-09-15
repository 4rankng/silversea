import { db } from '../db';
import * as s from '../db/schema';
import { eq, ne, and, isNull, gte, lte, sql, inArray } from 'drizzle-orm';
import { round2dp, TxnType } from '@tingting/shared';
import { computeSalary } from './attendance.service';
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

export async function getDriverEarnings(driverId: number, month: number, year: number) {
  const salaryData = await computeSalary(driverId, year, month);
  const periodKey = `${year}-${String(month).padStart(2, '0')}`;
  const postCloseAdjustment = (await getSalaryPeriodAdjustmentTotals(periodKey, [driverId])).get(driverId) ?? 0;

  // F2 / B2 — trip-based income for the salary period:
  //   • Lương SX (production pay)      = Σ trip.driverSalary
  //   • Tiền đi đường (road allowance) = Σ trip.totalRoadAllowance
  // over the driver's non-canceled trips departing within the period.
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

  // F2 / B2 — outstanding payable: what the company still owes this driver,
  // read from the DRIVER ledger (Σ DRIVER_SALARY credits − reversals − payouts).
  // Customer chose "show payable balance" over a new advance-tracking model.
  const payableBalance = round2dp(await LedgerService.getBalance('DRIVER', driverId));

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
  const [driverLedgerAgg] = await db.select({
    paidOrAdvanced: sql<string>`coalesce(sum(
      case
        when ${inArray(s.ledger.txnType, [...PAID_OR_ADVANCED_TXN_TYPES])}
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
