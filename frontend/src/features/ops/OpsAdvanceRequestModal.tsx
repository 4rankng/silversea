import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useCreateOpsAdvanceRequest } from '../../hooks/useOpsQueries';
import { useToast } from '../../components/shared/Toast';
import { formatVnd } from './opsStatus';

import './ops-modal.css';
import { useOpsModalDismiss } from './useOpsModalDismiss';
/** "+ Xin Tạm Ứng" (OpsVanHanh §5.1) — lands in the shared advance_requests
 *  approval flow; the wallet total jumps only after approval. */
export function OpsAdvanceRequestModal({ onClose }: { onClose: () => void }) {
  const backdropRef = useOpsModalDismiss<HTMLDivElement>(onClose);
  const createAdvance = useCreateOpsAdvanceRequest();
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const amountClean = amount.replace(/[^\d]/g, '');
  const canSubmit = /^\d+$/.test(amountClean) && Number(amountClean) > 0 && reason.trim().length > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await createAdvance.mutateAsync({ amount: Number(amountClean), reason: reason.trim() });
      toast({ kind: 'success', message: 'Đã gửi yêu cầu tạm ứng — chờ duyệt.' });
      onClose();
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Gửi yêu cầu thất bại.' });
    }
  }

  return (
    <div ref={backdropRef} tabIndex={-1} className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Xin tạm ứng">
      <form className="ops-modal" onSubmit={handleSubmit}>
        <header className="ops-modal__head">
          <h2>Xin tạm ứng</h2>
          <button type="button" aria-label="Đóng" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="ops-modal__body">
          <div className="ops-form-grid">
            <label>
              Số tiền (VND) *
              <input
                value={amountClean ? formatVnd(amountClean) : ''}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                placeholder="0"
                required
              />
            </label>
            <label>
              Ngày
              <input readOnly value={new Date().toLocaleDateString('vi-VN')} />
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
          <div>{amountClean ? `${formatVnd(amountClean)} ₫` : ''}</div>
          <div className="ops-modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={createAdvance.isPending}>Đóng</button>
            <button type="submit" className="btn-primary" disabled={!canSubmit || createAdvance.isPending}>
              {createAdvance.isPending ? <Loader2 size={14} className="spin" /> : null} Gửi yêu cầu
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
