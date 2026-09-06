import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useOpsExpenseTypes, useUpdateOpsExpense } from '../../hooks/useOpsQueries';
import type { OpsExpenseRow } from '../../api/opsClient';
import { useToast } from '../../components/shared/Toast';
import { formatVnd } from './opsStatus';

/**
 * Author edit of an own PENDING/REJECTED, unlinked expense (OpsVanHanh §5.5
 * "được sửa/xóa (chỉ người nhập)"). Container scope is fixed after create —
 * only type, amount, date and note are editable.
 */
export function OpsExpenseEditModal({ entry, onClose }: { entry: OpsExpenseRow; onClose: () => void }) {
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
    <div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Sửa khoản chi ${entry.shipmentCode ?? ''}`}>
      <form className="ops-modal" onSubmit={handleSubmit}>
        <header className="ops-modal__head">
          <h2>Sửa khoản chi · {entry.shipmentCode ?? entry.shipmentId}{entry.containerNumber ? ` · ${entry.containerNumber}` : ''}</h2>
          <button type="button" aria-label="Đóng" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="ops-modal__body">
          <div className="ops-form-grid">
            <label>
              Loại phí *
              <select value={typeCode} onChange={(event) => setTypeCode(event.target.value)} required>
                <option value="">— Chọn loại phí —</option>
                {groupedTypes.withInvoice.length > 0 && (
                  <optgroup label="Có hóa đơn">
                    {groupedTypes.withInvoice.map((type) => (
                      <option key={type.code} value={type.code}>{type.name}</option>
                    ))}
                  </optgroup>
                )}
                {groupedTypes.withoutInvoice.length > 0 && (
                  <optgroup label="Không hóa đơn">
                    {groupedTypes.withoutInvoice.map((type) => (
                      <option key={type.code} value={type.code}>{type.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
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
