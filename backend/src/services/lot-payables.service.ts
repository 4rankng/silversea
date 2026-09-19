// Ruling 2026-09-19 (cards _18/_19): the per-lot payables composition behind
// Bảng 2.3 and the Lớp-1 TỔNG PHẢI TRẢ.
//
// Cước trả = trip_carrier_info.external_freight_cost summed over the lot's
// active trips; ops expenses = the lot's ops_expense_entries. Null = chưa
// xác định — zero rows never masquerade as a known zero.
//
// The customs/phat-sinh BUCKET split (Phí HQGS / Phí Phát sinh / Chưa phân
// loại columns) is NOT produced here: classification reads card 20260919_3's
// explicit category column (name matching is forbidden to survive per that
// ruling). Until it lands every ops row reads unclassified — the catch-all
// stays the whole ops total, money conservation holds trivially, and the
// customs/phat-sinh columns ride null ('—').
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';

export interface LotPayablesBreakdown {
  /** Cước trả — the CVC freight on the lot's trips (trip_carrier_info). */
  externalFreightCost: number | null;
  /** Category buckets (card 20260919_3): null = no category producer yet. */
  hqgsFee: number | null;
  phatSinhFee: number | null;
  /** Catch-all: every ops row the buckets above do not claim. With no
   *  category producer it carries the WHOLE ops total so no money leaves
   *  the 2.3 table while still counting in TỔNG PHẢI TRẢ. */
  unclassifiedFee: number | null;
  opsExpenseTotal: number | null;
  /** Cước trả + ops expenses; null whenever either side is unknown. */
  payableTotal: number | null;
}

/** Live per-lot payables breakdown. */
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

  const rows = await db.select({ amount: s.opsExpenseEntries.amount })
    .from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.shipmentId, shipmentId));
  const opsExpenseTotal = rows.length === 0 ? null : rows.reduce((sum, row) => sum + Number(row.amount), 0);
  return {
    externalFreightCost,
    hqgsFee: null,
    phatSinhFee: null,
    unclassifiedFee: opsExpenseTotal,
    opsExpenseTotal,
    payableTotal: externalFreightCost != null && opsExpenseTotal != null
      ? externalFreightCost + opsExpenseTotal
      : null,
  };
}
