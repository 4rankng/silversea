import { Check, Save, X } from 'lucide-react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import type { SaveIntent } from './shipment-create-model';

export interface ShipmentCreateActionsProps {
  saving: SaveIntent | null;
  onCancel: () => void;
  onSaveDraft: () => void;
  onCreate: () => void;
  /** Extra class for the cluster element — the topline keeps its own
   *  `.csc-topline__actions` layout class instead of gaining a wrapper div,
   *  which would break the topline's single flex row. */
  className?: string;
  /**
   * Card 171026115830 (FB-108): the SAME cluster renders twice on the page —
   * in the topline and again at the end of the worksheet, so a clerk who has
   * scrolled to the last field does not have to scroll back up to act. The two
   * clusters therefore share visible labels, which would make them
   * indistinguishable to a screen reader (and to `getByRole('button', {name})`
   * — duplicate matches are ambiguous), so the footer variant names itself.
   */
  variant?: 'topline' | 'footer';
}

/** The three create-page actions (Huỷ / Lưu nháp / Tạo lô hàng).
 *
 * The two save actions are DIFFERENT intents (owner-confirmed):
 * `Lưu nháp` = partial create (customer only, SaveIntent 'DRAFT'),
 * `Tạo lô hàng` = full intake validation (SaveIntent 'CREATE'). Neither submits
 * for dispatch. */
export function ShipmentCreateActions({
  saving,
  onCancel,
  onSaveDraft,
  onCreate,
  className,
  variant = 'topline',
}: ShipmentCreateActionsProps) {
  const footer = variant === 'footer';
  const label = (text: string) => (footer ? `${text} (cuối trang)` : undefined);
  return (
    <div
      className={[footer ? 'csc-actions csc-actions--footer' : 'csc-actions', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={footer ? 'Thao tác tạo lô hàng (cuối trang)' : 'Thao tác tạo lô hàng'}
    >
      <UUIButton
        type="button"
        size="md"
        color="tertiary"
        iconLeading={X}
        onClick={onCancel}
        isDisabled={Boolean(saving)}
        aria-label={label('Huỷ')}
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
        aria-label={label(saving === 'DRAFT' ? 'Đang lưu…' : 'Lưu nháp')}
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
        aria-label={label(saving === 'CREATE' ? 'Đang tạo…' : 'Tạo lô hàng')}
      >
        {saving === 'CREATE' ? 'Đang tạo…' : 'Tạo lô hàng'}
      </UUIButton>
    </div>
  );
}
