import { useEffect, useState } from 'react';
import { Modal } from '../UI';
import { api } from '../../lib/api';
import { invalidateAllCatalogs } from '../../api/keys';
import { useQueryClient } from '@tanstack/react-query';
import './QuickAddDriverDialog.css';

interface QuickAddDriverDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (driverId: number, name: string) => void;
}

/** FB-066 (card 121026141040, owner ruling 2026-10-14): quick-add a driver
 *  straight from the trip form's Lái xe selector — the same contract
 *  QuickAddVehicleDialog gives the plate picker (and the dispatch editor's
 *  driver staffing since 20261004_357): register through the REAL catalog
 *  API (POST /drivers, name-first; every other roster field stays owned by
 *  the Danh mục form), then hand the created row back so the form selects
 *  it. Catalog caches invalidate through the shared bootstrap key so the
 *  picker offers the new driver everywhere. */
export function QuickAddDriverDialog({ isOpen, onClose, onCreated }: QuickAddDriverDialogProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isOpen) {
      setName('');
      setPhone('');
      setError(null);
      setSaving(false);
    }
  }, [isOpen]);

  async function apply() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Vui lòng nhập tên tài xế.');
      return;
    }
    if (trimmedName.length > 120) {
      setError('Tên tài xế tối đa 120 ký tự.');
      return;
    }
    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^[0-9+\s.-]{7,15}$/.test(trimmedPhone)) {
      setError('Số điện thoại không hợp lệ.');
      return;
    }
    setSaving(true);
    try {
      const driver = await api.post<{ id: number; name: string }>('/drivers', {
        name: trimmedName,
        ...(trimmedPhone ? { phone: trimmedPhone } : {}),
      });
      await invalidateAllCatalogs(queryClient);
      onCreated(driver.id, driver.name);
    } catch (createError: unknown) {
      setError(createError instanceof Error ? createError.message : 'Không thể thêm tài xế.');
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Thêm nhanh tài xế"
      onClose={onClose}
      onConfirm={saving ? undefined : apply}
      maxWidth={440}
    >
      <div className="quick-add-driver">
        <p className="quick-add-driver__hint">
          Tài xế được lưu vào danh mục (giống đăng ký ở menu Danh mục); các trường lương và giấy tờ bổ sung sau ở Danh mục Tài xế.
        </p>
        {error && <div role="alert" className="quick-add-driver__error">{error}</div>}
        <div className="quick-add-driver__field quick-add-driver__field--action">
          <label htmlFor="quick-add-driver-name">Tên tài xế</label>
          <div className="quick-add-driver__field-row">
            <input
              id="quick-add-driver-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              maxLength={120}
              placeholder="Ví dụ: Nguyễn Văn A"
              autoComplete="off"
              disabled={saving}
              aria-invalid={error ? true : undefined}
            />
            <button type="button" className="btn btn--primary" onClick={() => void apply()} disabled={saving}>
              Áp dụng
            </button>
          </div>
        </div>
        <div className="quick-add-driver__field">
          <label htmlFor="quick-add-driver-phone">Số điện thoại (không bắt buộc)</label>
          <input
            id="quick-add-driver-phone"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setError(null);
            }}
            maxLength={15}
            placeholder="Ví dụ: 0901234567"
            autoComplete="off"
            disabled={saving}
          />
        </div>
      </div>
    </Modal>
  );
}
