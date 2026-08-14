import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';

interface ShipmentContainerEditorProps {
  allocationSummary: ReactNode;
  allocationControl: ReactNode;
  rows: ReactNode;
  saving: boolean;
  onAdd: () => void;
}

/** Feature-local FCL editor shell: allocation, repeatable records, and add control. */
export function ShipmentContainerEditor({ allocationSummary, allocationControl, rows, saving, onAdd }: ShipmentContainerEditorProps) {
  return (
    <div className="csc-container-editor">
      <div className="csc-container-editor__allocation">
        {allocationSummary}
        {allocationControl}
      </div>
      {rows}
      <button type="button" className="csc-add-container" onClick={onAdd} disabled={saving}>
        <Plus size={18} style={{ verticalAlign: 'middle', marginRight: 7 }} />Thêm container
      </button>
    </div>
  );
}
