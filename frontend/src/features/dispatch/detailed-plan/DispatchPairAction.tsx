import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

/**
 * "Ghép chuyến" entry in the detailed-plan classification cell (moved out of
 * `DetailedPlanGrid` so the cell keeps its 400-line ceiling). The offer only
 * makes sense for an own-fleet trip that is alive and not already half of a
 * Kẹp/Kết hợp pair — external trips pair on the carrier's side, canceled
 * trips have nothing left to pair, and `pairKind` means the pair exists.
 */
export function DispatchPairAction({ row, onOpenPair }: {
  row: DispatchDetailPlanRow;
  /** Opens the ghép chuyến dialog anchored on this row's trip — pages that
   *  don't mount the dialog simply don't get the button. */
  onOpenPair?: (row: DispatchDetailPlanRow) => void;
}) {
  if (!onOpenPair
    || row.dispatch?.tripId == null
    || row.dispatch.carrierType === 'EXTERNAL'
    || row.dispatch.pairKind
    || row.dispatch.tripStatus === 'CANCELED') {
    return null;
  }
  return (
    <button
      type="button"
      className="btn btn--secondary btn--sm detailed-plan-grid__pair-btn"
      onClick={() => onOpenPair(row)}
    >
      Ghép chuyến
    </button>
  );
}
