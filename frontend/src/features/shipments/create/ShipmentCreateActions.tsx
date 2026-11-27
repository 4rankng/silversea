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
  /** Which twin bar this instance rides (SIL-917, KB §3.2.7): the page-head
   *  topline cluster keeps the plain accessible names; the viewport-fixed
   *  footer twin self-names "(cuối trang)" exactly as the KB labels it, so
   *  screen readers (and tests) can tell the two bars apart. Edit mode has
   *  no head twin, so its footer stays unsuffixed. */
  bar?: 'head' | 'foot';
}

/** The create-page actions (Huỷ / Lưu nháp / Tạo lô hàng) and their edit-mode
 *  pair (Huỷ / Lưu thay đổi).
 *
 *  SIL-510 (owner 26/10) ruled ONE action bar per viewport; SIL-917 (KB
 *  §3.2.7, audit 24/11) supersedes it: the cluster mounts TWICE on the
 *  create worksheet — once at the page head (`.csc-topline__actions`) and
 *  once as the viewport-fixed footer (`.csc-form-actions`), the footer
 *  carrying the KB's "(cuối trang)" labels. Both instances share the same
 *  handlers and saving state. The topline twin the FB-108 card had added
 *  once before is therefore BACK, by the same authority that retired it.
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
  bar = 'foot',
}: ShipmentCreateActionsProps) {
  const edit = mode === 'edit';
  const footCreate = !edit && bar === 'foot';
  return (
    <div
      className="csc-actions"
      data-bar={bar}
      role="group"
      aria-label={edit ? 'Thao tác sửa lô hàng' : (footCreate ? 'Thao tác tạo lô hàng (cuối trang)' : 'Thao tác tạo lô hàng')}
    >
      <UUIButton
        type="button"
        size="md"
        color="tertiary"
        iconLeading={X}
        onClick={onCancel}
        isDisabled={Boolean(saving)}
        aria-label={footCreate ? 'Huỷ (cuối trang)' : undefined}
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
          aria-label={footCreate && saving !== 'DRAFT' ? 'Lưu nháp (cuối trang)' : undefined}
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
        aria-label={footCreate ? (saving === 'CREATE' ? 'Đang tạo… (cuối trang)' : 'Tạo lô hàng (cuối trang)') : undefined}
      >
        {edit
          ? (saving ? 'Đang lưu…' : 'Lưu thay đổi')
          : (saving === 'CREATE' ? 'Đang tạo…' : 'Tạo lô hàng')}
      </UUIButton>
    </div>
  );
}
