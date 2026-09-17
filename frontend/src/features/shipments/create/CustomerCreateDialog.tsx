import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Customer } from '@tingting/shared';
import { configClient } from '../../../api/configClient';
import { qk } from '../../../api/keys';
import { Modal } from '../../../components/UI';
import { UTextField, UTextAreaField } from './uui-fields';

interface CustomerCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}

export function CustomerCreateDialog({ isOpen, onClose, onCreated }: CustomerCreateDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [taxCode, setTaxCode] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [accountantName, setAccountantName] = useState('');
  const [accountantPhone, setAccountantPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setShortName('');
    setTaxCode('');
    setContactPerson('');
    setPhone('');
    setContactInfo('');
    setAccountantName('');
    setAccountantPhone('');
    setError(null);
  }, [isOpen]);

  function close() {
    if (saving) return;
    setError(null);
    onClose();
  }

  async function submit() {
    // Re-entry guard: the confirm-shortcut fires on every Enter keydown while
    // any input has focus (auto-repeat included), and must not stack a second
    // POST while the first is in flight.
    if (saving) return;
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
        shortName: shortName.trim() || undefined,
        taxCode: taxCode.trim() || undefined,
        contactPerson: contactPerson.trim() || undefined,
        phone: phone.trim() || undefined,
        contactInfo: contactInfo.trim() || undefined,
        accountantName: accountantName.trim() || undefined,
        accountantPhone: accountantPhone.trim() || undefined,
      });
      // The bootstrap catalog blob feeds every carrier/customer dropdown in
      // the app (trip reassign, dispatch editor). A just-created record must
      // be selectable immediately — in-session SPA navigation never fires the
      // window-focus refetch that backs this cache up.
      await queryClient.invalidateQueries({ queryKey: qk.catalogs.all });
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
        <UTextField
          label="Tên ngắn"
          value={shortName}
          onChange={(event) => { setShortName(event.target.value); setError(null); }}
          maxLength={255}
          placeholder="Tên viết tắt dùng trong vận hành (không bắt buộc)"
          disabled={saving}
        />
        <div className="csc-customer-dialog__grid">
          <UTextField
            label="Mã số thuế"
            value={taxCode}
            onChange={(event) => { setTaxCode(event.target.value); setError(null); }}
            maxLength={20}
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
        <div className="csc-customer-dialog__grid">
          <UTextField
            label="Kế toán liên hệ"
            value={accountantName}
            onChange={(event) => { setAccountantName(event.target.value); setError(null); }}
            maxLength={255}
            placeholder="Tên kế toán (không bắt buộc)"
            disabled={saving}
          />
          <UTextField
            label="SĐT kế toán"
            value={accountantPhone}
            onChange={(event) => { setAccountantPhone(event.target.value); setError(null); }}
            maxLength={20}
            placeholder="Không bắt buộc"
            disabled={saving}
          />
        </div>
        <UTextAreaField
          label="Địa chỉ / thông tin liên hệ khác"
          value={contactInfo}
          onChange={(event) => { setContactInfo(event.target.value); setError(null); }}
          rows={2}
          maxLength={2000}
          placeholder="Địa chỉ, email, ghi chú… (không bắt buộc)"
          disabled={saving}
        />
        <button type="button" className="btn btn--primary csc-customer-dialog__submit" onClick={() => void submit()} disabled={saving}>
          {saving ? 'Đang lưu…' : 'Thêm khách hàng'}
        </button>
      </div>
    </Modal>
  );
}
