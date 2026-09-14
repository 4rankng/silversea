import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { opsClient } from '../../api/opsClient';
import { qk } from '../../api/keys';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';

import './ops-modal.css';
import { useOpsModalDismiss } from './useOpsModalDismiss';
interface UserOption {
  id: number;
  fullName: string | null;
  username: string | null;
}

/**
 * Admin control "Ops phụ trách" (OpsVanHanh §2/§4): assigns the single active
 * Ops owner of a truck. Empty selection clears the assignment.
 */
export function AssignOpsDialog({
  truck,
  currentOpsName,
  onClose,
}: {
  truck: { id: number; licensePlate: string };
  currentOpsName: string | null;
  onClose: () => void;
}) {
  const backdropRef = useOpsModalDismiss<HTMLDivElement>(onClose);
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState('__KEEP__');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: usersData } = useQuery<{ items: UserOption[] }>({
    queryKey: qk.ops.opsUsers,
    queryFn: () => api.get('/auth/users?role=OPS&limit=100'),
    staleTime: 60_000,
  });

  useEffect(() => {
    setChoice('__KEEP__');
    setError(null);
  }, [truck.id]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // '' clears the assignment; a numeric id assigns. '__KEEP__' never
      // reaches save (the submit button stays disabled).
      const opsUserId = choice === '' ? null : Number(choice);
      await opsClient.setTruckOpsAssignment(truck.id, opsUserId);
      await queryClient.invalidateQueries({ queryKey: qk.ops.root });
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Không thể lưu phân công.');
    } finally {
      setSaving(false);
    }
  }

  const options = usersData?.items ?? [];
  const noOpsStaff = usersData && options.length === 0;

  return (
    <div ref={backdropRef} tabIndex={-1} className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Gán Ops phụ trách xe ${truck.licensePlate}`}>
      <form className="ops-modal" onSubmit={handleSave}>
        <header className="ops-modal__head">
          <h2>Ops phụ trách — {truck.licensePlate}</h2>
          <button type="button" aria-label="Đóng" onClick={onClose}>✕</button>
        </header>
        <div className="ops-modal__body">
          <p className="ops-form-photos__hint">
            Hiện tại: {currentOpsName ?? '— chưa gán —'}. Mỗi xe chỉ có một Ops phụ trách đang hoạt động;
            gán người mới sẽ thay người cũ.
          </p>
          <UuiSelectField
            label="Ops phụ trách"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            ariaLabel="Chọn Ops phụ trách"
            options={[
              { value: '__KEEP__', label: '— Giữ nguyên —' },
              { value: '', label: '— Bỏ gán —' },
              ...options.map((user) => ({
                value: String(user.id),
                label: user.fullName?.trim() || user.username || `#${user.id}`,
              })),
            ]}
          />
          {error && <p className="ops-reject-reason" role="alert">{error}</p>}
          {noOpsStaff && <p className="ops-form-photos__hint" style={{ color: 'var(--warn, #d97706)' }}>Không tìm thấy nhân viên vận hành nào đang hoạt động.</p>}
        </div>
        <footer className="ops-modal__foot">
          <div />
          <div className="ops-modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Đóng</button>
            <button type="submit" className="btn-primary" disabled={saving || choice === '__KEEP__'}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
