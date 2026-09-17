import { Loader2, Send } from 'lucide-react';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';
import { useIssueOrder } from './useIssueOrder';

interface QuickIssueOrderButtonProps {
  row: DispatchDetailPlanRow;
  onIssueOrder: (
    row: DispatchDetailPlanRow,
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>,
  ) => Promise<DispatchShipmentResponse>;
}

/** Release a saved assignment immediately; planning times stay owned by CUS. */
export function QuickIssueOrderButton({ row, onIssueOrder }: QuickIssueOrderButtonProps) {
  const { issue, issuing, issueError } = useIssueOrder({
    row, open: false, canIssue: true, onIssueOrder, onIssued: () => undefined,
  });
  const identity = row.container.containerNumber || row.docs.billNumber || row.shipmentCode || `dòng ${row.fulfillmentId}`;
  return (
    <div>
      <button
        type="button"
        className="detailed-plan-grid__note-action detailed-plan-grid__note-action--icon"
        onClick={() => void issue()}
        disabled={issuing}
        aria-busy={issuing}
        aria-label={`${issuing ? 'Đang phát lệnh' : 'Phát lệnh'} · ${identity}`}
        title="Phát lệnh ngay theo thông tin điều phối đã lưu"
      >
        {issuing
          ? <Loader2 size={14} className="tt-animate-spin" aria-hidden="true" />
          : <Send size={14} aria-hidden="true" />}
      </button>
      {issueError && <p className="dispatch-assignment-dialog__error" role="alert">{issueError}</p>}
    </div>
  );
}
