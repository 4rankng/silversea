import { ShipmentCreateActions } from './ShipmentCreateActions';
import type { SaveIntent } from './shipment-create-model';

interface ShipmentCreateToplineProps {
  saving: SaveIntent | null;
  requiredDone: number;
  requiredTotal: number;
  onCancel: () => void;
  onSaveDraft: () => void;
  onCreate: () => void;
  /** SIL-171 edit mode: title + action cluster swap to the edit pair. */
  mode?: 'create' | 'edit';
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
}: ShipmentCreateToplineProps) {
  const edit = mode === 'edit';
  return (
    <div className="csc-topline">
      <h1 className="csc-topline__title">{edit ? 'Sửa lô hàng' : 'Tạo lô hàng'}</h1>
      <span className="csc-topline__progress">
        Bắt buộc: <strong>{requiredDone}/{requiredTotal}</strong>
      </span>
      <ShipmentCreateActions
        className="csc-topline__actions"
        variant="topline"
        mode={mode}
        saving={saving}
        onCancel={onCancel}
        onSaveDraft={onSaveDraft}
        onCreate={onCreate}
      />
    </div>
  );
}
