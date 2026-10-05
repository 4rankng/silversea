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
