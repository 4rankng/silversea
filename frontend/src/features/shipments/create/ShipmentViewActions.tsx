import { ArrowLeft, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
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
  /** SIL-453 (FB-098 restore, QA fail 06/11): open the shared "Thêm khoản
   *  chi" drawer at lot scope. Omitted → the role trio refuses (BE
   *  `requireExpenseFinance` = ADMIN/MANAGER/ACCOUNTANT) OR the lot is
   *  accounting-locked (the card's own "ẩn khi khóa kế toán" law) — the
   *  affordance is not rendered at all, exactly like onEdit/onDelete. */
  onDeclareCost?: () => void;
  /** SIL-500: the KH's next-lot loop — navigate to /shipments/new. Omitted
   *  → the role may not create lots (the /shipments/new route bounces the
   *  same authority), so the cluster degrades without it. */
  onCreateNew?: () => void;
  /** SIL-688 (id 800 — QA 06/11): open the Xóa lô confirm. Omitted → the
   *  role may not delete lots (BE `requireRoles(CUS, ADMIN)`), so the
   *  cluster renders without the destructive affordance at all. */
  onDelete?: () => void;
  /** Accounting lock — the BE refuses the delete on a locked lot, so the
   *  button disables with the same reason voice as Sửa. */
  deleteLocked?: boolean;
  /** Lifecycle guard: the lot carries a dispatched leg — delete would 409,
   *  so the button disables and the reason rides the accessible description
   *  (the same message the BE answers with). */
  deleteBlockedReason?: string;
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
 *
 * SIL-688 (id 800, QA 06/11): "Xóa lô" joins the review cluster LAST in the
 * danger voice (`secondary-destructive` — the same treatment the dispatch
 * row menu's Xóa lô law mandates: destructive actions last, distinct
 * voice). It never renders for roles the BE delete refuses (CUS/ADMIN
 * only), and it disables with a reason on a locked or dispatched lot.
 */
export function ShipmentViewActions({
  onBack,
  onEdit,
  editLocked = false,
  onDeclareCost,
  onCreateNew,
  onDelete,
  deleteLocked = false,
  deleteBlockedReason,
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
      {/* SIL-453 (FB-098 restore): the accountant's lot-scope cost entry rides
          the review cluster — the same position the pre-SIL-481 page mounted
          it (first action, secondary voice). */}
      {onDeclareCost && (
        <UUIButton
          type="button"
          size="md"
          color="secondary"
          iconLeading={Receipt}
          onClick={onDeclareCost}
        >
          Khai chi phí
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
      {onDelete && (
        <UUIButton
          type="button"
          size="md"
          color="secondary-destructive"
          iconLeading={Trash2}
          onClick={onDelete}
          isDisabled={deleteLocked || Boolean(deleteBlockedReason)}
          aria-label={deleteLocked
            ? 'Xóa lô — lô đã khóa kế toán'
            : deleteBlockedReason
              ? `Xóa lô — ${deleteBlockedReason}`
              : 'Xóa lô'}
        >
          Xóa lô
        </UUIButton>
      )}
    </div>
  );
}
