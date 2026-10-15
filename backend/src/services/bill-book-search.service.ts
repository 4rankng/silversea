// Card 20261005 — ô "Cược" Bill/Book trên màn hình phơi phiếu.
//
// Kế toán gõ 1–4 chữ số, hệ thống dò trong chính các lô hàng đã có
// (shipments.bl_number / shipments.booking_ref) và gợi ý dòng Bill/Book khớp,
// kèm Hãng tàu và Tên khách hàng. Không tạo cột mới ở hồ sơ khách hàng: số
// Bill/Book vốn là thuộc tính của lô hàng nên tra từ lô là nguồn duy nhất.

import { and, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';

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
