import { Pencil, Trash2, Loader2 } from 'lucide-react';
import { Tooltip } from '../shared/Tooltip';

export function ActionBtns({ id, deleting, onedit, ondelete }: {
  id: number; deleting: number | null; onedit: () => void; ondelete: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <Tooltip label="Sửa">
        <button className="btn btn--ghost btn--sm btn--icon" aria-label="Sửa" onClick={onedit}><Pencil size={13} /></button>
      </Tooltip>
      <Tooltip label="Xóa">
        <button className="btn btn--ghost btn--sm btn--icon" aria-label="Xóa" disabled={deleting === id} onClick={ondelete}>
          {deleting === id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} style={{ color: 'var(--danger)' }} />}
        </button>
      </Tooltip>
    </div>
  );
}
