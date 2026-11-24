/**
 * SIL-969 (KB Ch.3 §3.3.6, K3.52) — pre-save mirror of the pair dialog's
 * weight advisories.
 *
 * The backend attaches these two advisories to the POST /trips/pairs response
 * AFTER the insert (createTripPairCoreInTx, backend/src/services/trip-pairs.service.ts).
 * K3.52 requires them BEFORE the save as a soft 'Vẫn lưu?' confirm the
 * dispatcher can still decline. This module runs the same pure law
 * (kepPairWeightVerdict + the capacityMissing branch, trip-pair-rules.service.ts)
 * over the drafts the dialog is about to submit — the backend save rules are
 * NOT changed and stay the authority: a warning it returns that this helper
 * did not predict still renders post-save.
 *
 * Texts are DOC verbatim copies — keep in sync with KEP_WEIGHT_WARNING_MESSAGE
 * (backend trip-pair-rules.service.ts) and the capacityMissing advisory
 * (backend trip-pairs.service.ts).
 */
export const KEP_WEIGHT_WARNING_MESSAGE =
  'Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại';

export const PAIR_CAPACITY_MISSING_MESSAGE =
  'Xe chưa khai tải trọng trong danh mục — hệ thống không đối chiếu được tổng trọng lượng cặp. Điều vận chịu trách nhiệm kiểm tra tải trước khi chạy.';

export interface PairWeightFacts {
  cargoWeightKg: number;
  vehicleCapacityKg: number | null;
}

/**
 * The soft warning the dispatcher must see BEFORE saving this pair, or null
 * when the case proves clean (no nag on a healthy pair).
 */
export function pairWeightPreSaveWarning(
  first: PairWeightFacts,
  second: PairWeightFacts,
): string | null {
  const firstCapacity = toFinite(first.vehicleCapacityKg);
  const secondCapacity = toFinite(second.vehicleCapacityKg);
  // No declared capacity on either leg: the total cannot be checked, so the
  // backend's missing-capacity advisory owns the case (soft, still saves).
  if (firstCapacity == null || secondCapacity == null) return PAIR_CAPACITY_MISSING_MESSAGE;
  // Two DECLARED but differing ratings are a data anomaly the backend hard
  // refuses (422 'Tải trọng xe phải thống nhất giữa hai chuyến ghép') before
  // any advisory — nothing soft to mirror here.
  if (Math.abs(firstCapacity - secondCapacity) > 0.001) return null;
  const firstWeight = toFinite(first.cargoWeightKg);
  const secondWeight = toFinite(second.cargoWeightKg);
  // An unprovable total (missing/junk weight) stays silent here too — the
  // backend verdict is 'unprovable' and its own advisory only covers a
  // missing capacity.
  if (firstWeight == null || secondWeight == null) return null;
  return firstWeight + secondWeight > firstCapacity ? KEP_WEIGHT_WARNING_MESSAGE : null;
}

// Four fields (two capacities, two weights) normalize through this one shape
// and must never disagree — the lockstep mirror of the backend's toNumber
// (trip-pairs.service.ts), which folds null and non-finite into the same
// "no value" verdict.
function toFinite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}
