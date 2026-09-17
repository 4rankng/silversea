/**
 * Dispatch-issue status — the ONE shared derivation distinguishing "xếp xe
 * done but order not issued" from "order issued to the driver". Both the CUS
 * workspace and the Điều vận detail plan derive their status chip from this
 * module so the two screens (and the backend's driver-notification timing,
 * which keys on the same live-trips-row signal) can never drift apart.
 */
import { Badge } from '../../../components/untitled-ui/base/badges/badges';

export type DispatchIssueStatus = 'UNASSIGNED' | 'PLATED_NOT_ISSUED' | 'ISSUED' | 'ACCEPTED' | 'COMPLETED';

export const DISPATCH_ISSUE_STATUS_LABELS: Record<DispatchIssueStatus, string> = {
  UNASSIGNED: 'Chưa xếp xe',
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
  issued: boolean;
  completed?: boolean;
  driverAccepted?: boolean;
}): DispatchIssueStatus {
  if (input.completed) return 'COMPLETED';
  if (input.issued) return input.driverAccepted ? 'ACCEPTED' : 'ISSUED';
  if (input.vehicleAssigned) return 'PLATED_NOT_ISSUED';
  return 'UNASSIGNED';
}

export function dispatchIssueStatusBadgeColor(status: DispatchIssueStatus): 'gray' | 'warning' | 'success' {
  switch (status) {
    case 'ISSUED':
    case 'COMPLETED': return 'success';
    case 'PLATED_NOT_ISSUED': return 'warning';
    default: return 'gray';
  }
}

/** Status chip for fulfillment-level rows (Điều vận detail plan grid). */
export function DispatchIssueStatusChip({ status }: { status: DispatchIssueStatus }) {
  return (
    <Badge type="pill-color" size="sm" color={dispatchIssueStatusBadgeColor(status)}>
      {DISPATCH_ISSUE_STATUS_LABELS[status]}
    </Badge>
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
    <Badge type="pill-color" size="sm" color={dispatchIssueStatusBadgeColor(status)}>
      {status === 'PLATED_NOT_ISSUED'
        ? DISPATCH_ISSUE_STATUS_LABELS.PLATED_NOT_ISSUED
        : partial
          ? `Đã phát lệnh ${issued}/${total} cont`
          : DISPATCH_ISSUE_STATUS_LABELS.ISSUED}
    </Badge>
  );
}
