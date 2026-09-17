import { useId, useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { useAllCustomers, useRoutesDropdown } from '../../hooks/useCatalogQueries';
import { CONFIG } from '@tingting/shared';
import type { FreightRateTermRow } from '../../api/pricingClient';
import { DateInput } from '../../design-system/forms/DateInput';
import { businessDateISO, formatDate } from '../../lib/format';
import './FreightRateTermsConfigPage.css';

const fmtShare = (v: string) => Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
/** Base fuel price F — numeric(12,4); vi-VN grouping, up to 4 decimals. */
const fmtFuel = (v: string) => Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 4 });

function renderThreshold(r: FreightRateTermRow) {
  if (r.surchargeThresholdPct != null) {
    return <span style={{ color: 'var(--info-text)' }}>{fmtShare(r.surchargeThresholdPct)}%</span>;
  }
  if (r.surchargeThresholdAbs != null) {
    return <span style={{ color: 'var(--info-text)' }}>{Number(r.surchargeThresholdAbs).toLocaleString('vi-VN')} đ/lít</span>;
  }
  return <span style={{ color: 'var(--ink-3)' }}>—</span>;
}

type ThresholdMode = 'pct' | 'abs' | 'none' | '';

function thresholdModeOf(item?: FreightRateTermRow): ThresholdMode {
  if (!item) return '';
  if (item?.surchargeThresholdPct != null) return 'pct';
  if (item?.surchargeThresholdAbs != null) return 'abs';
  return 'none';
}

