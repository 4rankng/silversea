/**
 * "Thêm cược" Bill/Booking lookup (PhanHeKeToan §3.6 + owner ruling
 * 2026-10-14): Kế toán types the LAST FOUR DIGITS of a bill and picks the lot,
 * and the form fills Bill/Booking – Hãng tàu – Tên khách hàng from the
 * customer-side lot data.
 *
 * Read-only by design: writing goes through the existing
 * `createDepositTracker`, so this stays a candidate lookup and the deposit
 * tracker keeps a single owner.
 */

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { billBookingTitle } from '../lib/business-keys';
import { ApiError } from '../errors';

/** The last-four-digits match is the customer's lookup habit; shorter input is
 *  ambiguous (every "0" ending bill would qualify) and is rejected loudly. */
export const BILL_DIGITS = 4;
/** Enough to choose a lot from the list, few enough to stay a fast typeahead. */
export const BILL_SUGGESTION_LIMIT = 10;

export interface BillSuggestion {
  shipmentId: number;
  billNumber: string | null;
  bookingRef: string | null;
  /** Bill preferred, Booking as fallback — the house display key. */
  billDisplay: string;
  carrierName: string | null;
  customerName: string;
  /** Deposits already recorded against this lot, so the form can warn. */
  existingTrackerCount: number;
}

export function parseBillDigits(input: string): string {
  const digits = input.trim();
  if (!/^\d{4}$/.test(digits)) {
    throw new ApiError(400, `Nhập đúng ${BILL_DIGITS} số cuối của số Bill/Booking.`);
  }
  return digits;
}

export async function findBillSuggestions(digits: string): Promise<BillSuggestion[]> {
  const rows = await db.select({
    shipmentId: s.shipments.id,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    shippingLineName: s.shipments.shippingLineName,
    catalogCustomerName: s.customers.name,
    rawCustomerName: s.shipments.rawCustomerName,
  }).from(s.shipments)
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    // Soft-deleted lots must never be offered: every other shipment read in
    // the codebase filters deletedAt, and a tombstoned lot would still be
    // linkable into a new deposit tracker.
    .where(and(
      isNull(s.shipments.deletedAt),
      sql`right(${s.shipments.blNumber}, ${BILL_DIGITS}) = ${digits}
        or right(${s.shipments.bookingRef}, ${BILL_DIGITS}) = ${digits}`,
    ))
    .orderBy(desc(s.shipments.createdAt), desc(s.shipments.id))
    .limit(BILL_SUGGESTION_LIMIT);

  if (rows.length === 0) return [];

  // Scoped to the ≤10 matched ids: grouping the whole table on every
  // typeahead keystroke is cost the result set never needed.
  const trackers = await db.select({
    shipmentId: s.depositRefundTrackers.shipmentId,
    count: sql<number>`count(*)::int`,
  }).from(s.depositRefundTrackers)
    .where(inArray(s.depositRefundTrackers.shipmentId, rows.map(row => row.shipmentId)))
    .groupBy(s.depositRefundTrackers.shipmentId);
  const trackerCounts = new Map(trackers.map(row => [row.shipmentId, row.count]));

  return rows.map(row => ({
    shipmentId: row.shipmentId,
    billNumber: row.blNumber,
    bookingRef: row.bookingRef,
    billDisplay: billBookingTitle(row.blNumber, row.bookingRef),
    carrierName: row.shippingLineName,
    // Ad-hoc orders ("lệnh chạy ngoài") carry free text and no catalog link.
    customerName: row.catalogCustomerName ?? row.rawCustomerName ?? '',
    existingTrackerCount: trackerCounts.get(row.shipmentId) ?? 0,
  }));
}