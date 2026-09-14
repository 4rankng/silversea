import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { StatusPill, ModalChip, ModalChipLive } from '../../components/UI';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { TRAILER_STATUS_LABELS, TRAILER_TYPE_LABELS } from '@tingting/shared';
import type { Trailer } from '@tingting/shared';

function TrailerForm({ saving, item, onsave, oncancel, onDelete, deleting }: {
  saving: boolean; item?: Trailer; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
  onDelete?: () => Promise<void>; deleting?: boolean;
}) {
  const [plate, setPlate] = useState(item?.licensePlate || '');
  const [type, setType] = useState(item?.type || '40FT');
  const [status, setStatus] = useState(item?.status || 'ACTIVE');
  return (
    <InlineForm colSpan={5}>
      <div style={{ flex: 2, minWidth: 160 }}>
        <Field label="Biển số rơ-moóc"><input className="input" value={plate} onChange={e => setPlate(e.target.value)} placeholder="Ví dụ: 60C-123.456" /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <UuiSelectField
          label="Loại"
          value={type}
          onChange={e => setType(e.target.value)}
          options={Object.entries(TRAILER_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
        />
      </div>
      <div style={{ flex: 1, minWidth: 140 }}>
        <UuiSelectField
          label="Trạng thái"
          value={status}
          onChange={e => setStatus(e.target.value)}
          options={Object.entries(TRAILER_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
        />
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} onsave={() => { if (!plate.trim()) return; onsave({ licensePlate: plate.trim(), type, status }); }} ondelete={onDelete} deleting={deleting} />
    </InlineForm>
  );
}

export default function TrailersConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
    <CrudTable<Trailer>
      title="Rơ-moóc" description="Danh sách rơ-moóc — phân loại theo kích thước và trạng thái đăng kiểm"
      endpoint="/trailers" colSpan={5}
      pageSlug="trailers"
      iconName="semi-trailer"
      emptyIllustration="empty-fleet.svg"
      emptyTitle="Chưa có rơ-moóc"
      emptyHint="Thêm rơ-moóc đầu tiên để bắt đầu phân chuyến."
      columns={[
        { header: 'Biển số', render: (t) => <span style={{ fontWeight: 600, color: 'var(--fg-1)', fontFamily: 'var(--font-data)' }}>{t.licensePlate}</span> },
        { header: 'Loại', render: (t) => <span style={{ color: 'var(--fg-2)' }}>{t.type ? (TRAILER_TYPE_LABELS[t.type] || t.type) : 'Chưa rõ loại'}</span> },
        { header: 'Trạng thái', render: (t) => <StatusPill variant={t.status === 'ACTIVE' ? 'success' : t.status === 'MAINTENANCE' ? 'warn' : 'neutral'}>{TRAILER_STATUS_LABELS[t.status] || t.status}</StatusPill> },
      ]}
      renderForm={(p) => <TrailerForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} onDelete={p.onDelete} deleting={p.deleting} />}
      modalChip={(t) => t.status === 'ACTIVE'
        ? <ModalChipLive>Hoạt động</ModalChipLive>
        : <ModalChip>{TRAILER_STATUS_LABELS[t.status] || t.status}</ModalChip>}
    />
    </div>
  );
}
