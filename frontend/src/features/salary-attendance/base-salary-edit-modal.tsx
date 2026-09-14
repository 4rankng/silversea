import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, X } from 'lucide-react';
import { Modal } from '../../components/UI';
import { Input } from '../../components/untitled-ui/base/input/input';
import { api } from '../../lib/api';
import { qk } from '../../api/keys';

/**
 * In-context base-salary editor for the salary summary card. Opens with the
 * driver pre-selected (the card already knows who), validates the amount,
 * writes through the drivers catalog CRUD, and invalidates the salary query
 * so the summary recomputes (baseSalary → dailyRate → netSalary).
 * Locked/confirmed periods keep their computed values — the change takes
 * effect from the NEXT computation, explained in the note.
 */
export function BaseSalaryEditModal({
  isOpen,
  onClose,
  driverId,
  driverName,
  currentBaseSalary,
  year,
  month,
}: {
  isOpen: boolean;
  onClose: () => void;
  driverId: number;
  driverName: string;
  currentBaseSalary: number;
  year: number;
  month: number;
}) {
  const [amount, setAmount] = useState(String(currentBaseSalary));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isOpen) {
      setAmount(String(currentBaseSalary));
      setError('');
    }
  }, [isOpen, currentBaseSalary]);

  const parsed = Number(amount.replace(/[,.\s]/g, ''));
  const valid = amount.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    setError('');
    try {
      await api.put(`/config/drivers/${driverId}`, { baseSalary: parsed });
      // Invalidate the salary query so the summary recomputes on next render.
      void queryClient.invalidateQueries({ queryKey: qk.salary.driverSalary(driverId, year, month) });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể lưu lương cứng.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title={`Sửa lương cứng — ${driverName}`}
      onClose={onClose}
      maxWidth={420}
      footer={
        <>
          <button className="btn btn--secondary btn--sm" onClick={onClose} disabled={saving}>
            <X size={14} /> Hủy
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => void handleSave()} disabled={saving || !valid}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Lưu
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input
          label="Lương cứng (đ/tháng)"
          value={amount}
          onChange={setAmount}
          placeholder="Ví dụ: 8000000"
          inputClassName="tabular-nums"
        />
        {!valid && amount.trim() !== '' && (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>
            Lương cứng phải là số không âm.
          </p>
        )}
        {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>{error}</p>}
        <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>
          Thay đổi áp dụng từ lần tính lương kế tiếp. Kỳ đã khóa hoặc đã xác nhận
          giữ nguyên giá trị đã tính.
        </p>
      </div>
    </Modal>
  );
}
