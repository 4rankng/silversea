import { useState } from 'react';
import { formatCurrency } from '../../lib/format';
import { NumberField } from '../../design-system';


/**
 * Debit-note freight override — docx §4 manual override.
 *
 * system_calculated_freight is READ-ONLY; final_debit_freight is the
 * negotiated value; reason REQUIRED iff final ≠ system (validated inline AND
 * server-side by T1). Prop-driven so the BillingDocumentBuilder integration
 * is a thin connect once T1 lands the endpoint.
 */
export function DebitNoteFreightOverride({
  systemFreight, initialFinal, initialReason, saving, onSave,
}: {
  systemFreight: number;
  initialFinal?: number | null;
  initialReason?: string | null;
  saving?: boolean;
  onSave: (payload: { finalDebitFreight: number | null; overrideReason?: string }) => void;
}) {
  const [finalValue, setFinalValue] = useState<number | ''>(initialFinal ?? '');
  const [reason, setReason] = useState(initialReason ?? '');
  const [touched, setTouched] = useState(false);

  const parsed = finalValue === '' ? null : finalValue;
  const overrides = parsed != null && parsed !== systemFreight;
  const invalid = overrides && !reason.trim();

  const attemptSave = () => {
    setTouched(true);
    if (invalid) return;
    onSave({
      finalDebitFreight: parsed,
      ...(overrides ? { overrideReason: reason.trim() } : {}),
    });
  };

  return (
    <div data-debit-override style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div>
        <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)' }}>Giá cước hệ thống</div>
        <div style={{ fontFamily: 'var(--font-data)', fontWeight: 600 }}>{formatCurrency(systemFreight)}</div>
      </div>
      <NumberField
        label="Giá cước đàm phán"
        value={finalValue}
        onChange={setFinalValue}
        min={0}
        step={1}
        grouped
        disabled={saving}
        placeholder="0"
      />
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)' }}>Lý do (bắt buộc khi giá thay đổi)</div>
        <textarea
          className="input"
          aria-label="Lý do điều chỉnh"
          rows={2}
          value={reason}
          onChange={e => setReason(e.target.value)}
          style={{ width: '100%', resize: 'vertical' }}
        />
        {touched && invalid && (
          <div style={{ color: 'var(--danger)', fontSize: 'var(--text-body-size)', marginTop: 4 }} role="alert">
            Bắt buộc nhập lý do khi giá cước thay đổi so với hệ thống
          </div>
        )}
      </div>
      <button className="btn btn--secondary btn--sm" onClick={attemptSave} disabled={saving}>
        Lưu điều chỉnh
      </button>
    </div>
  );
}
