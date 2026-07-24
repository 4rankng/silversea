import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import type { CargoType } from '@tingting/shared';

function CargoTypeForm({ saving, item, onsave, oncancel }: {
  saving: boolean; item?: CargoType; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
  const [name, setName] = useState(item?.name || '');
  return (
    <InlineForm colSpan={3}>
      <div style={{ flex: 2, minWidth: 200 }}>
        <Field label="Tên loại hàng"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="VD: Cát, đá…" /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} onsave={() => { if (!name.trim()) return; onsave({ name: name.trim() }); }} />
    </InlineForm>
  );
}

export default function CargoTypesConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
    <CrudTable<CargoType>
      title="Loại hàng hóa" description="Bảng quy chuẩn loại hàng hóa vận chuyển — ảnh hưởng đến việc phân xe theo chặng"
      endpoint="/cargo-types" colSpan={3}
      pageSlug="cargo-types"
      iconName="cargo"
      emptyTitle="Chưa có loại hàng hóa"
      emptyHint="Thêm loại hàng hóa đầu tiên để bắt đầu phân loại chuyến."
      columns={[
        { header: 'Tên loại hàng', render: (ct) => <span style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{ct.name}</span> },
      ]}
      renderForm={(p) => <CargoTypeForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} />}
    />
    </div>
  );
}
