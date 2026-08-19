import { AlertCircle, Check, X } from 'lucide-react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
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

export function ShipmentCreateSummary({
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

      <div className="csc-summary__actions" role="group" aria-label="Thao tác tạo lô hàng">
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
    </aside>
  );
}
