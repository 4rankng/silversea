import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { TextField } from '../../../design-system';
import type { IssueOrderDraft, OwnTruckDriver } from './useIssueOrder';

interface IssueOrderFieldsProps {
  row: DispatchDetailPlanRow;
  ownTruck: OwnTruckDriver | null;
  loadingOwnTruck: boolean;
  issueDraft: IssueOrderDraft;
  setIssueDraft: (updater: (current: IssueOrderDraft) => IssueOrderDraft) => void;
  onFieldTouched: () => void;
  /** Distinguishes DOM ids between the inline editor's issue section and the
   *  grid's standalone quick-issue dialog when both could exist in the DOM. */
  idPrefix?: string;
}

/**
 * Driver + planned-time inputs for issuing a dispatch order — shared by the
 * full plan editor's inline "Phát lệnh" section and the grid's quick-issue
 * dialog so both surfaces collect the exact same data the same way.
 */
export function IssueOrderFields({
  row,
  ownTruck,
  loadingOwnTruck,
  issueDraft,
  setIssueDraft,
  onFieldTouched,
  idPrefix = 'dispatch-issue',
}: IssueOrderFieldsProps) {
  const currentPlate = row.dispatch.assignedPlate;
  return (
    <>
      {row.dispatch.carrierType === 'OWN' ? (
        <p className="dispatch-assignment-dialog__issue-driver">
          Tài xế: {loadingOwnTruck
            ? 'Đang tải…'
            : ownTruck?.driverName ?? (
              <span className="dispatch-assignment-dialog__issue-warning">
                Xe {currentPlate} chưa gán tài xế — vào Danh mục Xe nội bộ để gán trước.
              </span>
            )}
        </p>
      ) : (
        <>
          <TextField
            id={`${idPrefix}-driver-name-${row.fulfillmentId}`}
            label="Tên tài xế (nhà xe ngoài) — không bắt buộc"
            autoComplete="off"
            value={issueDraft.externalDriverName}
            onChange={(event) => { setIssueDraft((current) => ({ ...current, externalDriverName: event.target.value })); onFieldTouched(); }}
          />
          <TextField
            id={`${idPrefix}-driver-phone-${row.fulfillmentId}`}
            label="SĐT tài xế (nhà xe ngoài)"
            autoComplete="off"
            value={issueDraft.externalDriverPhone}
            onChange={(event) => { setIssueDraft((current) => ({ ...current, externalDriverPhone: event.target.value })); onFieldTouched(); }}
          />
        </>
      )}
      <div className="dispatch-assignment-dialog__issue-times">
        <label htmlFor={`${idPrefix}-start-${row.fulfillmentId}`}>
          <span>Giờ chạy</span>
          <input
            id={`${idPrefix}-start-${row.fulfillmentId}`}
            type="datetime-local"
            className="input"
            value={issueDraft.plannedStartAt}
            onChange={(event) => { setIssueDraft((current) => ({ ...current, plannedStartAt: event.target.value })); onFieldTouched(); }}
          />
        </label>
        <label htmlFor={`${idPrefix}-end-${row.fulfillmentId}`}>
          <span>Giờ kết thúc</span>
          <input
            id={`${idPrefix}-end-${row.fulfillmentId}`}
            type="datetime-local"
            className="input"
            value={issueDraft.plannedEndAt}
            onChange={(event) => { setIssueDraft((current) => ({ ...current, plannedEndAt: event.target.value })); onFieldTouched(); }}
          />
        </label>
      </div>
    </>
  );
}
