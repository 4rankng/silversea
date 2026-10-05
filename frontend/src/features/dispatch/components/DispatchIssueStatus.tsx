/**
 * Dispatch-issue status — the ONE shared derivation distinguishing "điều xe
 * done but order not issued" from "order issued to the driver". Both the CUS
 * workspace and the Điều vận detail plan derive their status chip from this
 * module so the two screens (and the backend's driver-notification timing,
 * which keys on the same live-trips-row signal) can never drift apart.
 */
import { StatusText, type StatusVariant } from '../../../components/shared/StatusText';

export type DispatchIssueStatus = 'UNASSIGNED' | 'AWAITING_PLATE' | 'PLATED_NOT_ISSUED' | 'ISSUED' | 'ACCEPTED' | 'COMPLETED';

export const DISPATCH_ISSUE_STATUS_LABELS: Record<DispatchIssueStatus, string> = {
  UNASSIGNED: 'Chưa điều xe',
  AWAITING_PLATE: 'Chờ bổ sung biển',
  PLATED_NOT_ISSUED: 'Đã điều xe',
  ISSUED: 'Đã phát lệnh cho tài xế',
  ACCEPTED: 'Đã nhận lệnh',
  COMPLETED: 'Đã hoàn thành',
};

/**
 * `issued` must come from the same signal the backend gates the driver
 * notification on: a live (non-canceled) trips row for the fulfillment.
 * `vehicleAssigned` is a planned plate/vehicle — visible to the dispatcher,
 * invisible to the driver until issuance.
 * `driverAccepted` (optional) refines ISSUED: the driver acknowledged the
 * order — the same fact the reassignment guard keys on, so the chip shows
 * the lock before the dispatcher edits. Callers without the signal keep the
 * plain ISSUED reading.
 * `completed` outranks both: once the trip closes, the issue lifecycle is
 * over (driver-completed or closed by dispatch/CUS for external carriers).
 */
export function deriveDispatchIssueStatus(input: {
  vehicleAssigned: boolean;
  /** Card 20261004_359 — an external carrier may be assigned while its plate
   *  is deferred ("Bổ sung sau"): issuable, but visibly awaiting the plate. */
  carrierAssigned?: boolean;
  issued: boolean;
  completed?: boolean;
  driverAccepted?: boolean;
}): DispatchIssueStatus {
  if (input.completed) return 'COMPLETED';
  if (input.issued) return input.driverAccepted ? 'ACCEPTED' : 'ISSUED';
  if (input.vehicleAssigned) return 'PLATED_NOT_ISSUED';
  if (input.carrierAssigned) return 'AWAITING_PLATE';
  return 'UNASSIGNED';
}

/** Status tone for the shared text+dot treatment (design law §1: a data cell
 *  is plain text plus the house colour-dot — never a pill bubble or a rounded
 *  fill, which is what the Untitled UI `Badge type="pill-color"` this replaced
 *  rendered: `border-radius: 9999px`, `padding: 2px 8px`). */
export function dispatchIssueStatusVariant(status: DispatchIssueStatus): StatusVariant {
  switch (status) {
    case 'ISSUED':
    case 'COMPLETED': return 'success';
    case 'PLATED_NOT_ISSUED':
    case 'AWAITING_PLATE': return 'warning';
    default: return 'neutral';
  }
}

/** Status chip for fulfillment-level rows (Điều vận detail plan grid).
 *  UNASSIGNED renders nothing: the cell's own plate placeholder already says
 *  the vehicle is unassigned ("Chưa phân xe" / "CUS sẽ bổ sung"), and §1 keeps
 *  one concept in one place — the shipment-level summary chip below has always
 *  returned null for it. */
export function DispatchIssueStatusChip({ status }: { status: DispatchIssueStatus }) {
  if (status === 'UNASSIGNED') return null;
  return (
    <StatusText variant={dispatchIssueStatusVariant(status)} className="dispatch-assignment-cell__issue" style={{ whiteSpace: 'normal' }}>
      {DISPATCH_ISSUE_STATUS_LABELS[status]}
    </StatusText>
  );
}

/**
 * Shipment-level summary chip (CUS workspace). A lot can be part-issued —
 * show counts so the CUS user knows where the lot stands without opening it.
 */
export function DispatchIssueStatusSummaryChip({ plated, issued, total }: { plated: number; issued: number; total: number }) {
  const status = deriveDispatchIssueStatus({ vehicleAssigned: plated > 0, issued: issued > 0 });
  if (status === 'UNASSIGNED') {
    return null;
  }
  const partial = status === 'ISSUED' && issued < total;
  return (
    <StatusText variant={dispatchIssueStatusVariant(status)}>
      {status === 'PLATED_NOT_ISSUED'
        ? DISPATCH_ISSUE_STATUS_LABELS.PLATED_NOT_ISSUED
        : partial
          ? `Đã phát lệnh ${issued}/${total} cont`
          : DISPATCH_ISSUE_STATUS_LABELS.ISSUED}
    </StatusText>
  );
}
