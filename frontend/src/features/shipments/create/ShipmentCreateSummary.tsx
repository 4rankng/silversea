import { AlertCircle, Check, Circle, X } from 'lucide-react';
import { SHIPMENT_STATUS_LABELS, ShipmentStatus } from '@tingting/shared';
import { StatusStrip } from '../../../components/shared/StatusStrip';
import type {
  SaveIntent,
  ShipmentCreateIssue,
  ShipmentCreateReadiness,
  ShipmentCreateSectionId,
} from './shipment-create-model';

interface ShipmentCreateSummaryProps {
  readiness: ShipmentCreateReadiness;
  validationIssues: ShipmentCreateIssue[];
  saving: SaveIntent | null;
  submitError: string | null;
  onNavigateSection: (sectionId: ShipmentCreateSectionId) => void;
  onFocusIssue: (fieldId: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}

export function ShipmentCreateSummary({
  readiness,
  validationIssues,
  saving,
  submitError,
  onNavigateSection,
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

      {validationIssues.length === 0 && (
        <section className="csc-summary__section" aria-labelledby="csc-readiness-title">
          <div className="csc-summary__heading">
            <div>
              <span className="csc-summary__eyebrow">Tiến độ</span>
              <h2 id="csc-readiness-title">Sẵn sàng điều phối</h2>
            </div>
            <strong>{readiness.sections.filter((section) => section.complete).length}/4</strong>
          </div>
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
          <nav className="csc-readiness" aria-label="Đi đến phần nhập liệu">
            {readiness.sections.map((section, index) => (
              <button
                key={section.id}
                type="button"
                data-status={section.complete ? 'complete' : 'incomplete'}
                onClick={() => onNavigateSection(section.id)}
                aria-label={`${section.label}: ${section.complete ? 'đã đủ thông tin' : `còn thiếu ${section.missingCount} mục`}`}
              >
                <span className="csc-readiness__index">{index + 1}</span>
                <span>
                  <strong>{section.label}</strong>
                  <small>{section.complete ? 'Đã đủ thông tin' : `Còn thiếu ${section.missingCount} mục`}</small>
                </span>
                {section.complete
                  ? <Check size={18} aria-hidden="true" />
                  : <Circle size={18} aria-hidden="true" />}
              </button>
            ))}
          </nav>
        </section>
      )}

      <section className="csc-summary__section csc-summary__actions" aria-label="Thao tác tạo lô hàng">
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
