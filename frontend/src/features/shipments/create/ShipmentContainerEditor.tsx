import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';

interface ShipmentContainerEditorProps {
  rows: ReactNode;
  saving: boolean;
  onAdd: () => void;
}

/** Feature-local FCL editor shell for repeatable container records. */
export function ShipmentContainerEditor({ rows, saving, onAdd }: ShipmentContainerEditorProps) {
  return (
    <div className="csc-container-editor">
      {rows}
      <button type="button" className="csc-add-container" onClick={onAdd} disabled={saving}>
        <Plus size={18} style={{ verticalAlign: 'middle', marginRight: 7 }} />Thêm container
      </button>
    </div>
  );
}
