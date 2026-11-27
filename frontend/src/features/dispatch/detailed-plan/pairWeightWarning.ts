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
 * SIL-1148 (KB Ch.3 §3.6 K3.52 + Ch.4 K4.59) — the trigger keys on the rig's
 * DECLARED rating, not the snapshot: since the SIL-674 inference
 * (dispatch-planning-commands.service.ts: mooc-type bucket ?? tractor tow
 * rating) trips.vehicleCapacityKg is almost never null, so the
 * missing-capacity branch went unreachable exactly for the rigs whose
 * 'Tải trọng tối đa' is undeclared — QA r40b (R4CHK1B-FCL01 pattern,
 * 2×20DC 5t on 15H-104.03) paired with no warning at all. When the dialog
 * can resolve the trailers' declared payload, THAT value owns the verdict:
 * undeclared → the capacity-missing advisory; declared → the overload check
 * runs against it, with the total vs declared named in the text.
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
  /** SIL-1148 — the rig's DECLARED 'Tải trọng tối đa' (trailers.max_payload_tons, kg).
   *  undefined = no trailer fact resolvable (catalog still loading / trailer
   *  gone) → the snapshot law below keeps owning the verdict; null = trailer
   *  record exists but the rating is undeclared → 'xe chưa khai tải trọng'. */
  declaredCapacityKg?: number | null;
}

/** The soft warning the dispatcher must see BEFORE saving this pair, or null
 *  when the case proves clean (no nag on a healthy pair). */
export function pairWeightPreSaveWarning(
  first: PairWeightFacts,
  second: PairWeightFacts,
): string | null {
  // SIL-1148 — trailer facts resolved: the DECLARED rating owns the verdict.
  if (first.declaredCapacityKg !== undefined || second.declaredCapacityKg !== undefined) {
    const totalKg = totalWeightKg(first.cargoWeightKg, second.cargoWeightKg);
    const firstDeclared = toFinite(first.declaredCapacityKg);
    const secondDeclared = toFinite(second.declaredCapacityKg);
    if (firstDeclared == null || secondDeclared == null) {
      // The rig's 'Tải trọng tối đa' is undeclared: the total cannot be
      // checked against a declaration — the missing-capacity advisory owns
      // the case (soft, still saves), with the computable total named.
      return totalKg != null
        ? `${PAIR_CAPACITY_MISSING_MESSAGE} (Tổng trọng 2 cont: ${totalKg.toLocaleString('vi-VN')} kg)`
        : PAIR_CAPACITY_MISSING_MESSAGE;
    }
    if (Math.abs(firstDeclared - secondDeclared) > 0.001) return null;
    if (totalKg == null) return null;
    if (totalKg > firstDeclared) {
      return `${KEP_WEIGHT_WARNING_MESSAGE} (Tổng trọng 2 cont: ${totalKg.toLocaleString('vi-VN')} kg — Tải trọng khai báo của xe: ${firstDeclared.toLocaleString('vi-VN')} kg)`;
    }
    return null;
  }

  const firstCapacity = toFinite(first.vehicleCapacityKg);
  const secondCapacity = toFinite(second.vehicleCapacityKg);
  // No declared capacity on either leg: the total cannot be checked, so the
  // backend's missing-capacity advisory owns the case (soft, still saves).
  if (firstCapacity == null || secondCapacity == null) return PAIR_CAPACITY_MISSING_MESSAGE;
  // Two DECLARED but differing ratings are a data anomaly the backend hard
  // refuses (422 'Tải trọng xe phải thống nhất giữa hai chuyến ghép') before
  // any advisory — nothing soft to mirror here.
  if (Math.abs(firstCapacity - secondCapacity) > 0.001) return null;
  const totalKg = totalWeightKg(first.cargoWeightKg, second.cargoWeightKg);
  // An unprovable total (missing/junk weight) stays silent here too — the
  // backend verdict is 'unprovable' and its own advisory only covers a
  // missing capacity.
  if (totalKg == null) return null;
  return totalKg > firstCapacity ? KEP_WEIGHT_WARNING_MESSAGE : null;
}

/** The pair's provable total, or null when either leg's weight is missing/
 *  junk — the lockstep mirror of the backend's weights-every gate
 *  (trip-pair-rules.service.ts kepPairWeightVerdict). */
function totalWeightKg(first: number, second: number): number | null {
  const firstWeight = toFinite(first);
  const secondWeight = toFinite(second);
  if (firstWeight == null || secondWeight == null) return null;
  return firstWeight + secondWeight;
}

// All fact fields (capacities, weights) normalize through this one shape and
// must never disagree — the lockstep mirror of the backend's toNumber
// (trip-pairs.service.ts), which folds null and non-finite into the same
// "no value" verdict.
function toFinite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}
