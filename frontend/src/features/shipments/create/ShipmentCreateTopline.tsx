import { Check, Save, X } from 'lucide-react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import type { SaveIntent } from './shipment-create-model';

interface ShipmentCreateToplineProps {
  saving: SaveIntent | null;
  requiredDone: number;
  requiredTotal: number;
  onCancel: () => void;
  onSaveDraft: () => void;
  onCreate: () => void;
}

/* Owner mock 11/10 ("Tạo lô hàng – dense layout.html"): the page title, the
 * required-field progress and the three actions ride ONE topline at the head
 * of the worksheet. The fixed bottom action bar the same mock superseded is
 * retired, so phones scroll back here to act.
 *
 * The two save actions are DIFFERENT intents (owner-confirmed):
 * `Lưu nháp` = partial create (customer only, SaveIntent 'DRAFT'),
 * `Tạo lô hàng` = full intake validation (SaveIntent 'CREATE'). Neither
 * submits for dispatch. */
export function ShipmentCreateTopline({
  saving,
  requiredDone,
  requiredTotal,
  onCancel,
  onSaveDraft,
  onCreate,
}: ShipmentCreateToplineProps) {
  return (
    <div className="csc-topline">
      <h1 className="csc-topline__title">Tạo lô hàng</h1>
      <span className="csc-topline__progress">
        Bắt buộc: <strong>{requiredDone}/{requiredTotal}</strong>
      </span>
      <div className="csc-topline__actions" role="group" aria-label="Thao tác tạo lô hàng">
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
          color="secondary"
          iconLeading={Save}
          onClick={onSaveDraft}
          isDisabled={Boolean(saving)}
        >
          {saving === 'DRAFT' ? 'Đang lưu…' : 'Lưu nháp'}
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
          {saving === 'CREATE' ? 'Đang tạo…' : 'Tạo lô hàng'}
        </UUIButton>
      </div>
    </div>
  );
}
