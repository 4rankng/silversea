// Card 20261005 — ô "Cược" Bill/Book trên màn hình phơi phiếu.
//
// Kế toán gõ 1–4 chữ số, hệ thống dò trong chính các lô hàng đã có
// (shipments.bl_number / shipments.booking_ref) và gợi ý dòng Bill/Book khớp,
// kèm Hãng tàu và Tên khách hàng. Không tạo cột mới ở hồ sơ khách hàng: số
// Bill/Book vốn là thuộc tính của lô hàng nên tra từ lô là nguồn duy nhất.

import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { billBookingTitle } from '../lib/business-keys';
import { billDigitsNeedle } from './bill-digit-match';

/** Display default for a lot with neither number: mirrored from the frontend
 *  `billBookingReference` helper (that module is frontend-only, so the
 *  expression is inlined here rather than reaching across the boundary). */
const MISSING_REFERENCE = 'Chưa có số Bill/Booking';

export interface BillBookMatch {
  shipmentId: number;
  reference: string;
  shippingLineName: string | null;
  customerName: string | null;
}

/**
 * Search live shipments by the tail/head digits of their Bill or Booking
 * number. `digits` is 1–4 characters (validated by the route); an empty
 * string returns [] WITHOUT querying, so a cleared field never triggers a
 * table scan.
 */
export async function searchBillBook(digits: string): Promise<BillBookMatch[]> {
  const needle = digits.trim();
  if (needle.length === 0) return [];
  const like = `%${needle}%`;
  const rows = await db
    .select({
      id: s.shipments.id,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
      shippingLineName: s.shipments.shippingLineName,
      customerName: s.customers.name,
    })
    .from(s.shipments)
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .where(and(
      isNull(s.shipments.deletedAt),
      or(
        ilike(s.shipments.blNumber, like),
        ilike(s.shipments.bookingRef, like),
      ) as SQL,
    ))
    .limit(10);

  return rows.map((row) => ({
    shipmentId: row.id,
    reference: row.blNumber?.trim() || row.bookingRef?.trim() || MISSING_REFERENCE,
    shippingLineName: row.shippingLineName,
    customerName: row.customerName,
  }));
}

/**
 * "Thêm cược" Bill/Booking lookup (PhanHeKeToan §3.6 + owner ruling
 * 2026-10-14, mở rộng bởi spec fix 2 07/11 §III.3 — SIL-735): Kế toán types
 * four digits and the search matches them as a SUBSTRING of the digit run of
 * BOTH blNumber AND bookingRef, and the form fills Bill/Booking – Hãng tàu –
 * Tên khách hàng from the customer-side lot data.
 *
 * The comparison runs on the DIGIT RUN, not the raw string (card
 * 171026212000, FB-096 verify-fail): real references carry non-digit
 * suffixes (`FB020-R21-RB1`, `…-IMP`, `RARBOOK-…-9bzut2`), and the
 * accountant reads "4 số cuối" off the printed number — the digits, ignoring
 * separators and letters. SIL-735 changes tail-equality to substring: any
 * four consecutive digits of the number surface the lot (the old tail match
 * is the special case included in it), so a booking's tail now lands the lot
 * exactly like a bill's tail does.
 *
 * Consolidation 2026-10-15 (F6): this module is the single bill-search
 * service. Two ruled semantics live side by side — `searchBillBook` above is
 * the flexible 1–4-digit substring probe for the phơi phiếu "Cược" field
 * (Card 20261005), while the strict four-digit match below belongs to the
 * deposit-tracker add-flow, whose substring-of-digit-run semantics and
 * existing-tracker warning are part of that owner ruling. Same shipments
 * join, two contracts — do not collapse them into one query.
 *
 * Read-only by design: writing goes through the existing
 * `createDepositTracker`, so this stays a candidate lookup and the deposit
 * tracker keeps a single owner.
 */

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
    // linkable into a new deposit tracker. The two substring matches are
    // grouped in drizzle's or() — a bare `sql\`A or B\`` inside and() would
    // render `(deleted_at is null and A) or B`, letting the booking branch
    // bypass the tombstone filter. Each branch matches the typed digits as a
    // SUBSTRING of the field's digit run (SIL-735: khớp chuỗi con trên CẢ
    // blNumber VÀ bookingRef; FB-096 giữ soạn chuỗi số để đuôi không thuần
    // chữ số như "-IMP" hay "9bzut2" không che mất match). The needle comes
    // from the pure law (`billDigitsNeedle`) so the query cannot drift from
    // the rule the unit tree pins.
    .where(and(
      isNull(s.shipments.deletedAt),
      or(
        sql`regexp_replace(${s.shipments.blNumber}, '[^0-9]', '', 'g') ilike ${billDigitsNeedle(digits)}`,
        sql`regexp_replace(${s.shipments.bookingRef}, '[^0-9]', '', 'g') ilike ${billDigitsNeedle(digits)}`,
      ) as SQL,
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
