/**
 * SIL-1068 (K2.108) — the ONE decision law for a chuyến's Tiền đường money,
 * shared by the board cell (`listPhoiPhieuRows`) and the detail dialog
 * (`getPhoiPhieuTienDuong` norm fallback) so the two surfaces can never
 * disagree.
 *
 * The money is DETERMINED only when the trip carries a decided number: a
 * manual override, or a nonzero computed allowance (a matched định mức, toll
 * adjustments, bonuses). Zero with no override means the định-mức table has
 * no row for the route + trailer type — the money is unknown, never a
 * fabricated 0, so every surface reads "Chưa xác định" (null). Xe ngoài runs
 * no driver road allowance at all: its wire number renders as before
 * (unchanged by SIL-1068).
 *
 * DB-free on purpose: the BE unit-only law (19/10) lets tests import and run
 * this file without the app/database.
 */
export function phoiPhieuRoadMoney(input: {
  carrierType: string | null;
  totalRoadAllowance: string | number | null;
  roadAllowanceOverride: string | number | null;
}): number | null {
  if ((input.carrierType ?? 'OWN') !== 'OWN') {
    return input.totalRoadAllowance == null ? null : Number(input.totalRoadAllowance);
  }
  if (input.roadAllowanceOverride == null && (input.totalRoadAllowance == null || Number(input.totalRoadAllowance) === 0)) return null;
  return input.totalRoadAllowance == null ? null : Number(input.totalRoadAllowance);
}
