import { Loader2, Send } from 'lucide-react';
import { useEffect } from 'react';
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
  /** Owner redesign 23/10 — the mobile card renders ONE full-text primary
   *  action ("Phát lệnh"); the desktop actions column keeps the compact
   *  icon-only release. Same single-sourced issue flow either way. */
  variant?: 'icon' | 'labeled';
  /** Issue #13 (card 3-dòng, review M1) — the card's action slot is a 44px
   *  head cell with no room for an inline error band. Pass `onError` to
   *  route a failed release to the caller's surface (the card uses the
   *  shared toast); the inline role="alert" paragraph stays the default for
   *  hosts with a full-width context (the old foot geometry). */
  onError?: (message: string) => void;
}

/** Release a saved assignment immediately; planning times stay owned by CUS. */
export function QuickIssueOrderButton({ row, onIssueOrder, variant = 'icon', onError }: QuickIssueOrderButtonProps) {
  const { issue, issuing, issueError, issueConfirmDialog } = useIssueOrder({
    row, open: false, canIssue: true, onIssueOrder, onIssued: () => undefined,
  });
  useEffect(() => {
    if (issueError && onError) onError(issueError);
  }, [issueError, onError]);
  const identity = row.container.containerNumber?.trim() || billBookingReference(row.docs.billNumber);
  return (
    <div>
      {/* Sweep (card 20261008_1): the release used to disable silently while
          an issue was in flight — aria-described explanation (DisabledActionTip). */}
      <DisabledActionTip id={`quick-issue-${row.fulfillmentId}`} reason={issuing ? 'Đang phát lệnh — vui lòng đợi.' : null}>
        <button
          type="button"
          className={`detailed-plan-grid__note-action${variant === 'icon' ? ' detailed-plan-grid__note-action--icon' : ''}`}
          onClick={() => { if (issuing) return; void issue(); }}
          aria-disabled={issuing || undefined}
          aria-busy={issuing}
          aria-label={`${issuing ? 'Đang phát lệnh' : 'Phát lệnh'} · ${identity}`}
          title="Phát lệnh ngay theo thông tin điều phối đã lưu"
        >
          {variant === 'labeled'
            ? (issuing ? 'Đang phát lệnh…' : 'Phát lệnh')
            : issuing
              ? <Loader2 size={14} className="tt-animate-spin" aria-hidden="true" />
              : <Send size={14} aria-hidden="true" />}
        </button>
      </DisabledActionTip>
      {!onError && issueError && <p className="dispatch-assignment-dialog__error" role="alert">{issueError}</p>}
      {issueConfirmDialog}
    </div>
  );
}
