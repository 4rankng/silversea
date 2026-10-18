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

/* The validation/summary block. The create actions no longer live here: the
 * owner mock 11/10 moved them onto the page topline (ShipmentCreateTopline)
 * and retired the fixed bottom bar this file used to own — so the file is
 * just the in-flow state surface now: the outstanding-issue list (card
 * 171026113510) and a submit failure (danger styling, announced once).
 *
 * FB UX de-noise (17/10): the issue list is submit-gated via `showIssues` —
 * the live readiness still drives the topline chip, but the panel itself may
 * only surface once a create attempt happened; a submit failure (submitError)
 * is independent of that gate and keeps its own rendering. */
export function ShipmentCreateSummary({
  outstandingIssues,
  showIssues,
  submitError,
  onFocusIssue,
}: ShipmentCreateSummaryProps) {
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
