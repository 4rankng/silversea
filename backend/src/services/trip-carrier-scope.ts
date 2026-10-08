import { eq } from 'drizzle-orm';
import { ApiError } from '../errors';
import * as s from '../db/schema';
import type { Tx } from '../db';

/** Which action a driver-entered cost is being judged for. The carrier rule is
 *  the same for each; only the Vietnamese refusal differs, because "đối chiếu"
 *  and "từ chối" read differently to an accountant.
 *
 *  Card 2026-10-05_373 (REQ-5.10-05) — spec §5.10: confirm / reject / edit of a
 *  DRIVER-entered cost is an xe nhà action. On xe ngoài the driver never enters
 *  the cost, so the accountant owns the row and enters it directly. */
export type DriverCostAction = 'đối chiếu' | 'từ chối';

/**
 * Reject a driver-entered cost when its trip is an external-carrier trip.
 *
 * Two things this deliberately does NOT do, both load-bearing:
 *  - it is called ONLY for `sourceKind === 'DRIVER'`. OPS/TRIP costs are the
 *    accountant's own rows and must keep confirming on every carrier type —
 *    gating them here would break external-carrier accounting outright; and
 *  - a trip with no `tripCarrierInfo` row is treated as `OWN`, matching the
 *    column default, so an un-migrated trip is never silently blocked.
 *
 * The carrier type lives on `tripCarrierInfo`; `trips.carrier_type` was dropped
 * in migration 0056 and survives only as a view projection.
 */
export async function assertDriverCostOnOwnCarrier(tx: Tx, tripId: number | null, action: DriverCostAction) {
  if (tripId == null) throw new ApiError(404, 'Khoản chi của tài xế không thuộc chuyến nào.');
  const [info] = await tx.select({ carrierType: s.tripCarrierInfo.carrierType })
    .from(s.trips)
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(eq(s.trips.id, tripId)).limit(1);
  if (!info) throw new ApiError(404, 'Không tìm thấy chuyến.');
  if ((info.carrierType ?? 'OWN') !== 'OWN') {
    throw new ApiError(409, `Xe ngoài không ${action} chi do tài xế nhập — kế toán nhập và sửa chi phí trực tiếp.`);
  }
}