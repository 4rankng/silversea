import { useEffect, useState } from 'react';
import type { Port } from '@tingting/shared';
import { configClient } from '../../../api/configClient';
import { Modal } from '../../../components/UI';
import { UTextField } from './uui-fields';

interface PortCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (port: Port) => void;
  /** Typed text carried in from the combobox create option. */
  initialName?: string;
}

export function PortCreateDialog({ isOpen, onClose, onCreated, initialName }: PortCreateDialogProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(initialName ?? '');
    setCode('');
    setAddress('');
    setError(null);
  }, [isOpen, initialName]);

  function close() {
    if (saving) return;
    setError(null);
    onClose();
  }

  async function submit() {
    if (saving) return;
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError('Vui lòng nhập tên cảng / bãi.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const port = await configClient.createPort({
        name: normalizedName,
        code: code.trim() || undefined,
        address: address.trim() || undefined,
      });
      onCreated(port);
    } catch (submitError) {
      setError(submitError instanceof Error && submitError.message.trim()
        ? submitError.message
        : 'Không thể tạo cảng / bãi. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      polished
      title="Thêm cảng / bãi"
      onClose={close}
      onConfirm={() => void submit()}
      maxWidth={560}
    >
      <div className="csc-route-dialog">
        {error && <div role="alert" className="csc-route-dialog__error">{error}</div>}
        <UTextField
          label="Tên cảng / bãi"
          value={name}
          onChange={(event) => { setName(event.target.value); setError(null); }}
          maxLength={255}
          placeholder="Ví dụ: Cảng Tân Vũ"
          disabled={saving}
        />
        <div className="csc-route-dialog__grid">
          <UTextField
            label="Mã (không bắt buộc)"
            value={code}
            onChange={(event) => { setCode(event.target.value); setError(null); }}
            maxLength={20}
            disabled={saving}
          />
          <UTextField
            label="Địa chỉ (không bắt buộc)"
            value={address}
            onChange={(event) => { setAddress(event.target.value); setError(null); }}
            maxLength={255}
            disabled={saving}
          />
        </div>
        <div className="csc-route-dialog__distance-action">
          <button type="button" className="btn btn--primary csc-route-dialog__submit" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Thêm cảng / bãi'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
