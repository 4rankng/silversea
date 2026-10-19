import { AlertCircle } from 'lucide-react';
import type { ShipmentCreateIssue } from './shipment-create-model';

interface ShipmentCreateSummaryProps {
  /** Live outstanding requirements from `getShipmentCreateReadiness` — named
   *  before the first submit, not only after the validator runs. */
  outstandingIssues: ShipmentCreateIssue[];
  /** Submit-attempt gate: the panel must not confront a freshly opened form —
   *  it appears only after the operator clicks an action save ("Tạo lô hàng"
   *  or a failed "Lưu nháp") with issues remaining, then stays live (updating
   *  as fields resolve) until the list is empty. */
  showIssues: boolean;
  submitError: string | null;
  onFocusIssue: (fieldId: string) => void;
}

/* Card 181026180300: Restyle "Cần bổ sung N thông tin" panel into a compact,
 * neutral card (Untitled UI alert/callout style, --surface tokens, no pink/wall).
 * Submit-gated: hidden on initial page load until operator clicks "Tạo lô hàng". */
export function ShipmentCreateSummary({
  outstandingIssues,
  showIssues,
  submitError,
  onFocusIssue,
}: ShipmentCreateSummaryProps) {
  if (!submitError && (!showIssues || outstandingIssues.length === 0)) {
    return null;
  }

  return (
    <aside className="csc-summary" aria-label="Tình trạng lô hàng">
      {showIssues && outstandingIssues.length > 0 && (
        <div className="csc-validation-summary" role="alert" tabIndex={-1}>
          <div className="csc-validation-summary__title">
            <AlertCircle size={15} aria-hidden="true" />
            <strong>Cần bổ sung {outstandingIssues.length} thông tin</strong>
          </div>
          <p>Chọn từng mục để chuyển đến trường cần sửa.</p>
          <ol>
            {outstandingIssues.map((item) => (
              <li key={`${item.fieldId}-${item.message}`}>
                <button type="button" onClick={() => onFocusIssue(item.fieldId)}>{item.message}</button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {submitError && <div className="csc-submit-error" role="alert">{submitError}</div>}
    </aside>
  );
}
