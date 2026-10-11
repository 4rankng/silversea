import { AlertCircle, Check, X } from 'lucide-react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { useFixedActionClearance } from '../../../hooks/useFixedActionClearance';
import type {
  SaveIntent,
  ShipmentCreateIssue,
} from './shipment-create-model';

interface ShipmentCreateSummaryProps {
  validationIssues: ShipmentCreateIssue[];
  saving: SaveIntent | null;
  submitError: string | null;
  onFocusIssue: (fieldId: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}

/* Owner mock 11/10 ("Tạo lô hàng.html", UUI modal-foot idiom): the create
 * actions live in a FIXED bottom bar — surface card, hairline top border,
 * status line left, Huỷ + primary Tạo lô hàng right — always reachable
 * without scrolling the long form. The bar owns its safe-area strip (the
 * counted-once law: env() padding INSIDE its opaque box) and publishes its
 * measured height as --csc-action-bar-h so the page clearance and the
 * shell scroll-padding track a wrapped bar too (useFixedActionClearance).
 * The bar status carries count/ready states only; a submit failure stays
 * in the flow .csc-submit-error block (danger styling, announced once). */
export function ShipmentCreateSummary({
  validationIssues,
  saving,
  submitError,
  onFocusIssue,
  onCreate,
  onCancel,
}: ShipmentCreateSummaryProps) {
  const barRef = useFixedActionClearance<HTMLElement>('--csc-action-bar-h');
  const status = validationIssues.length > 0
    ? `Cần bổ sung ${validationIssues.length} thông tin để tạo lô.`
    : 'Sẵn sàng tạo lô hàng.';

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

      <div className="csc-action-bar" role="group" aria-label="Thao tác tạo lô hàng" ref={barRef}>
        <p className="csc-action-bar__status" aria-live="polite">{status}</p>
        <div className="csc-action-bar__actions">
          <UUIButton
            type="button"
            size="md"
            color="tertiary"
            iconLeading={X}
            onClick={onCancel}
            isDisabled={Boolean(saving)}
          >
            Huỷ
          </UUIButton>
          <UUIButton
            type="button"
            size="md"
            color="primary"
            className="min-h-11"
            iconLeading={Check}
            onClick={onCreate}
            isDisabled={Boolean(saving)}
          >
            {saving === 'DRAFT' ? 'Đang tạo…' : 'Tạo lô hàng'}
          </UUIButton>
        </div>
      </div>
    </aside>
  );
}
