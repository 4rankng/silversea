import { ArrowLeft, Pencil } from 'lucide-react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';

export interface ShipmentViewActionsProps {
  /** Exit the review — deterministic home is the lô list (/shipments). */
  onBack: () => void;
  /** Navigate to /shipments/:id/edit. Omitted → the role may not edit lots,
   *  so the pair degrades to "Quay lại" alone (same split the old page's
   *  Sửa lô button used). */
  onEdit?: () => void;
  /** The lot carries an accounting lock — editing is refused server-side, so
   *  the button stays visible but disabled and says why. */
  editLocked?: boolean;
  /** Same layout slot contract as ShipmentCreateActions (topline flex row vs
   *  footer bar; footer names itself for screen readers). */
  className?: string;
  variant?: 'topline' | 'footer';
}

/**
 * SIL-481 (ruling 25/10): the post-create review (/shipments/:id) shows the
 * Tạo lô hàng workspace read-only, so its action pair replaces the create
 * cluster (Huỷ / Lưu nháp / Tạo lô hàng) with "Quay lại" + "Chuyển sang sửa"
 * — the "post view action after create" the owner asked for. Rendered twice
 * (topline + footer) through the same FB-108 repetition the create cluster
 * uses, hence the same variant/aria-label law.
 */
export function ShipmentViewActions({
  onBack,
  onEdit,
  editLocked = false,
  className,
  variant = 'topline',
}: ShipmentViewActionsProps) {
  const footer = variant === 'footer';
  const label = (text: string) => (footer ? `${text} (cuối trang)` : undefined);
  return (
    <div
      className={[footer ? 'csc-actions csc-actions--footer' : 'csc-actions', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={footer ? 'Thao tác xem lô hàng (cuối trang)' : 'Thao tác xem lô hàng'}
    >
      <UUIButton
        type="button"
        size="md"
        color="tertiary"
        iconLeading={ArrowLeft}
        onClick={onBack}
        aria-label={label('Quay lại')}
      >
        Quay lại
      </UUIButton>
      {onEdit && (
        <UUIButton
          type="button"
          size="md"
          color="primary"
          className="min-h-11"
          iconLeading={Pencil}
          onClick={onEdit}
          isDisabled={editLocked}
          aria-label={label(editLocked ? 'Chuyển sang sửa — lô đã khóa kế toán' : 'Chuyển sang sửa')}
        >
          Chuyển sang sửa
        </UUIButton>
      )}
    </div>
  );
}
