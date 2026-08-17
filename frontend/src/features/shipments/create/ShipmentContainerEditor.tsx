import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';

interface ShipmentContainerEditorProps {
  rows: ReactNode;
  saving: boolean;
  quantity: string;
  onQuantityChange: (value: string) => void;
  onAdd: () => void;
}

/** Feature-local FCL editor shell for repeatable container records. */
export function ShipmentContainerEditor({ rows, saving, quantity, onQuantityChange, onAdd }: ShipmentContainerEditorProps) {
  return (
    <div className="csc-container-editor">
      <label className="csc-container-editor__quantity">
        <span>Số lượng cont</span>
        <input type="number" min="1" step="1" value={quantity} onChange={(event) => onQuantityChange(event.target.value)} disabled={saving} />
      </label>
      {rows}
      <button type="button" className="csc-add-container" onClick={onAdd} disabled={saving}>
        <Plus size={16} aria-hidden="true" />
        <span>Thêm container</span>
      </button>
    </div>
  );
}
