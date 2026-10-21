// Fuel-lag resolution for quotation imports (cards 211026221918 / R31 f04).
//
// PRD contract (PhuongAnTinhCuocTuDong.md §3.1 + CuocPhiPhuPhiDau.md §7):
//   - Lag is per-route CONTRACT data ("NEWEB đã có N=1… không suy ra số ngày
//     trễ cho hai tuyến còn lại").
//   - "Khi chưa có lag, sản phẩm báo thiếu điều khoản thay vì tự dùng 0" —
//     an omitted lag must never be recorded as a confirmed 0.
//
// The customer's quotation Excel carries an optional "Lag Day n" cell. When
// the file provides it, the file IS the customer's confirmation. When the
// file omits it, the import must carry the customer×route's current terms
// forward instead of fabricating `0 / confirmed` — the exact defect that
// made NEWEB snapshots price with lag 0 (áp ngay) after a file import.
//
// Pure module on purpose: no db import, so backend unit tests can cover the
// decision table directly (BE tests are unit-only, 2026-10-19 ruling).

export interface FreightLagSourceTerms {
  fuelLagDays: number | null;
  fuelLagConfirmed: boolean;
}

export interface ResolvedFreightLag {
  fuelLagDays: number;
  fuelLagConfirmed: boolean;
  /** True when the file omitted the lag and an existing terms row supplied it. */
  carriedForward: boolean;
}

/**
 * Decision table (file lag → resolved):
 *   file integer n (>=0) → { n, confirmed: true }        — file is customer data
 *   file null + terms     → { terms.lag, terms.confirmed } — contract continuity
 *   file null + no row    → { 0, confirmed: false }       — PRD: report, don't invent
 *
 * A non-integer file lag ("0.5 ngày" is garbage for a day-granular contract)
 * is treated as OMITTED — carry-forward — so it can never manufacture a
 * confirmed value the customer never stated (e.g. 0.5 → trunc 0 confirmed).
 */
export function resolveImportedFuelLag(
  fileLagDays: number | null | undefined,
  currentTerms: FreightLagSourceTerms | null | undefined,
): ResolvedFreightLag {
  if (fileLagDays != null && Number.isInteger(fileLagDays) && fileLagDays >= 0) {
    return { fuelLagDays: fileLagDays, fuelLagConfirmed: true, carriedForward: false };
  }
  if (currentTerms != null) {
    const lag = currentTerms.fuelLagDays != null && Number.isFinite(currentTerms.fuelLagDays)
      ? Math.max(0, Math.trunc(currentTerms.fuelLagDays))
      : 0;
    return { fuelLagDays: lag, fuelLagConfirmed: currentTerms.fuelLagConfirmed, carriedForward: true };
  }
  return { fuelLagDays: 0, fuelLagConfirmed: false, carriedForward: false };
}
