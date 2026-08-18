import { useEffect, useState } from 'react';
import type { Route } from '@tingting/shared';
import { configClient } from '../../../api/configClient';
import { Modal } from '../../../components/UI';
import { UTextField } from './uui-fields';

interface RouteCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (route: Route) => void;
}

export function RouteCreateDialog({ isOpen, onClose, onCreated }: RouteCreateDialogProps) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setShortName('');
    setDistanceKm('');
    setError(null);
  }, [isOpen]);

  function close() {
    if (saving) return;
    setError(null);
    onClose();
  }

  async function submit() {
    const normalizedName = name.trim();
    const normalizedShortName = shortName.trim();
    if (!normalizedName) {
      setError('Vui lòng nhập tên đầy đủ của tuyến đường.');
      return;
    }
    if (!normalizedShortName) {
      setError('Vui lòng nhập tên ngắn của tuyến đường.');
      return;
    }
    const normalizedDistance = distanceKm.trim() ? Number(distanceKm) : undefined;
    if (normalizedDistance !== undefined && (!Number.isInteger(normalizedDistance) || normalizedDistance < 1)) {
      setError('Khoảng cách phải là số nguyên lớn hơn 0.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const route = await configClient.createRoute({
        name: normalizedName,
        shortName: normalizedShortName,
        distanceKm: normalizedDistance,
        isMountain: false,
      });
      onCreated(route);
    } catch (submitError) {
      setError(submitError instanceof Error && submitError.message.trim()
        ? submitError.message
        : 'Không thể tạo tuyến đường. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Thêm tuyến đường"
      onClose={close}
      onConfirm={() => void submit()}
      maxWidth={560}
      footer={(
        <>
          <button type="button" className="btn btn--ghost" onClick={close} disabled={saving}>Hủy</button>
          <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Thêm tuyến đường'}
          </button>
        </>
      )}
    >
      <div className="csc-route-dialog">
        <p>Tuyến mới sẽ được thêm vào danh mục và chọn ngay cho lô hàng này.</p>
        {error && <div role="alert" className="csc-route-dialog__error">{error}</div>}
        <div className="csc-route-dialog__grid">
          <UTextField
            label="Tên đầy đủ"
            value={name}
            onChange={(event) => { setName(event.target.value); setError(null); }}
            maxLength={255}
            placeholder="VD: Cảng Cát Lái — KCN Sóng Thần"
            disabled={saving}
          />
          <UTextField
            label="Tên ngắn"
            value={shortName}
            onChange={(event) => { setShortName(event.target.value); setError(null); }}
            maxLength={255}
            placeholder="VD: Cát Lái — Sóng Thần"
            disabled={saving}
          />
        </div>
        <UTextField
          label="Khoảng cách (km)"
          type="number"
          min="1"
          step="1"
          value={distanceKm}
          onChange={(event) => { setDistanceKm(event.target.value); setError(null); }}
          placeholder="Có thể bổ sung sau"
          disabled={saving}
        />
      </div>
    </Modal>
  );
}
