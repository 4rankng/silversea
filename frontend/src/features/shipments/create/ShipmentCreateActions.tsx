import { Check, Save, X } from 'lucide-react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import type { SaveIntent } from './shipment-create-model';

export interface ShipmentCreateActionsProps {
  saving: SaveIntent | null;
  onCancel: () => void;
  onSaveDraft: () => void;
  onCreate: () => void;
  /**
   * SIL-171 (FB-147) edit mode: the cluster becomes Huỷ + one primary
   * "Lưu thay đổi" (the lot PATCH). "Lưu nháp" is create-only intent — a
   * partial save of an EXISTING lot has no draft semantics, so it is hidden
   * rather than repurposed.
   */
  mode?: 'create' | 'edit';
}

/** The create-page actions (Huỷ / Lưu nháp / Tạo lô hàng) and their edit-mode
 *  pair (Huỷ / Lưu thay đổi) — THE one action bar of the worksheet.
 *
 * SIL-510 (owner 26/10): the cluster mounts exactly once, as the
 * viewport-fixed footer bar (`.csc-form-actions`) — always visible while
 * scrolling, one row, actions right-aligned. The topline twin the FB-108
 * card 171026115830 added is retired by the same ruling (never two action
 * bars on one viewport), so the plain accessible names live here alone and
 * the "(cuối trang)" self-naming that only existed to tell the twins apart
 * is gone with them.
 *
 * The two create save actions are DIFFERENT intents (owner-confirmed):
 * `Lưu nháp` = partial create (customer only, SaveIntent 'DRAFT'),
 * `Tạo lô hàng` = full intake validation (SaveIntent 'CREATE'). Neither submits
 * for dispatch. */
export function ShipmentCreateActions({
  saving,
  onCancel,
  onSaveDraft,
  onCreate,
  mode = 'create',
}: ShipmentCreateActionsProps) {
  const edit = mode === 'edit';
  return (
    <div
      className="csc-actions"
      role="group"
      aria-label={edit ? 'Thao tác sửa lô hàng' : 'Thao tác tạo lô hàng'}
    >
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
      {!edit && (
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
      )}
      <UUIButton
        type="button"
        size="md"
        color="primary"
        className="min-h-11"
        iconLeading={Check}
        onClick={onCreate}
        isDisabled={Boolean(saving)}
      >
        {edit
          ? (saving ? 'Đang lưu…' : 'Lưu thay đổi')
          : (saving === 'CREATE' ? 'Đang tạo…' : 'Tạo lô hàng')}
      </UUIButton>
    </div>
  );
}
