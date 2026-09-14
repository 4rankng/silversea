import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useOpsExpenseTypes, useUpdateOpsExpense } from '../../hooks/useOpsQueries';
import type { OpsExpenseRow } from '../../api/opsClient';
import { useToast } from '../../components/shared/Toast';
import { formatVnd } from './opsStatus';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';

import './ops-modal.css';
import { useOpsModalDismiss } from './useOpsModalDismiss';
/**
 * Author edit of an own PENDING/REJECTED, unlinked expense (OpsVanHanh §5.5
 * "được sửa/xóa (chỉ người nhập)"). Container scope is fixed after create —
 * only type, amount, date and note are editable.
 */
export function OpsExpenseEditModal({ entry, onClose }: { entry: OpsExpenseRow; onClose: () => void }) {
  const backdropRef = useOpsModalDismiss<HTMLDivElement>(onClose);
  const { data: typesData } = useOpsExpenseTypes();
  const updateExpense = useUpdateOpsExpense();
  const { toast } = useToast();

  const [typeCode, setTypeCode] = useState(entry.expenseTypeCode);
  const [amount, setAmount] = useState(entry.amount);
  const [paidAt, setPaidAt] = useState(entry.paidAt);
  const [note, setNote] = useState(entry.note ?? '');

  const groupedTypes = useMemo(() => {
    const items = typesData?.items ?? [];
    return {
      withInvoice: items.filter((type) => type.requiresInvoice === true),
      withoutInvoice: items.filter((type) => type.requiresInvoice !== true),
    };
  }, [typesData]);

  // UuiSelectField has no optgroup support — flatten the two groups with
  // disabled section-header rows so the grouping stays visible in the menu.
  const expenseTypeOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; disabled?: boolean }> = [
      { value: '', label: '— Chọn loại phí —' },
    ];
    if (groupedTypes.withInvoice.length > 0) {
      options.push({ value: '__HDR_INV__', label: '— Có hóa đơn —', disabled: true });
      groupedTypes.withInvoice.forEach((type) => options.push({ value: type.code, label: type.name }));
    }
    if (groupedTypes.withoutInvoice.length > 0) {
      options.push({ value: '__HDR_NO_INV__', label: '— Không hóa đơn —', disabled: true });
      groupedTypes.withoutInvoice.forEach((type) => options.push({ value: type.code, label: type.name }));
    }
    return options;
  }, [groupedTypes]);

  const amountClean = amount.replace(/[^\d]/g, '');
  const canSubmit = Boolean(typeCode) && /^\d+$/.test(amountClean) && Number(amountClean) > 0 && !updateExpense.isPending;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await updateExpense.mutateAsync({
        id: entry.id,
        body: {
          expenseTypeCode: typeCode,
          amount: amountClean,
          paidAt,
          note: note.trim() || null,
        },
      });
      toast({ kind: 'success', message: 'Đã cập nhật khoản chi.' });
      onClose();
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Cập nhật thất bại.' });
    }
  }

  return (
    <div ref={backdropRef} tabIndex={-1} className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Sửa khoản chi ${entry.shipmentCode ?? ''}`}>
      <form className="ops-modal" onSubmit={handleSubmit}>
        <header className="ops-modal__head">
          <h2>Sửa khoản chi · {entry.shipmentCode ?? entry.shipmentId}{entry.containerNumber ? ` · ${entry.containerNumber}` : ''}</h2>
          <button type="button" aria-label="Đóng" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="ops-modal__body">
          <div className="ops-form-grid">
            <UuiSelectField
              label="Loại phí"
              required
              value={typeCode}
              onChange={(event) => setTypeCode(event.target.value)}
              options={expenseTypeOptions}
            />
            <label>
              Số tiền (VND) *
              <input
                value={amountClean ? formatVnd(amountClean) : ''}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                required
              />
            </label>
            <label>
              Ngày chi *
              <input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} required />
            </label>
          </div>
          <label className="ops-form-note">
            Ghi chú
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </label>
        </div>
        <footer className="ops-modal__foot">
          <div>{entry.rejectionReason ? `Lý do bị từ chối: ${entry.rejectionReason}` : ''}</div>
          <div className="ops-modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={updateExpense.isPending}>Đóng</button>
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {updateExpense.isPending ? <Loader2 size={14} className="spin" /> : null} Lưu
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
