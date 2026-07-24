import { Save, X, Loader2 } from 'lucide-react';

export function FormActions({ saving, onsave, oncancel, isedit }: {
  saving: boolean; onsave: () => void; oncancel: () => void; isedit: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, paddingBottom: 4 }}>
      <button className="btn btn--primary btn--sm" disabled={saving} onClick={onsave}>
        {saving ? <Loader2 size={12} className="spin" /> : <Save size={12} />}
        {isedit ? 'Cập nhật' : 'Thêm'}
      </button>
      <button className="btn btn--ghost btn--sm" onClick={oncancel}>
        <X size={12} /> Hủy
      </button>
    </div>
  );
}
