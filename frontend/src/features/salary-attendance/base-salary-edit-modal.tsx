import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, X } from 'lucide-react';
import { Modal } from '../../components/UI';
import { Input } from '../../components/untitled-ui/base/input/input';
import { api } from '../../lib/api';
import { CONFIG } from '@tingting/shared';
import { qk } from '../../api/keys';

/** The drivers catalog PUT is optimistic-locked (428 without the token), so
 *  the version comes from a freshly loaded driver row — the salary summary
 *  does not carry updatedAt. */
function isVersionConflict(err: unknown): boolean {
  const e = err as { status?: number };
  return e.status === 428 || e.status === 409;
}

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
  const [versionToken, setVersionToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isOpen) {
      setAmount(String(currentBaseSalary));
      setError('');
    }
  }, [isOpen, currentBaseSalary]);

  // Mint the optimistic-lock token from the live driver row whenever the
  // modal opens — a token captured earlier may be stale after other writes.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setVersionToken(null);
    setTokenError(false);
    api
      .get<{ updatedAt: string }>(CONFIG.DRIVER(driverId))
      .then((row) => { if (!cancelled) setVersionToken(row.updatedAt); })
      .catch(() => { if (!cancelled) setTokenError(true); });
    return () => { cancelled = true; };
  }, [isOpen, driverId]);

  async function refreshVersionToken() {
    const row = await api.get<{ updatedAt: string }>(CONFIG.DRIVER(driverId));
    setVersionToken(row.updatedAt);
  }

  const parsed = Number(amount.replace(/[,.\s]/g, ''));
  const valid = amount.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  const handleSave = async () => {
    if (!valid || !versionToken) return;
    setSaving(true);
    setError('');
    try {
      // CONFIG.DRIVER — the shared path constant; drivers mount at the bare
      // /api/drivers (config router), never under /config/. The catalog PUT
      // is optimistic-locked: expectedUpdatedAt → If-Unmodified-Since (428
      // without it).
      await api.put(CONFIG.DRIVER(driverId), { baseSalary: parsed }, { expectedUpdatedAt: versionToken });
      // Invalidate the salary query so the summary recomputes on next render,
      // and the drivers catalog cache so other surfaces see the new amount.
      void queryClient.invalidateQueries({ queryKey: qk.salary.driverSalary(driverId, year, month) });
      void queryClient.invalidateQueries({ queryKey: qk.configCounts.drivers });
      onClose();
    } catch (e) {
      if (isVersionConflict(e)) {
        // Someone else saved first — mint a fresh token, keep the typed
        // amount, and let the admin retry against the newest row.
        try {
          await refreshVersionToken();
          setError('Lương cứng đã được cập nhật ở nơi khác — đã tải bản mới nhất. Kiểm tra số tiền rồi lưu lại.');
        } catch {
          setError('Không thể tải lại thông tin lái xe. Vui lòng đóng và mở lại hộp thoại.');
        }
      } else {
        setError(e instanceof Error ? e.message : 'Không thể lưu lương cứng.');
      }
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
          <button
            className="btn btn--primary btn--sm"
            onClick={() => void handleSave()}
            disabled={saving || !valid || !versionToken}
          >
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
        {tokenError && !error && (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>
            Không tải được thông tin lái xe — đóng và mở lại hộp thoại để lưu.
          </p>
        )}
        <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>
          Thay đổi áp dụng từ lần tính lương kế tiếp. Kỳ đã khóa hoặc đã xác nhận
          giữ nguyên giá trị đã tính.
        </p>
      </div>
    </Modal>
  );
}
