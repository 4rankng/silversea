import { useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { Btn, FormGroup, Modal } from '../../../components/UI';
import { formatCurrency } from '../../../lib/format';
import type { PenaltyRow } from '../../../hooks/usePenalties';

interface CancelPenaltyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  penalty: PenaltyRow | null;
  loading: boolean;
}

export function CancelPenaltyDialog({
  isOpen,
  onClose,
  onConfirm,
  penalty,
  loading,
}: CancelPenaltyDialogProps) {
  const [reason, setReason] = useState('');
  if (!isOpen || !penalty) return null;
  return (
    <Modal
      isOpen
      title="Xác nhận hủy kỷ luật?"
      ariaLabel="Xác nhận hủy kỷ luật?"
      onClose={onClose}
      maxWidth={400}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--danger-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)' }}>
          <XCircle size={18} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Hành động này sẽ hoàn tiền vào tài khoản lái xe</div>
        </div>
      </div>
      <div style={{ fontSize: 13, marginBottom: 12, padding: '10px 12px', background: 'var(--bg-2)', borderRadius: 8 }}>
        <div><strong>Lái xe:</strong> {penalty.driverName || 'Lái xe'}</div>
        <div><strong>Số tiền:</strong> <span style={{ color: 'var(--danger)' }}>{formatCurrency(Number(penalty.amount))}đ</span></div>
        <div><strong>Lý do:</strong> {penalty.reasonText || penalty.customReason || '—'}</div>
      </div>
      <FormGroup label="Lý do hủy (tùy chọn)">
        <input className="input" placeholder="Ví dụ: Hủy do sai sót..." value={reason} onChange={e => setReason(e.target.value)} />
      </FormGroup>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Btn variant="ghost" onClick={onClose}>Đóng</Btn>
        <Btn variant="danger" icon={loading ? <Loader2 size={13} className="spin" /> : <XCircle size={13} />} disabled={loading} onClick={() => onConfirm(reason || undefined)}>
          Xác nhận hủy
        </Btn>
      </div>
    </Modal>
  );
}
