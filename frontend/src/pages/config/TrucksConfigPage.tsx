import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { StatusPill, ModalChip, ModalChipLive } from '../../components/UI';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import type { Truck } from '@tingting/shared';

const TRUCK_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Hoạt động', MAINTENANCE: 'Bảo trì', INACTIVE: 'Ngưng',
};

function TruckForm({ saving, item, onsave, oncancel, onDelete, deleting }: {
  saving: boolean; item?: Truck; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
  onDelete?: () => Promise<void>; deleting?: boolean;
}) {
  const [plate, setPlate] = useState(item?.licensePlate || '');
  const [status, setStatus] = useState(item?.status || 'ACTIVE');
  return (
    <InlineForm colSpan={4}>
      <div style={{ flex: 2, minWidth: 160 }}>
        <Field label="Biển số"><input className="input" value={plate} onChange={e => setPlate(e.target.value)} placeholder="Ví dụ: 51C-12345" /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 140 }}>
        <UuiSelectField
          label="Trạng thái"
          value={status}
          onChange={e => setStatus(e.target.value)}
          options={Object.entries(TRUCK_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
        />
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} onsave={() => { if (!plate.trim()) return; onsave({ licensePlate: plate.trim(), status }); }} ondelete={onDelete} deleting={deleting} />
    </InlineForm>
  );
}

export default function TrucksConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
    <CrudTable<Truck>
      title="Xe đầu kéo" description="Biển số các đầu kéo container đang vận hành — định mức mặc định và trạng thái bảo dưỡng"
      endpoint="/trucks" colSpan={4}
      pageSlug="trucks"
      iconName="tractor-head"
      emptyIllustration="empty-trucks.svg"
      emptyTitle="Chưa có xe đầu kéo"
      emptyHint="Thêm xe đầu kéo để bắt đầu phân chuyến và theo dõi bảo dưỡng."
      columns={[
        { header: 'Biển số', render: (t) => <span style={{ fontWeight: 600, color: 'var(--fg-1)', fontFamily: 'var(--font-data)' }}>{t.licensePlate}</span> },
        { header: 'Trạng thái', render: (t) => <StatusPill variant={t.status === 'ACTIVE' ? 'success' : t.status === 'MAINTENANCE' ? 'warn' : 'neutral'}>{TRUCK_STATUS_LABELS[t.status] || t.status}</StatusPill> },
      ]}
      renderForm={(p) => <TruckForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} onDelete={p.onDelete} deleting={p.deleting} />}
      modalChip={(t) => t.status === 'ACTIVE'
        ? <ModalChipLive>Hoạt động</ModalChipLive>
        : <ModalChip>{TRUCK_STATUS_LABELS[t.status] || t.status}</ModalChip>}
    />
    </div>
  );
}
