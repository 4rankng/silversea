import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

/**
 * Pair-partner candidates for the "Ghép chuyến điều vận" dialog (card 353).
 *
 * The dialog's help text and the customer's expectation (05/10 P1 report)
 * both say the list is the OTHER issued order of the SAME lot ("Lệnh ghép
 * cùng" — "cont còn lại của cặp"). The old inline filter listed every
 * unpaired OWN row in whatever state the grid happened to be in, so a stale
 * window (pre-refetch after issue) hid the sibling entirely while unrelated
 * rows could appear.
 *
 * Contract:
 * - eligible: has a trip, not the base row, not EXTERNAL, unpaired, not CANCELED;
 * - ordering: same-lot siblings FIRST (stable within groups) — the Kẹp case
 *   always sees its partner at the top; cross-lot rows stay available below
 *   for the KẾT HỢP kind.
 */
export function selectPairCandidates(
  rows: DispatchDetailPlanRow[],
  baseRow: DispatchDetailPlanRow | null,
): DispatchDetailPlanRow[] {
  const baseTripId = baseRow?.dispatch?.tripId ?? null;
  const baseShipmentId = baseRow?.shipmentId ?? null;
  const eligible = rows.filter((item) => item.dispatch.tripId != null
    && item.dispatch.tripId !== baseTripId
    && item.dispatch.carrierType !== 'EXTERNAL'
    && !item.dispatch.pairKind
    && item.dispatch.tripStatus !== 'CANCELED');
  return [
    ...eligible.filter((item) => item.shipmentId === baseShipmentId),
    ...eligible.filter((item) => item.shipmentId !== baseShipmentId),
  ];
}

/**
 * SIL-1047 (KB §8.1.2 K8.3) — the "Lệnh ghép cùng" list itself obeys the
 * size law; the server's hard block must stay the backstop, not the first
 * answer. Mirrors the backend's containerFootClass (trip-pair-rules.service):
 * a code starting '20'/'40' PROVES that length; anything else (blank, '45…')
 * is unprovable and keeps the server's bổ-sung-sau convention.
 *
 * - KẸP: a 40ft container never clamps (TC6/1, "Container 40 feet không ghép
 *   Kẹp") — a provable 40ft row drops out of the partner options. The base
 *   row's own size stays the server's judgment (it is not a choice here).
 * - KẾT HỢP: one shell reused — only a PROVEN size mismatch (20 vs 40) drops
 *   a partner; same-size 40+40 stays legal and unprovable sizes stay listed.
 */
export function partnerEligibleForKind(
  candidate: DispatchDetailPlanRow,
  baseRow: DispatchDetailPlanRow | null,
  kind: 'KEP' | 'KET_HOP',
): boolean {
  const baseCode = baseRow?.pricing?.containerTypeCode?.trim() ?? '';
  const partnerCode = candidate.pricing?.containerTypeCode?.trim() ?? '';
  const baseIs20 = baseCode.startsWith('20');
  const baseIs40 = baseCode.startsWith('40');
  const partnerIs20 = partnerCode.startsWith('20');
  const partnerIs40 = partnerCode.startsWith('40');
  if (kind === 'KEP') return !partnerIs40;
  if (baseIs20) return !partnerIs40;
  if (baseIs40) return !partnerIs20;
  return true;
}
