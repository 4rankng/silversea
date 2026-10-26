import { ShipmentCreateActions } from './ShipmentCreateActions';
import { ShipmentViewActions } from './ShipmentViewActions';
import type { SaveIntent } from './shipment-create-model';

interface ShipmentCreateToplineProps {
  saving: SaveIntent | null;
  requiredDone: number;
  requiredTotal: number;
  onCancel: () => void;
  onSaveDraft: () => void;
  onCreate: () => void;
  /** SIL-171 edit mode: title + action cluster swap to the edit pair. */
  mode?: 'create' | 'edit' | 'view';
  /** SIL-481 view mode only — the read-only review cluster (Quay lại /
   *  Sửa / Tạo mới lô hàng — SIL-500) replaces the create/edit cluster, and
   *  the required progress chip is meaningless on a form nobody is filling,
   *  so it hides. */
  onBack?: () => void;
  onEdit?: () => void;
  editLocked?: boolean;
  /** SIL-500: KH's next-lot loop — "Tạo mới lô hàng" → /shipments/new. */
  onCreateNew?: () => void;
}

/* Owner mock 11/10 ("Tạo lô hàng – dense layout.html"): the page title, the
 * required-field progress and the three actions ride ONE topline at the head
 * of the worksheet. The fixed bottom action bar the same mock superseded is
 * retired, so phones scroll back here to act.
 *
 * The three actions are the shared cluster (ShipmentCreateActions) that FB-108
 * mounts a second time at the foot of the worksheet; this topline keeps its own
 * `.csc-topline__actions` layout class so the head stays a single flex row, and
 * the topline variant keeps the plain accessible name. */
export function ShipmentCreateTopline({
  saving,
  requiredDone,
  requiredTotal,
  onCancel,
  onSaveDraft,
  onCreate,
  mode = 'create',
  onBack,
  onEdit,
  editLocked = false,
  onCreateNew,
}: ShipmentCreateToplineProps) {
  const edit = mode === 'edit';
  const view = mode === 'view';
  return (
    <div className="csc-topline">
      <h1 className="csc-topline__title">{view ? 'Chi tiết lô hàng' : edit ? 'Sửa lô hàng' : 'Tạo lô hàng'}</h1>
      {!view && (
        <span className="csc-topline__progress">
          Bắt buộc: <strong>{requiredDone}/{requiredTotal}</strong>
        </span>
      )}
      {view ? (
        <ShipmentViewActions
          className="csc-topline__actions"
          variant="topline"
          onBack={onBack ?? onCancel}
          onEdit={onEdit}
          editLocked={editLocked}
          onCreateNew={onCreateNew}
        />
      ) : (
        <ShipmentCreateActions
          className="csc-topline__actions"
          variant="topline"
          mode={mode}
          saving={saving}
          onCancel={onCancel}
          onSaveDraft={onSaveDraft}
          onCreate={onCreate}
        />
      )}
    </div>
  );
}
