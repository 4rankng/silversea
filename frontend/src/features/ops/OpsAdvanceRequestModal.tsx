import { useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useCreateOpsAdvanceRequest } from '../../hooks/useOpsQueries';
import { useToast } from '../../components/shared/Toast';
import { formatVnd } from './opsStatus';
import { NumberField } from '../../design-system/forms/NumberField';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
import { formatDate } from '../../lib/format';
/** Records a request only; the wallet changes when an actual funded advance is recorded. */
export function OpsAdvanceRequestModal({ onClose }: { onClose: () => void }) {
  const createAdvance = useCreateOpsAdvanceRequest();
  const { toast } = useToast();
  const [amount, setAmount] = useState<number | ''>('');
  const saving = useRef(false);
  const [reason, setReason] = useState('');

  const amountValid = amount !== '' && Number.isSafeInteger(amount) && amount > 0 && amount <= 999_999_999_999_999;
  const amountError = amount === '' || amountValid ? undefined
    : amount <= 0 ? 'Số tiền phải là số dương' : 'Nhập số tiền nguyên, tối đa 999.999.999.999.999đ';
  const canSubmit = amountValid && reason.trim().length > 0 && !createAdvance.isPending;
  const close = () => { if (!saving.current) onClose(); };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || saving.current) return;
    saving.current = true;
    try {
      await createAdvance.mutateAsync({ amount: Number(amount), reason: reason.trim() });
      toast({ kind: 'success', message: 'Đã lưu tạm ứng.' });
      onClose();
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Không thể lưu tạm ứng.' });
    } finally { saving.current = false; }
  }

  return (
    <OpsModalBackdrop onClose={close} ariaLabel="Xin tạm ứng">
      <form className="ops-modal" onSubmit={handleSubmit}>
        <header className="ops-modal__head">
          <h2>Xin tạm ứng</h2>
          <button type="button" aria-label="Đóng" onClick={close}><X size={18} /></button>
        </header>
        <div className="ops-modal__body">
          <div className="ops-form-grid">
            <NumberField controlSize="sm" label="Số tiền (VND)" value={amount} onChange={setAmount}
              min={1} max={999_999_999_999_999} step={1} required error={amountError} disabled={createAdvance.isPending} />
            <label>
              Ngày
              <input readOnly value={formatDate(new Date().toISOString())} />
            </label>
          </div>
          <label className="ops-form-note">
            Lý do / Ghi chú *
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              required
              placeholder="VD: Tạm ứng phí cảng cho 5 cont ngày mai"
            />
          </label>
        </div>
        <footer className="ops-modal__foot">
          <div>{amountValid ? `${formatVnd(Number(amount))} ₫` : ''}</div>
          <div className="ops-modal__actions">
            <button type="button" className="btn-secondary" onClick={close} disabled={createAdvance.isPending}>Đóng</button>
            <button type="submit" className="btn-primary" disabled={!canSubmit || createAdvance.isPending}>
              {createAdvance.isPending ? <Loader2 size={14} className="spin" /> : null} Lưu tạm ứng
            </button>
          </div>
        </footer>
      </form>
    </OpsModalBackdrop>
  );
}
