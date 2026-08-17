import { useEffect, useRef, useState } from 'react';
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

function formatVnd(value: string | null): string {
  if (value == null || value === '') return 'Chưa nhập';
  const amount = Number(value);
  return Number.isFinite(amount) ? `${new Intl.NumberFormat('vi-VN').format(amount)} đ` : value;
}

/** Editable dispatch estimates; this component never exposes a financial ledger. */
export function FulfillmentEstimateCell({ row, onSave }: FulfillmentEstimateCellProps) {
  const estimates = row.estimates ?? { plannedRevenue: null, plannedCarrierCost: null };
  const [revenue, setRevenue] = useState(toInputValue(estimates.plannedRevenue));
  const [carrierCost, setCarrierCost] = useState(toInputValue(estimates.plannedCarrierCost));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<'revenue' | 'carrierCost' | null>(null);
  const [invalid, setInvalid] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    setRevenue(toInputValue(estimates.plannedRevenue));
    setCarrierCost(toInputValue(estimates.plannedCarrierCost));
  }, [estimates.plannedCarrierCost, estimates.plannedRevenue, row.fulfillmentId]);

  async function save(field: 'revenue' | 'carrierCost') {
    if (savingRef.current) return;
    const draft = field === 'revenue' ? revenue : carrierCost;
    const nextValue = toNullableVnd(draft);
    if (draft.trim() !== '' && nextValue == null) {
      setInvalid(true);
      return;
    }
    const currentValue = field === 'revenue' ? estimates.plannedRevenue : estimates.plannedCarrierCost;
    if (draft === toInputValue(currentValue)) {
      setEditing(null);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(row, {
        plannedRevenue: field === 'revenue' ? nextValue : toNullableVnd(estimates.plannedRevenue ?? ''),
        plannedCarrierCost: field === 'carrierCost' ? nextValue : toNullableVnd(estimates.plannedCarrierCost ?? ''),
      });
      setEditing(null);
      setInvalid(false);
    } catch {
      // The parent retains the operational error and the draft stays available.
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function startEditing(field: 'revenue' | 'carrierCost') {
    setInvalid(false);
    setEditing(field);
  }

  function cancelEditing() {
    setRevenue(toInputValue(estimates.plannedRevenue));
    setCarrierCost(toInputValue(estimates.plannedCarrierCost));
    setInvalid(false);
    setEditing(null);
  }

  return (
    <div className="fulfillment-estimate-cell">
      {editing === 'revenue' ? (
        <input autoFocus className="fulfillment-estimate-cell__input" aria-label="Cước thu dự kiến" inputMode="numeric" type="number" min="0" step="1" value={revenue} onFocus={(event) => event.currentTarget.select()} onChange={(event) => { setRevenue(event.target.value); setInvalid(false); }} onBlur={() => void save('revenue')} onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur(); } if (event.key === 'Escape') cancelEditing(); }} disabled={saving} aria-invalid={invalid} />
      ) : (
        <button type="button" className={`fulfillment-estimate-cell__value${estimates.plannedRevenue == null ? ' is-placeholder' : ''}`} onClick={() => startEditing('revenue')} aria-label={`Chỉnh sửa cước thu dự kiến: ${formatVnd(estimates.plannedRevenue)}`}>Thu: {formatVnd(estimates.plannedRevenue)}</button>
      )}
      {editing === 'carrierCost' ? (
        <input autoFocus className="fulfillment-estimate-cell__input" aria-label="Cước trả dự kiến" inputMode="numeric" type="number" min="0" step="1" value={carrierCost} onFocus={(event) => event.currentTarget.select()} onChange={(event) => { setCarrierCost(event.target.value); setInvalid(false); }} onBlur={() => void save('carrierCost')} onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur(); } if (event.key === 'Escape') cancelEditing(); }} disabled={saving} aria-invalid={invalid} />
      ) : (
        <button type="button" className={`fulfillment-estimate-cell__value${estimates.plannedCarrierCost == null ? ' is-placeholder' : ''}`} onClick={() => startEditing('carrierCost')} aria-label={`Chỉnh sửa cước trả dự kiến: ${formatVnd(estimates.plannedCarrierCost)}`}>Trả: {formatVnd(estimates.plannedCarrierCost)}</button>
      )}
    </div>
  );
}
