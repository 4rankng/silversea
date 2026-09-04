import { useState, useEffect } from 'react';
import { Save, X, Loader2, Hash, User, CreditCard, BadgeCheck, Phone, Landmark, Wallet, Banknote } from 'lucide-react';
import { Modal } from '../../components/UI';
import { Input } from '../../components/untitled-ui/base/input/input';
import { EntityFormSection, RequiredHint } from '../../components/shared/EntityFormParts';
import { DateInput } from '../../design-system/forms/DateInput';
import type { Driver } from '@tingting/shared';

export function DriverFormModal({ saving, item, onsave, oncancel, isOpen }: {
  saving: boolean; item?: Driver; onsave: (d: Record<string, unknown>) => void; oncancel: () => void; isOpen: boolean;
}) {
  const [code, setCode] = useState(item?.code || '');
  const [name, setName] = useState(item?.name || '');
  const [idNumber, setIdNumber] = useState(item?.idNumber || '');
  const [licenseNumber, setLicenseNumber] = useState(item?.licenseNumber || '');
  const [licenseExpiryDate, setLicenseExpiryDate] = useState(item?.licenseExpiryDate || '');
  const [phone, setPhone] = useState(item?.phone || '');
  const [bankName, setBankName] = useState(item?.bankName || '');
  const [bankAccount, setBankAccount] = useState(item?.bankAccount || '');
  const [salaryType, setSalaryType] = useState(item?.salaryType || '');
  useEffect(() => {
    if (isOpen) {
      setCode(item?.code || '');
      setName(item?.name || '');
      setIdNumber(item?.idNumber || '');
      setLicenseNumber(item?.licenseNumber || '');
      setLicenseExpiryDate(item?.licenseExpiryDate || '');
      setPhone(item?.phone || '');
      setBankName(item?.bankName || '');
      setBankAccount(item?.bankAccount || '');
      setSalaryType(item?.salaryType || '');
    }
  }, [isOpen, item?.id, item?.code, item?.name, item?.idNumber, item?.licenseNumber, item?.licenseExpiryDate, item?.phone, item?.bankName, item?.bankAccount, item?.salaryType]);
  const handleSave = () => {
    if (!name.trim()) return;
    onsave({
      code: code.trim() || undefined,
      name: name.trim(),
      idNumber: idNumber.trim() || undefined,
      licenseNumber: licenseNumber.trim() || undefined,
      licenseExpiryDate: licenseExpiryDate || null,
      phone: phone.trim() || undefined,
      bankName: bankName.trim() || undefined,
      bankAccount: bankAccount.trim() || undefined,
      salaryType: salaryType.trim() || undefined,
    });
  };
  return (
    <Modal
      isOpen={isOpen}
      title={item ? item.name : 'Thêm lái xe'}
      subtitle={item ? 'Sửa lái xe' : undefined}
      polished
      ariaLabel={item ? `Sửa lái xe ${item.name}` : 'Thêm lái xe'}
      onClose={oncancel}
      onConfirm={handleSave}
      maxWidth={620}
      footer={
        <>
          <RequiredHint />
          <button className="btn btn--secondary btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button className="btn btn--primary btn--sm" disabled={saving || !name.trim()} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm lái xe'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <EntityFormSection icon={User} label="Thông tin lái xe">
          <Input
            label="Mã tài xế"
            icon={Hash}
            value={code}
            onChange={setCode}
            placeholder="Ví dụ: TX001"
            inputClassName="tabular-nums"
          />
          <Input
            label="Họ và tên"
            isRequired
            icon={User}
            value={name}
            onChange={setName}
            placeholder="Ví dụ: Nguyễn Văn A"
            autoFocus
          />
          <Input
            label="Số CCCD"
            icon={CreditCard}
            value={idNumber}
            onChange={setIdNumber}
            placeholder="Số CCCD"
            inputClassName="tabular-nums"
          />
          <Input
            label="GPLX"
            icon={BadgeCheck}
            value={licenseNumber}
            onChange={setLicenseNumber}
            placeholder="GPLX"
            inputClassName="tabular-nums"
          />
          <div className="field">
            <label htmlFor="driver-licenseExpiryDate">Hạn bằng lái</label>
            <DateInput
              id="driver-licenseExpiryDate"
              className="input"
              value={licenseExpiryDate}
              onChange={setLicenseExpiryDate}
            />
          </div>
          <Input
            label="Số điện thoại"
            icon={Phone}
            value={phone}
            onChange={setPhone}
            placeholder="0912..."
            inputClassName="tabular-nums"
          />
        </EntityFormSection>
        <EntityFormSection icon={Landmark} label="Tài khoản nhận lương">
          <Input
            label="Ngân hàng nhận tiền"
            icon={Landmark}
            value={bankName}
            onChange={setBankName}
            placeholder="Ngân hàng"
          />
          <Input
            label="Số TK nhận tiền"
            icon={Wallet}
            value={bankAccount}
            onChange={setBankAccount}
            placeholder="Số tài khoản"
            inputClassName="tabular-nums"
          />
          <Input
            label="Hình thức lương"
            icon={Banknote}
            value={salaryType}
            onChange={setSalaryType}
            placeholder="Ví dụ: LUONG CUNG"
          />
        </EntityFormSection>
      </div>
    </Modal>
  );
}
