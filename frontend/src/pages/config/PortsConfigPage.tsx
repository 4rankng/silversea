import { useCallback, useEffect, useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { Role, type Port } from '@tingting/shared';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { configClient } from '../../api/configClient';
import { useAuth } from '../../hooks/useAuth';

export type DispatchZoneOption = { code: string; label: string; sortOrder: number };

interface DispatchZoneRow extends DispatchZoneOption {
  id: number;
  isActive: boolean;
}

type ZoneChoice = string;

function PortForm({ saving, item, zoneOptions, onsave, oncancel, onDelete, deleting }: {
  saving: boolean; item?: Port; zoneOptions: Array<{ value: ZoneChoice; label: string }>; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
  onDelete?: () => Promise<void>; deleting?: boolean;
}) {
  const [name, setName] = useState(item?.name || '');
  const [shortName, setShortName] = useState(item?.shortName || '');
  const [code, setCode] = useState(item?.code || '');
  const [address, setAddress] = useState(item?.address || '');
  const [zone, setZone] = useState<ZoneChoice>(item?.dispatchZone ?? 'NONE');

  return (
    <InlineForm colSpan={4}>
      <div style={{ flex: 2, minWidth: 180 }}>
        <Field label="Tên cảng/bãi">
          <input
            className="input"
            required pattern={'.*\\S.*'} value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ví dụ: Cảng Lạch Huyện"
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
            placeholder="Ví dụ: VNLCH"
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
      <div style={{ flex: 1, minWidth: 180, display: 'flex', alignItems: 'flex-end', paddingBottom: '4px' }}>
        <UuiSelectField
          label="Khu vực điều phối"
          value={zone}
          options={zoneOptions}
          onChange={(e) => setZone(e.target.value as ZoneChoice)}
        />
      </div>
      <div style={{ flex: 1, minWidth: 140 }}>
        <Field label="Tên viết tắt">
          <input
            className="input"
            value={shortName}
            onChange={e => setShortName(e.target.value)}
            placeholder="Ví dụ: SITC"
          />
        </Field>
      </div>
      <FormActions
        saving={saving}
        isedit={!!item}
        oncancel={oncancel}
        ondelete={onDelete}
        deleting={deleting}
        onsave={() => {
          if (!name.trim()) return;
          onsave({
            name: name.trim(),
            shortName: shortName.trim() || null,
            code: code.trim() || null,
            address: address.trim() || null,
            dispatchZone: zone === 'NONE' ? null : zone,
          });
        }}
      />
    </InlineForm>
  );
}

function ZoneForm({ saving, item, onsave, oncancel, onDelete, deleting }: {
  saving: boolean; item?: DispatchZoneRow; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
  onDelete?: () => void | Promise<void>; deleting?: boolean;
}) {
  const [code, setCode] = useState(item?.code ?? '');
  const [label, setLabel] = useState(item?.label ?? '');
  const [sortOrder, setSortOrder] = useState(item?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(item?.isActive ?? true);

  return (
    <InlineForm colSpan={4}>
      <div style={{ flex: 1, minWidth: 140 }}>
        <Field label="Mã khu vực">
          <input
            className="input"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="Ví dụ: LACH_HUYEN"
            disabled={!!item}
            autoFocus={!item}
          />
        </Field>
      </div>
      <div style={{ flex: 2, minWidth: 200 }}>
        <Field label="Tên khu vực">
          <input
            className="input"
            required pattern={'.*\\S.*'} value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Lạch Huyện"
            autoFocus={!!item}
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 100 }}>
        <Field label="Thứ tự">
          <input
            className="input"
            type="number"
            min={0}
            max={9999}
            value={sortOrder}
            onChange={e => setSortOrder(Number(e.target.value))}
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 140, display: 'flex', alignItems: 'flex-end', paddingBottom: '4px' }}>
        <UuiSelectField
          label="Trạng thái"
          value={isActive ? 'ACTIVE' : 'INACTIVE'}
          options={[
            { value: 'ACTIVE', label: 'Đang dùng' },
            { value: 'INACTIVE', label: 'Đã ngưng' },
          ]}
          onChange={(e) => setIsActive(e.target.value === 'ACTIVE')}
        />
      </div>
      <FormActions
        saving={saving}
        isedit={!!item}
        oncancel={oncancel}
        ondelete={onDelete}
        deleting={deleting}
        onsave={() => {
          if (!label.trim()) return;
          onsave(item
            ? { label: label.trim(), sortOrder, isActive }
            : { code: code.trim(), label: label.trim(), sortOrder, isActive });
        }}
      />
    </InlineForm>
  );
}

export default function PortsConfigPage() {
  const { user } = useAuth();
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const [zones, setZones] = useState<DispatchZoneOption[]>([]);
  const zoneByCode = new Map(zones.map((z) => [z.code, z]));
  const zoneOptions = [
    { value: 'NONE', label: '— Không thuộc khu vực điều phối —' },
    ...zones.map((z) => ({ value: z.code as ZoneChoice, label: z.label })),
  ];

  const loadZones = () => {
    configClient.getDispatchZones()
      .then((res) => setZones(res.items))
      .catch(() => {});
  };
  useEffect(loadZones, []);
  const refreshZones = useCallback(() => { loadZones(); }, []);

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
        { header: 'Mã cảng', render: (p) => <span style={{ color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>{p.code || '—'}</span> },
        {
          header: 'Địa chỉ',
          render: (p) => <span style={{ color: 'var(--fg-2)', fontSize: 'var(--text-data-size)' }}>{p.address || '—'}</span>,
        },
        {
          header: 'Khu vực điều phối',
          render: (p) => (
            p.dispatchZone
              ? <span className="badge badge--success">{zoneByCode.get(p.dispatchZone)?.label ?? p.dispatchZone}</span>
              : <span style={{ color: 'var(--fg-3)' }}>—</span>
          ),
        },
      ]}
      renderForm={(p) => <PortForm saving={p.saving} item={p.item} zoneOptions={zoneOptions} onsave={p.onSave} oncancel={p.onCancel} onDelete={p.onDelete} deleting={p.deleting} />}
    />

    {user?.role === Role.ADMIN && (
    <CrudTable<DispatchZoneRow>
      title="Khu vực điều phối"
      description="Taxonomy cụm cảng — thêm cụm mới (VD: Ninh Bình) tại đây, cảng được gán vào khu vực ở bảng trên"
      endpoint="/dispatch-zones" colSpan={4}
      pageSlug="dispatch-zones"
      showDelete={false}
      sortFn={(a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'vi')}
      emptyTitle="Chưa có khu vực nào"
      emptyHint="Thêm khu vực điều phối đầu tiên (VD: Lạch Huyện)."
      columns={[
        { header: 'Mã', render: (z) => <span style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{z.code}</span> },
        { header: 'Tên khu vực', render: (z) => <span>{z.label}</span> },
        { header: 'Thứ tự', render: (z) => <span style={{ color: 'var(--fg-2)' }}>{z.sortOrder}</span> },
        {
          header: 'Trạng thái',
          render: (z) => z.isActive
            ? <span className="cfg-pill cfg-pill--success">Đang dùng</span>
            : <span className="cfg-pill cfg-pill--neutral">Đã ngưng</span>,
        },
      ]}
      renderForm={(p) => (
        <ZoneForm
          saving={p.saving}
          item={p.item}
          onsave={(d) => { p.onSave(d); refreshZones(); }}
          oncancel={p.onCancel}
          onDelete={p.onDelete}
          deleting={p.deleting}
        />
      )}
    />
    )}
    </div>
  );
}
