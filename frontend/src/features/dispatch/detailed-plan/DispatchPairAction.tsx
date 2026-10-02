import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { billBookingReference } from '../../../lib/business-reference';

interface DispatchPairActionProps {
  row: DispatchDetailPlanRow;
  onOpenPair?: (row: DispatchDetailPlanRow) => void;
}

/** Existing unpaired own-carrier row action, shared by the detailed-plan grid. */
export function DispatchPairAction({ row, onOpenPair }: DispatchPairActionProps) {
  if (!onOpenPair
    || row.dispatch?.tripId == null
    || row.dispatch.carrierType === 'EXTERNAL'
    || row.dispatch.pairKind
    || row.dispatch.tripStatus === 'CANCELED') return null;

  return (
    <button
      type="button"
      className="btn btn--secondary btn--sm detailed-plan-grid__pair-btn"
      onClick={() => onOpenPair(row)}
      aria-label="Ghép chuyến"
      title={`Ghép chuyến · ${row.container.containerNumber?.trim() || billBookingReference(row.docs.billNumber)}`}
    >
      Ghép
    </button>
  );
}