function FreightRateTermsForm({ saving, item, onsave, oncancel, onDelete, deleting }: {
  saving: boolean;
  item?: FreightRateTermRow;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const { data: customers = [] } = useAllCustomers();
  const { data: routes = [] } = useRoutesDropdown();
  const radioName = useId();

  const [customerId, setCustomerId] = useState(String(item?.customerId ?? ''));
  const [routeId, setRouteId] = useState(String(item?.routeId ?? ''));
  const [effectiveDate, setEffectiveDate] = useState(() => item?.effectiveDate ?? businessDateISO());
  const [sharePct, setSharePct] = useState(item?.sharePct ?? '');
  const [billingKm, setBillingKm] = useState(item?.billingKmOneWay != null ? String(item.billingKmOneWay) : '');
  const [baseFuelPrice, setBaseFuelPrice] = useState(item?.baseFuelPrice ?? '');
  const [lagDays, setLagDays] = useState(item?.fuelLagDays != null ? String(item.fuelLagDays) : '');
  const initialMode = thresholdModeOf(item);
  const [thresholdMode, setThresholdMode] = useState<ThresholdMode>(initialMode);
  const [thresholdPct, setThresholdPct] = useState(item?.surchargeThresholdPct ?? '');
  const [thresholdAbs, setThresholdAbs] = useState(item?.surchargeThresholdAbs ?? '');

  const modePct = thresholdMode === 'pct';
  const modeAbs = thresholdMode === 'abs';

  const canSave = Boolean(customerId)
    && Boolean(routeId)
    && Boolean(effectiveDate)
    && Boolean(billingKm.trim())
    && Number(billingKm) > 0
    && Boolean(baseFuelPrice.trim())
    && Number(baseFuelPrice) > 0
    && lagDays.trim() !== ''
    && Number.isInteger(Number(lagDays))
    && Number(lagDays) >= 0
    && thresholdMode !== ''
    && (!modePct || Number(thresholdPct) > 0)
    && (!modeAbs || Number(thresholdAbs) > 0);

  return (
    <InlineForm colSpan={8}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <UuiSelectField
          label="Khách hàng"
          value={customerId}
          onChange={e => setCustomerId(e.target.value)}
          options={[
            { value: '', label: '— Chọn khách hàng —' },
            ...customers.map(c => ({ value: String(c.id), label: c.name })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <UuiSelectField
          label="Tuyến"
          value={routeId}
          onChange={e => setRouteId(e.target.value)}
          options={[
            { value: '', label: '— Chọn tuyến —' },
            ...routes.map(r => ({ value: String(r.id), label: r.name })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="% chia sẻ">
          <input
            className="input"
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={sharePct}
            onChange={e => setSharePct(e.target.value)}
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <Field label="Ngày hiệu lực">
          <DateInput
            className="input"
            required
            value={effectiveDate}
            onChange={setEffectiveDate}
            disabled={saving}
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Km một chiều">
          <input
            className="input"
            type="number"
            min="0"
            step="1"
            value={billingKm}
            onChange={e => setBillingKm(e.target.value)}
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 150 }}>
        <Field label="Giá dầu mốc (đ/lít)">
          <input
            className="input"
            type="number"
            min="0"
            step="0.0001"
            value={baseFuelPrice}
            onChange={e => setBaseFuelPrice(e.target.value)}
          />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 110 }}>
        <Field label="Trễ ngày (lag)">
          <input
            className="input"
            type="number"
            min="0"
            step="1"
            value={lagDays}
            required
            onChange={e => setLagDays(e.target.value)}
          />
        </Field>
      </div>
      <fieldset className="freight-terms-threshold">
        <legend>Ngưỡng kích hoạt điều chỉnh</legend>
        <div className="freight-terms-threshold__choices" role="radiogroup" aria-label="Chọn dạng ngưỡng">
          <label>
            <input type="radio" name={radioName} aria-label="Ngưỡng theo tỷ lệ phần trăm" required checked={modePct} onChange={() => setThresholdMode('pct')} />
            Tỷ lệ %
          </label>
          <input className="input" type="number" aria-label="Giá trị ngưỡng phần trăm" placeholder="%" min="0.01" step="any" required={modePct} value={thresholdPct} onChange={e => setThresholdPct(e.target.value)} disabled={!modePct} />
          <label>
            <input type="radio" name={radioName} aria-label="Ngưỡng theo số tiền" checked={modeAbs} onChange={() => setThresholdMode('abs')} />
            VNĐ/lít
          </label>
          <input className="input" type="number" aria-label="Giá trị ngưỡng VNĐ trên lít" placeholder="đ/lít" min="1" step="1" required={modeAbs} value={thresholdAbs} onChange={e => setThresholdAbs(e.target.value)} disabled={!modeAbs} />
          <label className="freight-terms-threshold__none">
            <input type="radio" name={radioName} aria-label="Không áp dụng ngưỡng" checked={thresholdMode === 'none'} onChange={() => setThresholdMode('none')} />
            Không áp dụng
          </label>
        </div>
      </fieldset>
      <FormActions
        saving={saving}
        isedit={!!item}
        oncancel={oncancel}
        ondelete={onDelete}
        deleting={deleting}
        onsave={() => {
          if (!canSave) return;
          onsave({
            customerId: Number(customerId),
            routeId: Number(routeId),
            effectiveDate,
            sharePct: sharePct === '' ? 0 : Number(sharePct),
            billingKmOneWay: Number(billingKm),
            baseFuelPrice: baseFuelPrice,
            fuelLagDays: Number(lagDays),
            // Always send BOTH threshold keys: the CRUD merge-on-update treats
            // undefined as "keep current", so a row switched to "Không áp
            // dụng" must carry explicit nulls to clear the stored mode.
            surchargeThresholdPct: modePct ? Number(thresholdPct) : null,
            surchargeThresholdAbs: modeAbs ? Number(thresholdAbs) : null,
          });
        }}
      />
    </InlineForm>
  );
}

export default function FreightRateTermsConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const { data: customers = [] } = useAllCustomers();
  const { data: routes = [] } = useRoutesDropdown();
  const customerNames = new Map<number, string>(customers.map(c => [c.id, c.name] as const));
  const routeNames = new Map<number, string>(routes.map(r => [r.id, r.name] as const));
  return (
    <div ref={pageRef}>
      <CrudTable<FreightRateTermRow>
        title="Điều khoản cước theo tuyến"
        description="Điều khoản hợp đồng theo khách hàng × tuyến — tham số cho động cơ tính cước tự động"
        endpoint={CONFIG.FREIGHT_RATE_TERMS}
        colSpan={8}
        pageSlug="freight-rate-terms"
        emptyTitle="Chưa có điều khoản cước"
        emptyHint="Thêm điều khoản đầu tiên theo hợp đồng vận chuyển của từng khách hàng."
        sortFn={(a, b) => b.effectiveDate.localeCompare(a.effectiveDate)}
        columns={[
          { header: 'Khách hàng', render: r => customerNames.get(r.customerId) ?? `KH #${r.customerId}` },
          { header: 'Tuyến', render: r => routeNames.get(r.routeId) ?? `Tuyến #${r.routeId}` },
          { header: '% chia sẻ', render: r => `${fmtShare(r.sharePct)}%` },
          { header: 'Km 1 chiều', render: r => r.billingKmOneWay.toLocaleString('vi-VN') },
          { header: 'Giá gốc dầu F', render: r => fmtFuel(r.baseFuelPrice) },
          { header: 'Ngưỡng', render: r => renderThreshold(r) },
          { header: 'Trễ (ngày)', render: r => String(r.fuelLagDays) },
          { header: 'Ngày hiệu lực', render: r => formatDate(r.effectiveDate) },
        ]}
        renderForm={p => (
          <FreightRateTermsForm
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
