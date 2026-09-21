import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { CONFIG } from '@tingting/shared';
import type { FuelPricePeriodRow } from '../../api/pricingClient';
import { DateInput } from '../../design-system/forms/DateInput';
import { formatDate } from '../../lib/format';

const fmtPrice = (v: string) => Number(v).toLocaleString('vi-VN');

function FuelPricePeriodForm({ saving, item, onsave, oncancel, onDelete, deleting }: {
  saving: boolean;
  item?: FuelPricePeriodRow;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(item?.effectiveFrom ?? '');
  const [unitPrice, setUnitPrice] = useState(item?.unitPrice ?? '');
  const [sourceNote, setSourceNote] = useState(item?.sourceNote ?? '');

  const canSave = Boolean(effectiveFrom)
    && Boolean(unitPrice.trim())
    && Number(unitPrice) > 0;

  return (
    <InlineForm colSpan={3}>
      <div style={{ flex: 1, minWidth: 160 }}>
        <Field label="Ngày hiệu lực">
          <DateInput
            className="input"
            required
            value={effectiveFrom}
            onChange={setEffectiveFrom}
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <Field label="Giá dầu mới (đ/lít)">
          <input
            className="input"
            type="number"
            min="1"
            required
            step="1"
            inputMode="numeric"
            placeholder="21740"
            value={unitPrice}
            onChange={e => setUnitPrice(e.target.value)}
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <Field label="Ghi chú (tùy chọn)">
          <input
            className="input"
            value={sourceNote}
            onChange={e => setSourceNote(e.target.value)}
            placeholder="Nguồn giá (VD: Petrolimex 18/7)"
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
          if (!canSave) return;
          onsave({
            effectiveFrom,
            unitPrice: Number(unitPrice),
            ...(sourceNote.trim() ? { sourceNote: sourceNote.trim() } : {}),
          });
        }}
      />
    </InlineForm>
  );
}

export default function FuelPricePeriodsConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
      <CrudTable<FuelPricePeriodRow>
        title="Giá dầu theo kỳ"
        description="Giá dầu Petrolimex công bố theo kỳ — nhập một bản ghi mỗi lần công bố giá mới"
        endpoint={CONFIG.FUEL_PRICE_PERIODS}
        colSpan={4}
        pageSlug="fuel-price-periods"
        emptyTitle="Chưa có kỳ giá dầu"
        emptyHint="Nhập kỳ giá đầu tiên để động cơ cước tự động có dữ liệu đối chiếu."
        sortFn={(a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)}
        columns={[
          { header: 'Ngày hiệu lực', render: r => formatDate(r.effectiveFrom) },
          { header: 'Giá dầu (đ/lít)', render: r => fmtPrice(r.unitPrice) },
          { header: 'Ghi chú', render: r => r.sourceNote || '—' },
          { header: 'Người nhập', render: r => r.createdByName || 'Không xác định' },
        ]}
        renderForm={p => (
          <FuelPricePeriodForm
            saving={p.saving}
            item={p.item}
            onsave={p.onSave}
            oncancel={p.onCancel}
            onDelete={p.onDelete}
            deleting={p.deleting}
          />
        )}
      />
    </div>
  );
}
