import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';

interface WeightPricingTier {
  id: number;
  routeId: number;
  cargoTypeId: number;
  minKg: string;
  maxKg: string;
  pricePerKg: string;
  effectiveDate: string;
}

function TierForm({ saving, item, onsave, oncancel, onDelete, deleting }: {
  saving: boolean; item?: WeightPricingTier; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
  onDelete?: () => Promise<void>; deleting?: boolean;
}) {
  const [minKg, setMinKg] = useState(item?.minKg || '0');
  const [maxKg, setMaxKg] = useState(item?.maxKg || '');
  const [pricePerKg, setPricePerKg] = useState(item?.pricePerKg || '');

  return (
    <InlineForm colSpan={4}>
      <div style={{ flex: 1, minWidth: 100 }}>
        <Field label="Từ (kg)"><input className="input" value={minKg} onChange={e => setMinKg(e.target.value)} placeholder="0" /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 100 }}>
        <Field label="Đến (kg)"><input className="input" value={maxKg} onChange={e => setMaxKg(e.target.value)} placeholder="20000" /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Giá/kg (₫)"><input className="input" value={pricePerKg} onChange={e => setPricePerKg(e.target.value)} placeholder="4500" /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} ondelete={onDelete} deleting={deleting} onsave={() => {
        if (!maxKg.trim() || !pricePerKg.trim()) return;
        onsave({ minKg, maxKg, pricePerKg });
      }} />
    </InlineForm>
  );
}

export default function WeightPricingTiersConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
      <CrudTable<WeightPricingTier>
        title="Bảng giá theo trọng lượng" description="Giá cước theo trọng lượng cho hàng rời (kg × giá/kg)"
        endpoint="/weight-pricing-tiers" colSpan={4}
        pageSlug="weight-pricing-tiers"
        emptyTitle="Chưa có bảng giá theo trọng lượng"
        emptyHint="Thêm khoảng trọng lượng đầu tiên để tính giá tự động."
        columns={[
          { header: 'Từ (kg)', render: (t) => <span style={{ fontWeight: 600 }}>{t.minKg}</span> },
          { header: 'Đến (kg)', render: (t) => t.maxKg },
          { header: 'Giá/kg (₫)', render: (t) => Number(t.pricePerKg).toLocaleString('vi-VN') },
          { header: 'Ngày hiệu lực', render: (t) => t.effectiveDate },
        ]}
        renderForm={(p) => <TierForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} onDelete={p.onDelete} deleting={p.deleting} />}
      />
    </div>
  );
}
