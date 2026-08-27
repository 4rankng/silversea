import { Send } from 'lucide-react';
import { Modal } from '../../../components/UI';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';
import { IssueOrderFields } from './IssueOrderFields';
import { useIssueOrder } from './useIssueOrder';
import './DispatchPlanEditorCell.css';

interface QuickIssueOrderDialogProps {
  row: DispatchDetailPlanRow;
  open: boolean;
  onClose: () => void;
  onIssueOrder: (
    row: DispatchDetailPlanRow,
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>,
  ) => Promise<DispatchShipmentResponse>;
}

/**
 * One-click "phát lệnh" entry point from the grid row itself — a compact
 * dialog with only the fields an already-plated row still needs (driver for
 * external carriers, planned times), so dispatchers issuing a batch of
 * ready-to-go containers don't have to open the full carrier/vehicle editor
 * for each one.
 */
export function QuickIssueOrderDialog({ row, open, onClose, onIssueOrder }: QuickIssueOrderDialogProps) {
  const { ownTruck, loadingOwnTruck, issueDraft, setIssueDraft, issuing, issueError, setIssueError, issue } =
    useIssueOrder({ row, open, canIssue: open, onIssueOrder, onIssued: onClose });

  const identity = row.container.containerNumber || row.docs.billNumber || row.shipmentCode || `dòng ${row.fulfillmentId}`;
  const subtitle = [row.dispatch.carrierName, row.dispatch.assignedPlate].filter(Boolean).join(' · ');

  return (
    <Modal
      isOpen={open}
      title={`Phát lệnh · ${identity}`}
      onClose={() => { if (!issuing) onClose(); }}
      maxWidth={440}
      footer={(
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={issuing}>Hủy</button>
          <button
            type="button"
            className="btn btn--primary dispatch-assignment-dialog__issue-btn"
            onClick={() => void issue()}
            disabled={issuing}
          >
            <Send size={16} aria-hidden="true" />
            {issuing ? 'Đang phát lệnh…' : 'Phát lệnh'}
          </button>
        </>
      )}
    >
      <fieldset className="dispatch-assignment-dialog__issue" disabled={issuing}>
        <legend>{subtitle ? `Phát lệnh cho tài xế · ${subtitle}` : 'Phát lệnh cho tài xế'}</legend>
        <IssueOrderFields
          idPrefix="quick-issue"
          row={row}
          ownTruck={ownTruck}
          loadingOwnTruck={loadingOwnTruck}
          issueDraft={issueDraft}
          setIssueDraft={setIssueDraft}
          onFieldTouched={() => setIssueError(null)}
        />
        {issueError && <p className="dispatch-assignment-dialog__error" role="alert">{issueError}</p>}
      </fieldset>
    </Modal>
  );
}
