import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import type { Port } from '@tingting/shared';
import { DISPATCH_ZONES } from '@tingting/shared';

function PortForm({ saving, item, onsave, oncancel }: {
  saving: boolean; item?: Port; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
  const [name, setName] = useState(item?.name || '');
  const [code, setCode] = useState(item?.code || '');
  const [city, setCity] = useState(item?.city || '');
  const [address, setAddress] = useState(item?.address || '');
  const [isLachHuyen, setIsLachHuyen] = useState(item?.dispatchZone === 'LACH_HUYEN');

  return (
    <InlineForm colSpan={4}>
      <div style={{ flex: 2, minWidth: 180 }}>
        <Field label="Tên cảng/bãi">
          <input
            className="input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="VD: Cảng Lạch Huyện"
            autoFocus
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Mã cảng">
          <input
            className="input"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="VNLCH"
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 140 }}>
        <Field label="Thành phố">
          <input
            className="input"
            value={city}
            onChange={e => setCity(e.target.value)}
            placeholder="Hải Phòng"
          />
        </Field>
      </div>
      <div style={{ flex: 2, minWidth: 200 }}>
        <Field label="Địa chỉ">
          <input
            className="input"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Khu kinh tế Lạch Huyện"
          />
        </Field>
      </div>
      <div style={{ flex: 0, minWidth: 'auto', display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
          <input
            type="checkbox"
            checked={isLachHuyen}
            onChange={e => setIsLachHuyen(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span>Cảng khu vực Lạch Huyện</span>
        </label>
      </div>
      <FormActions
        saving={saving}
        isedit={!!item}
        oncancel={oncancel}
        onsave={() => {
          if (!name.trim()) return;
          onsave({
            name: name.trim(),
            code: code.trim() || null,
            city: city.trim() || null,
            address: address.trim() || null,
            dispatchZone: isLachHuyen ? DISPATCH_ZONES[0] : null,
          });
        }}
      />
    </InlineForm>
  );
}

export default function PortsConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
    <CrudTable<Port>
      title="Cảng / Bãi"
      description="Danh mục cảng / bãi — khu vực điều phối Lạch Huyện ảnh hưởng đến gợi ý điều xe"
      endpoint="/ports" colSpan={4}
      pageSlug="ports"
      iconName="location"
      emptyTitle="Chưa có cảng / bãi nào"
      emptyHint="Thêm cảng hoặc bãi đầu tiên để bắt đầu cấu hình."
      columns={[
        {
          header: 'Tên cảng/bãi',
          render: (p) => <span style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{p.name}</span>,
        },
        { header: 'Mã cảng', render: (p) => <span style={{ color: 'var(--fg-2)' }}>{p.code || '—'}</span> },
        {
          header: 'Khu vực điều phối',
          render: (p) => (
            p.dispatchZone === 'LACH_HUYEN'
              ? <span className="badge badge--success">Lạch Huyện</span>
              : <span style={{ color: 'var(--fg-3)' }}>—</span>
          ),
        },
        {
          header: 'Thành phố/Địa chỉ',
          render: (p) => <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>{p.city ? `${p.city}${p.address ? ', ' : ''}${p.address || ''}` : (p.address || '—')}</span>,
        },
      ]}
      renderForm={(p) => <PortForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} />}
    />
    </div>
  );
}
