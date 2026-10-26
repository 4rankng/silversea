import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';

export interface ShipmentViewActionsProps {
  /** Exit the review — deterministic home is the lô list (/shipments). */
  onBack: () => void;
  /** Navigate to /shipments/:id/edit. Omitted → the role may not edit lots,
   *  so the cluster degrades to "Quay lại" alone (same split the old page's
   *  Sửa lô button used). */
  onEdit?: () => void;
  /** The lot carries an accounting lock — editing is refused server-side, so
   *  the button stays visible but disabled and says why. */
  editLocked?: boolean;
  /** SIL-500: the KH's next-lot loop — navigate to /shipments/new. Omitted
   *  → the role may not create lots (the /shipments/new route bounces the
   *  same authority), so the cluster degrades without it. */
  onCreateNew?: () => void;
}

/**
 * SIL-481 (ruling 25/10): the post-create review (/shipments/:id) shows the
 * Tạo lô hàng workspace read-only, so its action cluster replaces the create
 * cluster (Huỷ / Lưu nháp / Tạo lô hàng) with "Quay lại" + "Sửa"
 * — the "post view action after create" the owner asked for.
 *
 * SIL-510 (owner 26/10): the cluster mounts exactly once, as the
 * viewport-fixed footer bar (`.csc-form-actions`) — the topline twin is
 * retired (never two action bars on one viewport), so the plain accessible
 * names need no "(cuối trang)" self-naming.
 *
 * SIL-500 (KH 26/10): the create cluster's primary "Tạo lô hàng" had no
 * successor on the review — the KH's create → review → next-lot loop died.
 * "Tạo mới lô hàng" (→ /shipments/new) restores it as THE primary, so the
 * cluster keeps the house one-primary law (tertiary → secondary → primary).
 */
export function ShipmentViewActions({
  onBack,
  onEdit,
  editLocked = false,
  onCreateNew,
}: ShipmentViewActionsProps) {
  return (
    <div className="csc-actions" role="group" aria-label="Thao tác xem lô hàng">
      <UUIButton
        type="button"
        size="md"
        color="tertiary"
        iconLeading={ArrowLeft}
        onClick={onBack}
      >
        Quay lại
      </UUIButton>
      {onEdit && (
        <UUIButton
          type="button"
          size="md"
          color="secondary"
          iconLeading={Pencil}
          onClick={onEdit}
          isDisabled={editLocked}
          aria-label={editLocked ? 'Sửa — lô đã khóa kế toán' : undefined}
        >
          Sửa
        </UUIButton>
      )}
      {onCreateNew && (
        <UUIButton
          type="button"
          size="md"
          color="primary"
          className="min-h-11"
          iconLeading={Plus}
          onClick={onCreateNew}
        >
          Tạo mới lô hàng
        </UUIButton>
      )}
    </div>
  );
}
