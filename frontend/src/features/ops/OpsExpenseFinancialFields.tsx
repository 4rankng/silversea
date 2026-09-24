import { useState } from 'react';
import { DateField, TextField, UuiSelectField } from '../../design-system';
import { formatCurrency } from '../../lib/format';
import { ExpenseNameSuggestions } from '../expense-accounting/ExpenseNameSuggestions';

export type OpsCostGroup = 'INVOICED_LIFT' | 'INVOICED_DROP' | 'INVOICED_OTHER' | 'OPS_REGULAR' | 'OPS_INCIDENTAL';

export interface OpsExpenseFinancialDraft {
  costGroup: OpsCostGroup;
  feeName: string;
  invoiceNumber: string;
  invoiceDate: string;
  recoveryNote: string;
  /** Card 20260921_5 — Thực-thu side of the no-invoice pair (display text;
   *  parsed server-side). Empty = not collected from the customer. */
  customerChargeAmount: string;
}

export const OPS_COST_GROUP_OPTIONS = [
  { value: 'INVOICED_LIFT', label: 'Có hóa đơn · Nâng' },
  { value: 'INVOICED_DROP', label: 'Có hóa đơn · Hạ' },
  { value: 'INVOICED_OTHER', label: 'Có hóa đơn · Phí khác' },
  { value: 'OPS_REGULAR', label: 'Không hóa đơn · Giao nhận' },
  { value: 'OPS_INCIDENTAL', label: 'Không hóa đơn · Phát sinh' },
];

export function opsGroupForType(code: string, invoiced: boolean): OpsCostGroup {
  if (!invoiced) return 'OPS_REGULAR';
  if (code === 'LIFTING') return 'INVOICED_LIFT';
  if (code === 'LOWERING') return 'INVOICED_DROP';
  return 'INVOICED_OTHER';
}

export function useOpsExpenseFinancialDraft(initial?: Partial<OpsExpenseFinancialDraft>) {
  return useState<OpsExpenseFinancialDraft>({
    costGroup: initial?.costGroup ?? 'OPS_REGULAR',
    feeName: initial?.feeName ?? '',
    invoiceNumber: initial?.invoiceNumber ?? '',
    invoiceDate: initial?.invoiceDate ?? '',
    recoveryNote: initial?.recoveryNote ?? '',
    customerChargeAmount: initial?.customerChargeAmount ?? '',
  });
}

export function opsFinancialPayload(draft: OpsExpenseFinancialDraft) {
  const invoiced = draft.costGroup.startsWith('INVOICED_');
  return {
    costGroup: draft.costGroup,
    feeName: draft.feeName.trim() || undefined,
    invoiceNumber: invoiced ? draft.invoiceNumber.trim() || null : null,
    invoiceDate: invoiced ? draft.invoiceDate || null : null,
    recoveryNote: draft.recoveryNote.trim() || null,
    customerChargeAmount: invoiced ? undefined : (draft.customerChargeAmount.trim() === '' ? undefined : draft.customerChargeAmount.trim()),
  };
}

export function OpsExpenseFinancialFields({ value, onChange, amount, disabled = false }: {
  value: OpsExpenseFinancialDraft;
  onChange: (value: OpsExpenseFinancialDraft) => void;
  amount: number;
  disabled?: boolean;
}) {
  const invoiced = value.costGroup.startsWith('INVOICED_');
  const patch = (next: Partial<OpsExpenseFinancialDraft>) => onChange({ ...value, ...next });
  return <section className="ops-expense-financial" aria-label="Phân loại và hóa đơn">
    <div className="ops-form-grid">
      <UuiSelectField label="Nhóm chi phí" value={value.costGroup} disabled={disabled}
        onChange={(event) => patch({ costGroup: event.target.value as OpsCostGroup })}
        options={OPS_COST_GROUP_OPTIONS} />
      <TextField controlSize="sm" label="Tên khoản chi" value={value.feeName} disabled={disabled}
        onChange={(event) => patch({ feeName: event.target.value })} maxLength={200}
        placeholder="Ví dụ: công nhân ngoài giờ" />
      {invoiced && <>
        <TextField controlSize="sm" label="Số hóa đơn" value={value.invoiceNumber} disabled={disabled}
          onChange={(event) => patch({ invoiceNumber: event.target.value })} maxLength={50}
          helpText="Có thể bổ sung hóa đơn sau trên khoản đã lưu." />
        <DateField controlSize="sm" label="Ngày hóa đơn" value={value.invoiceDate} disabled={disabled}
          onChange={(invoiceDate) => patch({ invoiceDate })} />
      </>}
      {!invoiced && <TextField controlSize="sm" label="Thực thu (thu khách)" value={value.customerChargeAmount} disabled={disabled}
        onChange={(event) => patch({ customerChargeAmount: event.target.value })} inputMode="decimal"
        placeholder="Để trống nếu chưa thu khách" />}
    </div>
    <ExpenseNameSuggestions group={value.costGroup} disabled={disabled} onChoose={feeName => patch({ feeName })} />
    {invoiced && (
      <p className="ops-form-photos__hint">
        {`Thu khách dự kiến: ${formatCurrency(Number.isFinite(amount) ? amount : 0)}.`}
      </p>
    )}
    <TextField controlSize="sm" label="Ghi chú thu khách" value={value.recoveryNote} disabled={disabled}
      onChange={(event) => patch({ recoveryNote: event.target.value })} maxLength={1000}
      placeholder="Đã gồm trong giá trọn gói / đề nghị thu thêm…" />
  </section>;
}
