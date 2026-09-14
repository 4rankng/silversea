import { Pencil, Trash2 } from 'lucide-react';

/**
 * Card action buttons for one penalty reason: native buttons named per
 * record (the keyboard-a11y contract), with the shared .pr-act chip styling
 * owned by the page that lays the cards out.
 */
export function PenaltyReasonActions({ name, onEdit, onDelete }: { name: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="pr-card-actions">
      <button type="button" className="pr-act" aria-label={`Chỉnh sửa ${name}`} title="Chỉnh sửa" onClick={onEdit}>
        <Pencil size={15} aria-hidden="true" />
      </button>
      <button type="button" className="pr-act del" aria-label={`Xóa ${name}`} title="Xóa" onClick={onDelete}>
        <Trash2 size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
