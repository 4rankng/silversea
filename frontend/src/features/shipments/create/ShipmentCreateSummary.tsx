import { AlertCircle, Check, X } from 'lucide-react';
import { SHIPMENT_STATUS_LABELS, ShipmentStatus } from '@tingting/shared';
import { StatusStrip } from '../../../components/shared/StatusStrip';
import type {
  SaveIntent,
  ShipmentCreateIssue,
  ShipmentCreateReadiness,
} from './shipment-create-model';

interface ShipmentCreateSummaryProps {
  readiness: ShipmentCreateReadiness;
  validationIssues: ShipmentCreateIssue[];
  saving: SaveIntent | null;
  submitError: string | null;
  onFocusIssue: (fieldId: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}

export function ShipmentCreateSummary({
  readiness,
  validationIssues,
  saving,
  submitError,
  onFocusIssue,
  onCreate,
  onCancel,
}: ShipmentCreateSummaryProps) {
  return (
    <aside className="csc-summary" aria-label="Tình trạng lô hàng">
      {validationIssues.length > 0 && (
        <div className="csc-validation-summary" role="alert" tabIndex={-1}>
          <div className="csc-validation-summary__title">
            <AlertCircle size={18} aria-hidden="true" />
            <strong>Cần bổ sung {validationIssues.length} thông tin</strong>
          </div>
          <p>Chọn từng mục để chuyển đến trường cần sửa.</p>
          <ol>
            {validationIssues.map((item) => (
              <li key={`${item.fieldId}-${item.message}`}>
                <button type="button" onClick={() => onFocusIssue(item.fieldId)}>{item.message}</button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {submitError && <div className="csc-submit-error" role="alert">{submitError}</div>}

      <section className="csc-summary__section csc-summary__actions" aria-label="Thao tác tạo lô hàng">
        {validationIssues.length === 0 && (
          <div
            className="csc-status-preview"
            data-tone={readiness.initialStatus === ShipmentStatus.READY_FOR_DISPATCH ? 'ready' : 'pending'}
          >
            <StatusStrip
              color={readiness.initialStatus === ShipmentStatus.READY_FOR_DISPATCH
                ? 'var(--success, #16a34a)'
                : 'var(--warning, #d97706)'}
            />
            <span>Trạng thái tự động</span>
            <strong>{SHIPMENT_STATUS_LABELS[readiness.initialStatus]}</strong>
            <small>Hệ thống xác định từ ngày giao, hạn hạ hoặc thời điểm trả container.</small>
          </div>
        )}
        <p>Tạo lô hàng để lưu thông tin. Hệ thống tự xác định trạng thái và hiển thị cho Điều vận theo ngày giao, hạn hạ hoặc thời điểm trả container.</p>
        <button type="button" className="csc-button csc-button--primary" onClick={onCreate} disabled={Boolean(saving)}>
          <Check size={18} aria-hidden="true" />
          {saving === 'DRAFT' ? 'Đang tạo…' : 'Tạo lô hàng'}
        </button>
        <button type="button" className="csc-button csc-button--secondary" onClick={onCancel} disabled={Boolean(saving)}>
          <X size={18} aria-hidden="true" />
          Huỷ
        </button>
      </section>
    </aside>
  );
}
