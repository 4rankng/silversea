import { Loader2, Send } from 'lucide-react';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { useIssueOrder } from './useIssueOrder';
import { billBookingReference } from '../../../lib/business-reference';

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
  const identity = row.container.containerNumber?.trim() || billBookingReference(row.docs.billNumber);
  return (
    <div>
      {/* Sweep (card 20261008_1): the release used to disable silently while
          an issue was in flight — aria-described explanation (DisabledActionTip). */}
      <DisabledActionTip id={`quick-issue-${row.fulfillmentId}`} reason={issuing ? 'Đang phát lệnh — vui lòng đợi.' : null}>
        <button
          type="button"
          className="detailed-plan-grid__note-action detailed-plan-grid__note-action--icon"
          onClick={() => { if (issuing) return; void issue(); }}
          aria-disabled={issuing || undefined}
          aria-busy={issuing}
          aria-label={`${issuing ? 'Đang phát lệnh' : 'Phát lệnh'} · ${identity}`}
          title="Phát lệnh ngay theo thông tin điều phối đã lưu"
        >
          {issuing
            ? <Loader2 size={14} className="tt-animate-spin" aria-hidden="true" />
            : <Send size={14} aria-hidden="true" />}
        </button>
      </DisabledActionTip>
      {issueError && <p className="dispatch-assignment-dialog__error" role="alert">{issueError}</p>}
    </div>
  );
}
