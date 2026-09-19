// Cards _18/_19 ruling 2026-09-19: the per-lot payables composition behind
// Bảng 2.3 and the Lớp-1 TỔNG PHẢI TRẢ.
//
// Cước trả = trip_carrier_info.external_freight_cost summed over the lot's
// active trips; ops expenses = the lot's ops_expense_entries joined to the
// catalog for its CATEGORY (card 20260919_3). Null = chưa xác định — zero
// rows never masquerade as a known zero; with rows present an EMPTY bucket
// reads a known 0 (the classification-contract tests pin this).
//
// The split never name-matches. A tenant rename must not rewrite categorized
// history; null-category (chưa phân loại) rows land in the catch-all beside
// the KHAC rows so no money can leave the table.
import { and, eq, isNull, ne } from 'drizzle-orm';
import { ExpenseTypeCategory } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';

export interface LotPayablesBreakdown {
  /** Cước trả — the CVC freight on the lot's trips (trip_carrier_info). */
  externalFreightCost: number | null;
  hqgsFee: number | null;
  phatSinhFee: number | null;
  /** Catch-all: null-category + KHAC rows — everything the customs/phat-sinh
   *  buckets do not claim, so conservation is exact. */
  unclassifiedFee: number | null;
  opsExpenseTotal: number | null;
  /** Cước trả + ops expenses; null whenever either side is unknown. */
  payableTotal: number | null;
}

/** Live per-lot payables breakdown (Bảng 2.3 + TỔNG PHẢI TRẢ). */
export async function computeLotPayablesBreakdown(shipmentId: number): Promise<LotPayablesBreakdown> {
  const trips = await db.select({ carrierCost: s.tripCarrierInfo.externalFreightCost })
    .from(s.trips)
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(and(
      eq(s.trips.shipmentId, shipmentId),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ));
  const carrierCosts = trips.map((trip) => trip.carrierCost).filter((cost): cost is string => cost != null);
  const externalFreightCost = trips.length > 0 && carrierCosts.length === trips.length
    ? carrierCosts.reduce((sum, cost) => sum + Number(cost), 0)
    : null;

  const rows = await db.select({
    category: s.forwarderExpenseTypes.category,
    amount: s.opsExpenseEntries.amount,
  })
    .from(s.opsExpenseEntries)
    .leftJoin(s.forwarderExpenseTypes, eq(s.forwarderExpenseTypes.code, s.opsExpenseEntries.expenseTypeCode))
    .where(eq(s.opsExpenseEntries.shipmentId, shipmentId));
  const withRows = rows.length > 0;
  const bucketTotal = (predicate: (category: string | null) => boolean): number =>
    rows.reduce((sum, row) => {
      if (!predicate(row.category)) return sum;
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) {
        throw new Error('Non-finite ops expense amount — refusing to sum.');
      }
      return sum + amount;
    }, 0);
  const hqgsFee = withRows ? bucketTotal((c) => c === ExpenseTypeCategory.HQGS) : null;
  const phatSinhFee = withRows ? bucketTotal((c) => c === ExpenseTypeCategory.PHAT_SINH) : null;
  const unclassifiedFee = withRows
    ? bucketTotal((c) => c !== ExpenseTypeCategory.HQGS && c !== ExpenseTypeCategory.PHAT_SINH)
    : null;
  const opsExpenseTotal = withRows ? bucketTotal(() => true) : null;
  return {
    externalFreightCost,
    hqgsFee,
    phatSinhFee,
    unclassifiedFee,
    opsExpenseTotal,
    payableTotal: externalFreightCost != null && opsExpenseTotal != null
      ? externalFreightCost + opsExpenseTotal
      : null,
  };
}
