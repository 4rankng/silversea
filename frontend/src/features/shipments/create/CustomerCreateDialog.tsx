import { useEffect, useState } from 'react';
import type { Customer } from '@tingting/shared';
import { configClient } from '../../../api/configClient';
import { Modal } from '../../../components/UI';
import { UTextField } from './uui-fields';

interface CustomerCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}

export function CustomerCreateDialog({ isOpen, onClose, onCreated }: CustomerCreateDialogProps) {
  const [name, setName] = useState('');
  const [taxCode, setTaxCode] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setTaxCode('');
    setContactPerson('');
    setPhone('');
    setError(null);
  }, [isOpen]);

  function close() {
    if (saving) return;
    setError(null);
    onClose();
  }

  async function submit() {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError('Vui lòng nhập tên khách hàng.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const customer = await configClient.createCustomer({
        name: normalizedName,
        taxCode: taxCode.trim() || undefined,
        contactPerson: contactPerson.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      onCreated(customer);
    } catch (submitError) {
      setError(submitError instanceof Error && submitError.message.trim()
        ? submitError.message
        : 'Không thể tạo khách hàng. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Thêm khách hàng"
      onClose={close}
      onConfirm={() => void submit()}
      maxWidth={560}
    >
      <div className="csc-customer-dialog">
        <p>Khách hàng mới sẽ được thêm vào danh mục và chọn ngay cho lô hàng này. Thông tin công nợ chi tiết có thể bổ sung sau trong trang quản trị khách hàng.</p>
        {error && <div role="alert" className="csc-customer-dialog__error">{error}</div>}
        <UTextField
          label="Tên khách hàng"
          value={name}
          onChange={(event) => { setName(event.target.value); setError(null); }}
          maxLength={255}
          placeholder="Tên đầy đủ của khách hàng"
          disabled={saving}
        />
        <div className="csc-customer-dialog__grid">
          <UTextField
            label="Mã số thuế"
            value={taxCode}
            onChange={(event) => { setTaxCode(event.target.value); setError(null); }}
            maxLength={50}
            placeholder="Không bắt buộc"
            disabled={saving}
          />
          <UTextField
            label="Số điện thoại"
            value={phone}
            onChange={(event) => { setPhone(event.target.value); setError(null); }}
            maxLength={30}
            placeholder="Không bắt buộc"
            disabled={saving}
          />
        </div>
        <UTextField
          label="Người liên hệ"
          value={contactPerson}
          onChange={(event) => { setContactPerson(event.target.value); setError(null); }}
          maxLength={120}
          placeholder="Không bắt buộc"
          disabled={saving}
        />
        <button type="button" className="btn btn--primary csc-customer-dialog__submit" onClick={() => void submit()} disabled={saving}>
          {saving ? 'Đang lưu…' : 'Thêm khách hàng'}
        </button>
      </div>
    </Modal>
  );
}
