import { Save, X, Loader2, Trash2 } from 'lucide-react';

/**
 * Action bar for config form rows — the modal-footer treatment: the
 * destructive action (edit mode only) anchors far left under a divider,
 * Cancel / Save anchor far right. Renders the same in polished modals
 * (CrudTable) and inline table-row forms (TruckOwners).
 */
export function FormActions({ saving, isedit, onsave, oncancel, ondelete, deleting }: {
  saving: boolean; isedit: boolean; onsave: () => void; oncancel: () => void;
  /** Edit mode only — confirms then deletes via the page's CRUD handler. */
  ondelete?: () => void | Promise<void>;
  deleting?: boolean;
}) {
  return (
    <div style={{
      borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 14,
      display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%',
    }}>
      {ondelete && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{ color: 'var(--danger)', borderColor: 'var(--danger-soft)' }}
          disabled={deleting || saving}
          onClick={ondelete}
        >
          {deleting ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
          Xóa cấu hình này
        </button>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 'auto' }}>
        <button type="button" className="btn btn--secondary btn--sm" disabled={saving || deleting} onClick={oncancel}>
          <X size={12} /> Hủy
        </button>
        <button type="button" className="btn btn--primary btn--sm" disabled={saving || deleting} onClick={onsave}>
          {saving ? <Loader2 size={12} className="spin" /> : <Save size={12} />}
          {isedit ? 'Cập nhật' : 'Thêm'}
        </button>
      </div>
    </div>
  );
}
