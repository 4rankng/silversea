import { Loader2 } from 'lucide-react';
import {
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { ContainerLedger, type ContainerLedgerHandle } from './CusContainerLedger';

export function ShipmentDetailContent({
  detail,
  loading,
  error,
  onRetry,
  onLineSaved,
  getIdempotencyKey,
  clearIdempotencyKey,
  idPrefix,
  onCollapse,
  onDirtyChange,
  onSavingChange,
  actionsRef,
  onExternalTripCompleted,
  onDetailStale,
  onAppointmentSavedAndExit,
}: {
  detail?: ShipmentCusWorkspaceDetail;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onLineSaved: (line: ShipmentCusWorkspaceContainerLine | null) => Promise<void>;
  getIdempotencyKey: (signature: string) => string;
  clearIdempotencyKey: (withSignature: string) => void;
  idPrefix: string;
  onCollapse?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  actionsRef?: React.MutableRefObject<ContainerLedgerHandle | null>;
  /** Detail refetch after a staff close — completion advances the shipment. */
  onExternalTripCompleted?: () => void;
  /** FB-086 (round 19): optimistic-version 409 on a container add — the host
   *  force-reloads the drawer detail so the retry uses the fresh version. */
  onDetailStale?: () => void;
  /** Fires once after an appointment popover commit settles successfully — the
   *  host closes the detail surface so Enter returns the user to the list,
   *  matching the drawer footer's save-then-close behavior. */
  onAppointmentSavedAndExit?: () => void;
}) {
  return (
    <div className="cus-detail-content">
      {loading && !detail ? (
        <div className="cus-detail-loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải dữ liệu container…</div>
      ) : error ? (
        <div className="cus-inline-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Thử lại</button></div>
      ) : detail ? (
        <ContainerLedger
          detail={detail}
          onLineSaved={onLineSaved}
          getIdempotencyKey={getIdempotencyKey}
          clearIdempotencyKey={clearIdempotencyKey}
          idPrefix={idPrefix}
          onCollapse={onCollapse}
          onDirtyChange={onDirtyChange}
          onSavingChange={onSavingChange}
          actionsRef={actionsRef}
          onAppointmentSavedAndExit={onAppointmentSavedAndExit}
          onExternalTripCompleted={onExternalTripCompleted}
          onDetailStale={onDetailStale}
        />
      ) : null}
    </div>
  );
}
