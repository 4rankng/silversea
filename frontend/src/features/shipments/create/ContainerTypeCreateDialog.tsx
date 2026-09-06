import { useEffect, useState } from 'react';
import type { ContainerType } from '@tingting/shared';
import { configClient } from '../../../api/configClient';
import { Modal } from '../../../components/UI';
import { UTextAreaField, UTextField } from './uui-fields';

interface ContainerTypeCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Fires after the new container type is persisted. The parent refreshes
   * the catalog and selects the new row into the originating cell.
   */
  onCreated: (containerType: ContainerType) => void;
}

const MAX_CODE = 20;
const MAX_NAME = 50;

/**
 * Inline create dialog for container types (FCL "Loại container" column).
 * Mirrors the pattern used by PortCreateDialog and RouteCreateDialog so
 * CUS / DISPATCHER can extend the catalog from the create-shipment form
 * without bouncing out to `/config/container-types`.
 *
 * Background (Trung Kiên 2026-09-06): "Trường nào cho phép input text được
 * CTO nhớ cho phép nhập text nhé, vẫn còn nhiều chỗ chỉ cho phép chọn
 * dropdown" — the Loại container column was the only catalog dropdown in
 * the form without a "+ Thêm" sibling. This dialog closes that gap.
 */
export function ContainerTypeCreateDialog({ isOpen, onClose, onCreated }: ContainerTypeCreateDialogProps) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCode('');
    setName('');
    setNotes('');
    setError(null);
  }, [isOpen]);

  function close() {
    if (saving) return;
    setError(null);
    onClose();
  }

  async function submit() {
    if (saving) return;
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode) {
      setError('Vui lòng nhập mã loại container (ví dụ: 40HC, 20GP, 45HC).');
      return;
    }
    if (!trimmedName) {
      setError('Vui lòng nhập tên loại container.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await configClient.createContainerType({
        code: trimmedCode,
        name: trimmedName,
        notes: notes.trim() || undefined,
      });
      onCreated(created);
    } catch (submitError) {
      setError(submitError instanceof Error && submitError.message.trim()
        ? submitError.message
        : 'Không thể tạo loại container. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      polished
      title="Thêm loại container"
      onClose={close}
      onConfirm={() => void submit()}
      maxWidth={560}
    >
      <div className="csc-route-dialog">
        {error && <div role="alert" className="csc-route-dialog__error">{error}</div>}
        <div className="csc-route-dialog__grid">
          <UTextField
            label="Mã loại container"
            value={code}
            onChange={(event) => { setCode(event.target.value); setError(null); }}
            maxLength={MAX_CODE}
            placeholder="Ví dụ: 40HC, 20GP, 45HC"
            disabled={saving}
            required
          />
          <UTextField
            label="Tên loại container"
            value={name}
            onChange={(event) => { setName(event.target.value); setError(null); }}
            maxLength={MAX_NAME}
            placeholder="Ví dụ: 40' High Cube, 20' General Purpose"
            disabled={saving}
            required
          />
        </div>
        <UTextAreaField
          label="Ghi chú (không bắt buộc)"
          value={notes}
          onChange={(event) => { setNotes(event.target.value); setError(null); }}
          rows={3}
          maxLength={500}
          disabled={saving}
        />
        <div className="csc-route-dialog__distance-action">
          <button type="button" className="btn btn--primary csc-route-dialog__submit" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Thêm loại container'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
