import { AlertCircle } from 'lucide-react';
import type { ShipmentCreateIssue } from './shipment-create-model';

interface ShipmentCreateSummaryProps {
  validationIssues: ShipmentCreateIssue[];
  submitError: string | null;
  onFocusIssue: (fieldId: string) => void;
}

/* The validation/summary block. The create actions no longer live here: the
 * owner mock 11/10 moved them onto the page topline (ShipmentCreateTopline)
 * and retired the fixed bottom bar this file used to own — so the file is
 * just the in-flow state surface now: the issue list, and a submit failure
 * (danger styling, announced once). */
export function ShipmentCreateSummary({
  validationIssues,
  submitError,
  onFocusIssue,
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
    </aside>
  );
}
