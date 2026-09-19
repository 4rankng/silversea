import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadOpsOwnerOptions } from './ops-owner-options';
import { opsClient } from '../../api/opsClient';
import { qk } from '../../api/keys';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
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
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState('__KEEP__');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: usersData, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: qk.ops.opsUsers,
    queryFn: loadOpsOwnerOptions,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
  const close = () => { if (!saving) onClose(); };


  useEffect(() => {
    setChoice('__KEEP__');
    setError(null);
  }, [truck.id]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (saving || choice === '__KEEP__') return;
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

  // KP-090: only show active, non-deleted staff in the picker
  const options = (usersData ?? []).filter((user) => user.status === 'ACTIVE');
  const noOpsStaff = !isPending && !isError && options.length === 0;
  const excludedCount = (usersData?.length ?? 0) - options.length;

  return (
    <OpsModalBackdrop onClose={close} ariaLabel={`Gán Ops phụ trách xe ${truck.licensePlate}`}>
      <form className="ops-modal" onSubmit={handleSave}>
        <header className="ops-modal__head">
          <h2>Ops phụ trách — {truck.licensePlate}</h2>
          <button type="button" aria-label="Đóng" onClick={close} disabled={saving}><X size={18} /></button>
        </header>
        <div className="ops-modal__body">
          <p className="ops-form-photos__hint">
            Hiện tại: {currentOpsName ?? '— chưa gán —'}. Mỗi xe chỉ có một Ops phụ trách đang hoạt động;
            gán người mới sẽ thay người cũ.
          </p>
          <UuiSelectField
            label="Ops phụ trách"
            value={choice}
            disabled={saving || isPending || isError}
            onChange={(event) => setChoice(event.target.value)}
            ariaLabel="Chọn Ops phụ trách"
            options={[
              { value: '__KEEP__', label: '— Giữ nguyên —' },
              { value: '', label: '— Bỏ gán —' },
              ...options.map((user) => ({
                value: String(user.id),
                label: [user.fullName?.trim(), user.username].filter(Boolean).join(' · ') || '—',
              })),
            ]}
          />
          {isPending && <p role="status" className="ops-form-photos__hint">Đang tải nhân viên vận hành…</p>}
          {isError && <div role="alert">
            <p>Không tải được danh sách nhân viên vận hành. Lựa chọn của bạn vẫn được giữ.</p>
            <button type="button" className="btn-secondary" disabled={isFetching} onClick={() => void refetch()}>{isFetching ? 'Đang tải…' : 'Thử lại'}</button>
          </div>}
          {excludedCount > 0 && <p className="ops-form-photos__hint">{excludedCount} tài khoản ngừng hoạt động không thể nhận phân công mới.</p>}
          {error && <p className="ops-reject-reason" role="alert">{error}</p>}
          {noOpsStaff && <p className="ops-form-photos__hint" style={{ color: 'var(--warn, #d97706)' }}>Không tìm thấy nhân viên vận hành nào đang hoạt động.</p>}
        </div>
        <footer className="ops-modal__foot">
          <div />
          <div className="ops-modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Đóng</button>
            <button type="submit" className="btn-primary" disabled={saving || isPending || isError || choice === '__KEEP__'}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </footer>
      </form>
    </OpsModalBackdrop>
  );
}
