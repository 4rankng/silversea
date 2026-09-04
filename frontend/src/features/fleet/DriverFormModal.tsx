import { useState, useEffect } from 'react';
import { Save, X, Loader2 } from 'lucide-react';
import { Modal } from '../../components/UI';
import type { Driver } from '@tingting/shared';
// Own stylesheet: this modal also renders on /fleet/drivers (dispatch
// catalogs), whose route chunk never loads the /fleet page cards that
// normally pull FleetPage.css in.
import '../../pages/FleetPage.css';

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
      title={item ? `Sửa lái xe ${item.name}` : 'Thêm lái xe'}
      onClose={oncancel}
      onConfirm={handleSave}
      maxWidth={620}
      footer={
        <div className="fleet-form-actions">
          <button className="btn btn--secondary btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button className="btn btn--primary btn--sm" disabled={saving || !name.trim()} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm lái xe'}
          </button>
        </div>
      }
    >
      <div className="fleet-form">
        <div className="fleet-form__grid fleet-form__grid--driver">
          <div className="field fleet-form__field fleet-form__field--wide">
            <label htmlFor="driver-code">
              Mã tài xế <span>*</span>
            </label>
            <input
              id="driver-code"
              className="input"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Ví dụ: TX001"
            />
          </div>
          <div className="field fleet-form__field fleet-form__field--wide">
            <label htmlFor="driver-name">
              Họ và tên <span>*</span>
            </label>
            <input
              id="driver-name"
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ví dụ: Nguyễn Văn A"
              autoFocus
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="driver-idNumber">Số CCCD</label>
            <input
              id="driver-idNumber"
              className="input"
              value={idNumber}
              onChange={e => setIdNumber(e.target.value)}
              placeholder="Số CCCD"
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="driver-licenseNumber">GPLX</label>
            <input
              id="driver-licenseNumber"
              className="input"
              value={licenseNumber}
              onChange={e => setLicenseNumber(e.target.value)}
              placeholder="GPLX"
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="driver-licenseExpiryDate">Hạn bằng lái</label>
            <input
              id="driver-licenseExpiryDate"
              className="input"
              type="date"
              value={licenseExpiryDate}
              onChange={e => setLicenseExpiryDate(e.target.value)}
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="driver-phone">Số điện thoại</label>
            <input
              id="driver-phone"
              className="input"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="0912..."
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="driver-bankName">Ngân hàng nhận tiền</label>
            <input
              id="driver-bankName"
              className="input"
              value={bankName}
              onChange={e => setBankName(e.target.value)}
              placeholder="Ngân hàng"
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="driver-bankAccount">Số TK nhận tiền</label>
            <input
              id="driver-bankAccount"
              className="input"
              value={bankAccount}
              onChange={e => setBankAccount(e.target.value)}
              placeholder="Số tài khoản"
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="driver-salaryType">Hình thức lương</label>
            <input
              id="driver-salaryType"
              className="input"
              value={salaryType}
              onChange={e => setSalaryType(e.target.value)}
              placeholder="Ví dụ: LUONG CUNG"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
