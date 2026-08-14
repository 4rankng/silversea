import { AlertCircle, Check, Circle, Send } from 'lucide-react';
import type { ShipmentPricingProjection } from '../../../api/shipmentClient';
import type {
  SaveIntent,
  ShipmentCreateIssue,
  ShipmentCreateReadiness,
  ShipmentCreateSectionId,
} from './shipment-create-model';

interface ShipmentCreateSummaryProps {
  readiness: ShipmentCreateReadiness;
  validationIssues: ShipmentCreateIssue[];
  pricingProjection: ShipmentPricingProjection | null;
  pricingLoading: boolean;
  pricingError: string | null;
  saving: SaveIntent | null;
  submitError: string | null;
  onNavigateSection: (sectionId: ShipmentCreateSectionId) => void;
  onFocusIssue: (fieldId: string) => void;
  onSaveDraft: () => void;
  onSubmitDispatch: () => void;
}

function formatVnd(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Math.round(value).toLocaleString('vi-VN')} ₫`;
}

export function ShipmentCreateSummary({
  readiness,
  validationIssues,
  pricingProjection,
  pricingLoading,
  pricingError,
  saving,
  submitError,
  onNavigateSection,
  onFocusIssue,
  onSaveDraft,
  onSubmitDispatch,
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

      <section className="csc-summary__section" aria-labelledby="csc-readiness-title">
        <div className="csc-summary__heading">
          <div>
            <span className="csc-summary__eyebrow">Tiến độ</span>
            <h2 id="csc-readiness-title">Sẵn sàng điều phối</h2>
          </div>
          <strong>{readiness.sections.filter((section) => section.complete).length}/4</strong>
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

      <section className="csc-summary__section" aria-labelledby="csc-pricing-title">
        <div className="csc-summary__heading">
          <div>
            <span className="csc-summary__eyebrow">Đối chiếu</span>
            <h2 id="csc-pricing-title">Cước dự kiến</h2>
          </div>
        </div>
        {pricingLoading && <p className="csc-summary__muted">Đang tính cước và phụ phí nhiên liệu…</p>}
        {!pricingLoading && pricingError && <p className="csc-summary__error" role="alert">{pricingError}</p>}
        {!pricingLoading && !pricingError && !pricingProjection && (
          <p className="csc-summary__muted">Chọn khách hàng, tuyến đường và thông tin hàng để xem cước.</p>
        )}
        {!pricingLoading && !pricingError && pricingProjection && (
          <div className="csc-pricing">
            <p className={pricingProjection.readiness === 'READY' ? '' : 'csc-summary__warning'}>
              {pricingProjection.message}
            </p>
            <dl>
              <div>
                <dt>Cước vận chuyển</dt>
                <dd>{formatVnd(pricingProjection.freightPrice)}</dd>
              </div>
              <div>
                <dt>Phụ phí nhiên liệu</dt>
                <dd>{formatVnd(pricingProjection.expectedFuelSurcharge)}</dd>
              </div>
            </dl>
            {(pricingProjection.freightFormula || pricingProjection.expectedFuelLiters != null) && (
              <div className="csc-pricing__explain">
                {pricingProjection.freightFormula && <p>{pricingProjection.freightFormula}</p>}
                {pricingProjection.expectedFuelLiters != null && (
                  <p>{pricingProjection.expectedFuelLiters.toLocaleString('vi-VN')} lít định mức.</p>
                )}
              </div>
            )}
            {pricingProjection.breakdown.length > 0 && (
              <div className="csc-pricing__breakdown">
                {pricingProjection.breakdown.map((line) => (
                  <div key={`${line.label}-${line.quantity}`}>
                    <span><strong>{line.label}</strong><small>{line.formula}</small></span>
                    <strong>{formatVnd(line.amount)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="csc-summary__section csc-summary__actions" aria-label="Thao tác lưu lô hàng">
        <p>Bản nháp chỉ cần khách hàng. Khi gửi điều phối, hệ thống sẽ kiểm tra toàn bộ thông tin bắt buộc.</p>
        <button type="button" className="csc-button csc-button--secondary" onClick={onSaveDraft} disabled={Boolean(saving)}>
          <Check size={18} aria-hidden="true" />
          {saving === 'DRAFT' ? 'Đang lưu…' : 'Lưu bản nháp'}
        </button>
        <button type="button" className="csc-button csc-button--primary" onClick={onSubmitDispatch} disabled={Boolean(saving)}>
          <Send size={18} aria-hidden="true" />
          {saving === 'SUBMIT' ? 'Đang gửi…' : 'Gửi sang điều phối'}
        </button>
      </section>
    </aside>
  );
}
