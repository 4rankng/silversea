import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { useContainerTypes, usePorts } from '../../hooks/useCatalogQueries';

interface LiftPricing {
  id: number;
  portId: number;
  containerTypeId: number;
  direction: 'LIFT_UP' | 'LIFT_DOWN';
  loadState: 'LOADED' | 'EMPTY';
  unitPrice: string;
  effectiveDate: string;
}

const DIR_LABELS: Record<string, string> = { LIFT_UP: 'Nâng', LIFT_DOWN: 'Hạ' };

function LiftPricingForm({ saving, item, onsave, oncancel, ports, containerTypes }: {
  saving: boolean; item?: LiftPricing; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
  ports: Array<{ id: number; name: string }>;
  containerTypes: Array<{ id: number; code: string; name: string }>;
}) {
  const [portId, setPortId] = useState(String(item?.portId ?? ''));
  const [containerTypeId, setContainerTypeId] = useState(String(item?.containerTypeId ?? ''));
  const [direction, setDirection] = useState<string>(item?.direction || 'LIFT_UP');
  const [loadState, setLoadState] = useState<string>(item?.loadState || 'LOADED');
  const [unitPrice, setUnitPrice] = useState(item?.unitPrice || '');

  return (
    <InlineForm colSpan={6}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <Field label="Cảng / bãi">
          <select className="input" value={portId} onChange={e => setPortId(e.target.value)}>
            <option value="">— Chọn cảng —</option>
            {ports.map(port => <option key={port.id} value={port.id}>{port.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 170 }}>
        <Field label="Loại container">
          <select className="input" value={containerTypeId} onChange={e => setContainerTypeId(e.target.value)}>
            <option value="">— Chọn loại —</option>
            {containerTypes.map(type => <option key={type.id} value={type.id}>{type.code} — {type.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Chiều">
          <select className="input" value={direction} onChange={e => setDirection(e.target.value)}>
            <option value="LIFT_UP">Nâng</option>
            <option value="LIFT_DOWN">Hạ</option>
          </select>
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Trạng thái hàng">
          <select className="input" value={loadState} onChange={e => setLoadState(e.target.value)}>
            <option value="LOADED">Hàng</option>
            <option value="EMPTY">Rỗng</option>
          </select>
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Đơn giá (₫)"><input className="input" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="1200000" /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} onsave={() => {
        if (!portId || !containerTypeId || !unitPrice.trim()) return;
        onsave({ portId: Number(portId), containerTypeId: Number(containerTypeId), direction, loadState, unitPrice });
      }} />
    </InlineForm>
  );
}

export default function LiftPricingConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const { data: ports = [] } = usePorts();
  const { data: containerTypes = [] } = useContainerTypes();
  const portNames = new Map(ports.map((port) => [port.id, port.name]));
  const containerTypeNames = new Map(containerTypes.map((type) => [type.id, type.code]));
  return (
    <div ref={pageRef}>
      <CrudTable<LiftPricing>
        title="Bảng giá nâng/hạ container" description="Đơn giá theo cảng/bãi, loại container, chiều nâng/hạ và trạng thái hàng/rỗng"
        endpoint="/lift-pricing" colSpan={6}
        pageSlug="lift-pricing"
        emptyTitle="Chưa có bảng giá nâng/hạ"
        emptyHint="Thêm mức giá đầu tiên cho cảng."
        columns={[
          { header: 'Chiều', render: (r) => <span style={{ fontWeight: 600 }}>{DIR_LABELS[r.direction] ?? r.direction}</span> },
          { header: 'Đơn giá (₫)', render: (r) => Number(r.unitPrice).toLocaleString('vi-VN') },
          { header: 'Cảng', render: (r) => portNames.get(r.portId) ?? 'Cảng không còn trong danh mục' },
          { header: 'Loại container', render: (r) => containerTypeNames.get(r.containerTypeId) ?? 'Không còn trong danh mục' },
          { header: 'Hàng/Rỗng', render: (r) => r.loadState === 'EMPTY' ? 'Rỗng' : 'Hàng' },
          { header: 'Ngày hiệu lực', render: (r) => r.effectiveDate },
        ]}
        renderForm={(p) => <LiftPricingForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} ports={ports} containerTypes={containerTypes} />}
      />
    </div>
  );
}
