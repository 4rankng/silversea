// ─── SIL-601 (id 702, owner ruling 30/10/2026): LCL lot ≡ 1-cont lot ────────
//
// "Đối với hàng lẻ, mỗi lô hàng lẻ tương đương với 1 lô hàng cont chỉ có
// 1 cont."  Everywhere the system processes by lot/container unit — đếm lô,
// phân bổ xe, tính cước, hiển thị tổng quan and the merge flows — one LCL lot
// counts as ONE container: never 0 (it has no shipment_containers rows by law,
// so row-counting reads 0), never Σ (a multi-trip lot would sum over trips).
//
// Scope of this module: the COUNT law only. Composition cells keep their own
// laws — FB-091 prints the lot's cargo ("5 PALLET | 1.900 kg · 4 CBM", never
// "Chưa có cont"), spec §9.1 keeps the Nhập·Cont / Nhập·Lẻ badge distinction,
// and the demand side keeps its "N lô" bucket (ruling 20260916_5). FCL keeps
// its real container count untouched — this helper only imposes the LCL=1
// half of the convention and passes every other value through unchanged.

/** The convention's constant: one LCL lot is one container unit. */
export const LCL_LOT_CONTAINER_COUNT = 1;

/**
 * Conform a lot's computed container count to the SIL-601 convention.
 *
 * @param cargoMode the lot's mode; 'LCL' forces the unit count.
 * @param computedContainerCount the count the call site computed for a
 *   containered lot (rows, Σ trips, numbered containers, …). Passed through
 *   unchanged — including null/undefined "missing" semantics — for FCL.
 * @returns exactly `LCL_LOT_CONTAINER_COUNT` for LCL; the computed value for
 *   FCL.
 */
export function effectiveLotContainerCount(
  cargoMode: 'FCL' | 'LCL' | null | undefined,
  computedContainerCount: number | null | undefined,
): number | null {
  if (cargoMode === 'LCL') return LCL_LOT_CONTAINER_COUNT;
  return computedContainerCount ?? null;
}
