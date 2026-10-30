// Truck-busy gate decision (SIL-474): which IN_TRANSIT rows count as a
// genuinely running truck. Kept as a DB-free leaf so the status machine and
// its unit tests share one source of truth without pulling the database
// client into the test graph.

/**
 * A busy row may only block a new departure on the same truck while its
 * planned departure day has arrived (Asia/Ho_Chi_Minh) or already passed.
 * An early "Xuất phát"/"Nhận lệnh" leaves future-departure trips in
 * IN_TRANSIT days before the truck moves — such a row is planning state,
 * not a running truck, and must not block (SIL-474: TVREQ-LX-C4 departing
 * 28/10 froze its truck from 24/10).
 *
 * Comparisons are lexicographic on canonical YYYY-MM-DD strings, which is
 * order-correct for ISO dates. Missing inputs keep the conservative legacy
 * block: a clock that cannot be read and a row without a departure date
 * both stay blocking, never silently unlock.
 */
export function isTripRunningOnDepartureDay(
  departureDate: string | null | undefined,
  todayInBusinessZone: string | null | undefined,
): boolean {
  if (todayInBusinessZone == null || todayInBusinessZone === '') return true;
  if (departureDate == null || departureDate === '') return true;
  return departureDate <= todayInBusinessZone;
}

/** Shape the busy-trip select in transitionTripStatus already carries. */
export interface TruckBusyCandidateRow {
  id: number;
  activeTripPairId: number | null;
  driverId: number | null;
}

/**
 * SIL-602: the truck-busy exemption for the OTHER leg of the trip's own
 * ACTIVE KEP pair (PRD LoHangKepKetHop §3.2 + §7.3 — "KẸP hợp lệ không tự
 * chặn công việc thứ hai vì xe bận trong chính cặp"). The two 20ft legs ride
 * one rig simultaneously by construction, so the partner's IN_TRANSIT row is
 * the pair running, not a conflicting job.
 *
 * The exemption is the PAIR IDENTITY + the shared driver — nothing else. The
 * superseded clause also demanded `trailerId` to be set and equal on both
 * legs, but trailer data is not part of the pair contract: pairing validates
 * same truck + same driver + same departure day + two 20ft shells, and
 * master-data imports legitimately leave the mooc unassigned (card
 * 211026152138). A null or drifted `trailerId` therefore blocked the second
 * leg with 409 "Xe đang chạy chuyến…" — the reported regression.
 *
 * Deliberately NOT exempt: a busy row outside the pair, a row whose pair
 * link drifted (different/null pair id — the pair broke or was re-paired),
 * and a partner with a different driver (out-of-band drift stays blocking;
 * the guarded reassign flows keep real pairs in sync). KET_HOP partners never
 * resolve a `simultaneousPartnerId` (the status machine's pair lookup filters
 * `status='ACTIVE'` + `pairKind='KEP'`), so sequential pairs keep their
 * sequencing gate.
 */
export function isActiveKepPairPartner(
  candidate: TruckBusyCandidateRow,
  args: {
    /** Self-inclusion is already excluded upstream (`ne(s.trips.id, tripId)`
     *  in the busy select); carried for call-site readability, not enforced
     *  here. */
    tripId: number;
    tripPairId: number | null | undefined;
    tripDriverId: number | null | undefined;
    simultaneousPartnerId: number | null | undefined;
  },
): boolean {
  if (args.tripPairId == null || args.simultaneousPartnerId == null) return false;
  if (args.tripDriverId == null) return false;
  if (candidate.id !== args.simultaneousPartnerId) return false;
  if (candidate.activeTripPairId !== args.tripPairId) return false;
  return candidate.driverId === args.tripDriverId;
}
