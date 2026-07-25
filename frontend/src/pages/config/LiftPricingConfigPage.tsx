import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';

interface LiftPricing {
  id: number;
  portId: number;
  containerTypeId: number;
  direction: 'LIFT_UP' | 'LIFT_DOWN';
  unitPrice: string;
  effectiveDate: string;
}

const DIR_LABELS: Record<string, string> = { LIFT_UP: 'Nâng (lên)', LIFT_DOWN: 'Hạ (xuống)' };

function LiftPricingForm({ saving, item, onsave, oncancel }: {
  saving: boolean; item?: LiftPricing; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
  const [direction, setDirection] = useState<string>(item?.direction || 'LIFT_UP');
  const [unitPrice, setUnitPrice] = useState(item?.unitPrice || '');

  return (
    <InlineForm colSpan={4}>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Chiều">
          <select className="input" value={direction} onChange={e => setDirection(e.target.value)}>
            <option value="LIFT_UP">Nâng (lên)</option>
            <option value="LIFT_DOWN">Hạ (xuống)</option>
          </select>
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Đơn giá (₫)"><input className="input" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="1200000" /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} onsave={() => {
        if (!unitPrice.trim()) return;
        onsave({ direction, unitPrice });
      }} />
    </InlineForm>
  );
}

export default function LiftPricingConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
      <CrudTable<LiftPricing>
        title="Bảng giá nâng/hạ container" description="Đơn giá nâng (LIFT_UP) và hạ (LIFT_DOWN) theo cảng × loại container"
        endpoint="/lift-pricing" colSpan={4}
        pageSlug="lift-pricing"
        emptyTitle="Chưa có bảng giá nâng/hạ"
        emptyHint="Thêm mức giá đầu tiên cho cảng."
        columns={[
          { header: 'Chiều', render: (r) => <span style={{ fontWeight: 600 }}>{DIR_LABELS[r.direction] ?? r.direction}</span> },
          { header: 'Đơn giá (₫)', render: (r) => Number(r.unitPrice).toLocaleString('vi-VN') },
          { header: 'Cảng ID', render: (r) => r.portId },
          { header: 'Ngày hiệu lực', render: (r) => r.effectiveDate },
        ]}
        renderForm={(p) => <LiftPricingForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} />}
      />
    </div>
  );
}
