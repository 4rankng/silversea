import { useMemo, useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { formatCurrency } from '../../lib/format';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { Alert } from '../../components/shared/Alert';
import { usePorts } from '../../hooks/useCatalogQueries';
import type { Port } from '@tingting/shared';

// kindSlug là cấu trúc (một loại phí theo cảng — card 20261005): backend ép
// z.literal('zone_lift_drop_surcharge') nên form luôn gửi đúng hằng này,
// không bao giờ cho người nhập tay.
const ZONE_SURCHARGE_KIND = 'zone_lift_drop_surcharge';

type PortZoneSurchargeRow = {
  id: number;
  updatedAt?: string;
  portId: number;
  kindSlug: string;
  label: string;
  /** numeric(15,0) — drizzle trả chuỗi, như `RoadAllowance.baseAmount`. */
  amount: string;
};

function PortZoneSurchargeForm({
  saving,
  item,
  onsave,
  oncancel,
  ports,
  portsError,
  portsLoading,
  onRetryPorts,
  onDelete,
  deleting,
}: {
  saving: boolean;
  item?: PortZoneSurchargeRow;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  ports: Port[];
  portsError?: boolean;
  portsLoading?: boolean;
  onRetryPorts?: () => void;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const [portId, setPortId] = useState(item?.portId || 0);
  const [label, setLabel] = useState(item?.label || '');
  const [amount, setAmount] = useState(item?.amount || '');
  return (
    <InlineForm colSpan={3}>
      {portsError && (
        <div style={{ flex: '1 1 100%', marginBottom: 8 }}>
          <Alert
            variant="error"
            style="soft"
            action={
              onRetryPorts ? (
                <button type="button" className="btn btn--sm" onClick={onRetryPorts}>
                  Thử lại
                </button>
              ) : undefined
            }
          >
            Không thể tải danh mục cảng.
          </Alert>
        </div>
      )}
      <div style={{ flex: 2, minWidth: 180 }}>
        <UuiSelectField
          label="Cảng"
          value={String(portId)}
          onChange={e => setPortId(Number(e.target.value))}
          disabled={portsLoading || portsError}
          options={[
            {
              value: '0',
              label: portsError
                ? 'Lỗi tải danh mục cảng — thử lại'
                : portsLoading
                ? 'Đang tải danh mục cảng…'
                : '-- Chọn --',
            },
            ...ports.map(p => ({ value: String(p.id), label: p.name })),
          ]}
        />
      </div>
      <div style={{ flex: 2, minWidth: 180 }}>
        <Field label="Nhãn hiển thị">
          <input
            className="input"
            type="text"
            value={label}
            maxLength={128}
            onChange={e => setLabel(e.target.value)}
            placeholder="Phí nâng/hạ Lạch Huyện"
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Giá mỗi lần nâng/hạ (đ)">
          <input className="input" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
        </Field>
      </div>
      <FormActions
        saving={saving}
        isedit={!!item}
        oncancel={oncancel}
        ondelete={onDelete}
        deleting={deleting}
        onsave={() => {
          if (!portId || !label.trim() || !amount) return;
          onsave({ portId, kindSlug: ZONE_SURCHARGE_KIND, label: label.trim(), amount: Number(amount) });
        }}
      />
    </InlineForm>
  );
}

export default function PortZoneSurchargesConfigPage() {
  const portsQuery = usePorts();
  const { data: ports = [], isError: portsError, isLoading: portsLoading, refetch: refetchPorts } = portsQuery;
  const portMap = useMemo(() => {
    const m = new Map<number, string>();
    ports.forEach(p => m.set(p.id, p.name));
    return m;
  }, [ports]);

  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
    <CrudTable<PortZoneSurchargeRow>
      title="Phí nâng/hạ theo cảng"
      description="Giá mỗi lần nâng hoặc hạ theo từng cảng — dùng cho phí Lạch Huyện"
      endpoint="/port-zone-surcharges" colSpan={3}
      pageSlug="port-zone-surcharges"
      iconName="pricing-rate"
      emptyTitle="Chưa có giá nâng/hạ"
      emptyHint="Thêm giá theo từng cảng để hệ thống tự tính phí nâng/hạ cho lô hàng."
      columns={[
        { header: 'Cảng', render: (row) => portMap.get(row.portId) || '—' },
        { header: 'Nhãn hiển thị', render: (row) => row.label },
        { header: 'Giá mỗi lần nâng/hạ', className: 'num', render: (row) => <span className="data-token" style={{ color: 'var(--fg-1)' }}>{formatCurrency(row.amount)}</span> },
      ]}
      renderForm={(p) => (
        <PortZoneSurchargeForm
          saving={p.saving}
          item={p.item}
          onsave={p.onSave}
          oncancel={p.onCancel}
          ports={ports}
          portsError={portsError}
          portsLoading={portsLoading}
          onRetryPorts={() => void refetchPorts()}
          onDelete={p.onDelete}
          deleting={p.deleting}
        />
      )}
    />
    </div>
  );
}
