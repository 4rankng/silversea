import { useEffect, useState } from 'react';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

interface FulfillmentEstimateCellProps {
  row: DispatchDetailPlanRow;
  onSave: (
    row: DispatchDetailPlanRow,
    estimates: { plannedRevenue: number | null; plannedCarrierCost: number | null },
  ) => Promise<unknown>;
}

function toInputValue(value: string | null): string {
  return value ?? '';
}

function toNullableVnd(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isInteger(amount) && amount >= 0 ? amount : null;
}

/** Editable dispatch estimates; this component never exposes a financial ledger. */
export function FulfillmentEstimateCell({ row, onSave }: FulfillmentEstimateCellProps) {
  const estimates = row.estimates ?? { plannedRevenue: null, plannedCarrierCost: null };
  const [revenue, setRevenue] = useState(toInputValue(estimates.plannedRevenue));
  const [carrierCost, setCarrierCost] = useState(toInputValue(estimates.plannedCarrierCost));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRevenue(toInputValue(estimates.plannedRevenue));
    setCarrierCost(toInputValue(estimates.plannedCarrierCost));
  }, [estimates.plannedCarrierCost, estimates.plannedRevenue, row.fulfillmentId]);

  const nextRevenue = toNullableVnd(revenue);
  const nextCarrierCost = toNullableVnd(carrierCost);
  const invalid = (revenue.trim() !== '' && nextRevenue == null)
    || (carrierCost.trim() !== '' && nextCarrierCost == null);
  const unchanged = revenue === toInputValue(estimates.plannedRevenue)
    && carrierCost === toInputValue(estimates.plannedCarrierCost);

  async function save() {
    if (invalid || unchanged) return;
    setSaving(true);
    try {
      await onSave(row, { plannedRevenue: nextRevenue, plannedCarrierCost: nextCarrierCost });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fulfillment-estimate-cell">
      <label>
        <span>Cước thu dự kiến</span>
        <input className="fulfillment-estimate-cell__input" aria-label="Cước thu dự kiến" inputMode="numeric" type="number" min="0" step="1" value={revenue} onChange={(event) => setRevenue(event.target.value)} disabled={saving} />
      </label>
      <label>
        <span>Cước trả dự kiến</span>
        <input className="fulfillment-estimate-cell__input" aria-label="Cước trả dự kiến" inputMode="numeric" type="number" min="0" step="1" value={carrierCost} onChange={(event) => setCarrierCost(event.target.value)} disabled={saving} />
      </label>
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => void save()} disabled={saving || invalid || unchanged}>
        {saving ? 'Đang lưu…' : 'Lưu cước'}
      </button>
      <small>Dự toán Điều vận — chưa hạch toán.</small>
    </div>
  );
}
