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
