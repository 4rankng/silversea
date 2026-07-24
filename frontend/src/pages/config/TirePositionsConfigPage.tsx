import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import type { TirePosition } from '@tingting/shared';

function TirePositionForm({ saving, item, onsave, oncancel }: {
  saving: boolean;
  item?: TirePosition;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
}) {
  const [name, setName] = useState(item?.name || '');

  return (
    <InlineForm colSpan={2}>
      <div style={{ flex: 2, minWidth: 180 }}>
        <Field label="Tên vị trí">
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="VD: Trục nâng trái" />
        </Field>
      </div>
      <FormActions
        saving={saving}
        isedit={!!item}
        oncancel={oncancel}
        onsave={() => {
          if (!name.trim()) return;
          onsave({
            name: name.trim(),
            status: 'ACTIVE',
          });
        }}
      />
    </InlineForm>
  );
}

export default function TirePositionsConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
      <CrudTable<TirePosition>
        title="Vị trí lốp"
        description="Quản lý danh sách vị trí lốp hiển thị trong form thêm/sửa lốp."
        endpoint="/tire-positions"
        iconName="tire-position"
        colSpan={2}
        pageSlug="tire-positions"
        emptyTitle="Chưa có vị trí lốp"
        emptyHint="Thêm vị trí lốp để người dùng chọn khi lắp hoặc cập nhật lốp."
        sortFn={(a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi')}
        columns={[
          {
            header: 'Tên vị trí',
            render: (position) => <span style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{position.name}</span>,
          },
        ]}
        renderForm={(p) => (
          <TirePositionForm
            saving={p.saving}
            item={p.item}
            onsave={p.onSave}
            oncancel={p.onCancel}
          />
        )}
      />
    </div>
  );
}
