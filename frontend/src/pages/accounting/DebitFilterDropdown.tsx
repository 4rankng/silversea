/** Excel/Sheets-style checkbox filter dropdown (card: chỉ 2 cột được lọc). */
export function DebitFilterDropdown({ label, values, selected, onChange }: {
  label: string;
  values: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <details style={{ position: 'relative', display: 'inline-block', width: 260, maxWidth: '100%' }}>
      <summary className="btn btn--secondary" style={{ cursor: 'pointer', fontSize: 'var(--text-caption-size)', listStyle: 'none', width: '100%' }}>
        {label}
        {selected.size > 0 ? ` (${selected.size})` : ''} ▾
      </summary>
      <div style={{
        position: 'absolute', insetInline: 0, zIndex: 30, background: 'var(--surface, #fff)',
        border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, padding: '8px 10px',
        maxHeight: 260, overflowY: 'auto',
      }}>
        {values.length === 0 && <span style={{ fontSize: 'var(--text-caption-size)' }}>Không có dữ liệu</span>}
        {values.map((value) => (
          <label key={value} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0', fontSize: 'var(--text-caption-size)' }}>
            <input
              type="checkbox"
              checked={selected.has(value)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(value); else next.delete(value);
                onChange(next);
              }}
            />
            {value}
          </label>
        ))}
        {selected.size > 0 && (
          <button type="button" className="btn btn--secondary btn--sm" style={{ marginTop: 6 }} onClick={() => onChange(new Set())}>
            Xóa lọc
          </button>
        )}
      </div>
    </details>
  );
}

