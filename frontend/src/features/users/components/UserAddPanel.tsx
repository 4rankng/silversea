// Add panel — create a new user account.
// Split from UserForm.tsx in the 2026-09-01 structural wave (move-only).
import { useState, useEffect } from 'react';
import {
  ShieldCheck, Plus, Loader2, User, Eye, EyeOff,
  Mail, AtSign, Lock, Building2, Package, Hash,
} from 'lucide-react';
import { Drawer, Btn, FormGroup } from '../../../components/UI';
import { ROLE_LABELS } from '../utils';
import { CustomerAccountType, Role } from '@tingting/shared';
import type { Customer } from '@tingting/shared';
import type { BusinessUnit, ShipmentScopeOption, CreateData } from '../utils';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
import { IconInput, CustomerScopeFields, SelectionScopeFields, type SelectionOption } from './UserFormFields';
interface AddPanelProps {
  isOpen: boolean;
  saving: boolean;
  error: string | null;
  customerList: Customer[];
  businessUnits: BusinessUnit[];
  shipmentOptions: ShipmentScopeOption[];
  canManageClerkScope?: boolean;
  onClose: () => void;
  onSave: (data: CreateData) => Promise<boolean | void>;
}

export function AddPanel({
  isOpen, saving, error, customerList, businessUnits, shipmentOptions, canManageClerkScope = true, onClose, onSave,
}: AddPanelProps) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [role, setRole]         = useState<Role>(Role.DRIVER);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [customerIds, setCustomerIds] = useState<number[]>([]);
  const [customerAccountType, setCustomerAccountType] = useState<CustomerAccountType>(
    CustomerAccountType.SINGLE_ENTITY,
  );
  const [businessUnitIds, setBusinessUnitIds] = useState<number[]>([]);
  const [shipmentIds, setShipmentIds] = useState<number[]>([]);

  useEffect(() => {
    if (isOpen) {
      setFullName(''); setUsername(''); setEmail('');
      setPhone(''); setEmployeeCode('');
      setRole(Role.DRIVER);
      setPassword(''); setShowPw(false);
      setCustomerIds([]);
      setCustomerAccountType(CustomerAccountType.SINGLE_ENTITY);
      setBusinessUnitIds([]);
      setShipmentIds([]);
    }
  }, [isOpen]);

  // Validation
  const nameValid = fullName.trim().length > 0;
  const usernameValid = username.trim().length > 0;
  const emailError = email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const pwValid = password.length >= 6;
  const pwError = password.length > 0 && !pwValid;
  const forwarderScopeInvalid = role === Role.OPS && shipmentIds.length === 0;
  const customerScopeInvalid = role === Role.CUSTOMER && (
    customerIds.length === 0
    || (customerAccountType === CustomerAccountType.SINGLE_ENTITY && customerIds.length > 1)
  );
  // New assignments only offer ACTIVE units — a deactivated unit must drop
  // out of fresh selections while existing links (edit panel) stay visible.
  const businessUnitOptions: SelectionOption[] = businessUnits
    .filter((unit) => unit.status === 'ACTIVE')
    .map((unit) => ({
      id: unit.id,
      title: unit.name,
      subtitle: unit.code ? `Mã ${unit.code}` : undefined,
    }));
  const shipmentSelectionOptions: SelectionOption[] = shipmentOptions.map((shipment) => ({
    id: shipment.id,
    title: shipment.shipmentCode ?? 'Lô hàng chưa có mã',
    subtitle: shipment.customerName
      ? `${shipment.customerName} · ${shipment.status}`
      : `Khách hàng chưa có tên · ${shipment.status}`,
  }));
  const roleOptions = Object.values(Role).filter((candidateRole) =>
    canManageClerkScope || candidateRole !== Role.CUS,
  );

  const handleSubmit = async () => {
    if (customerScopeInvalid) return;
    if (forwarderScopeInvalid) return;
    const payload: CreateData = { fullName, username, email, phone, employeeCode, role, password };
    if (role === Role.DRIVER) {
      if (canManageClerkScope) payload.businessUnitIds = businessUnitIds;
    }
    if (role === Role.CUSTOMER) {
      payload.customerIds = customerIds;
      payload.customerId = customerIds[0] ?? null;
      payload.customerAccountType = customerAccountType;
    }
    if (role === Role.OPS && canManageClerkScope) {
      payload.shipmentIds = shipmentIds;
    }
    if (role === Role.ACCOUNTANT && canManageClerkScope) {
      payload.customerIds = customerIds;
      payload.customerId = customerIds[0] ?? null;
    }
    const ok = await onSave(payload);
    if (ok) onClose();
  };

  const title = role === Role.DRIVER ? 'Thêm lái xe' : 'Tạo tài khoản mới';

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={role === Role.DRIVER ? 'Tài khoản đăng nhập + hồ sơ lái xe' : 'Điền thông tin bên dưới'}
      onConfirm={handleSubmit}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Hủy</Btn>
          <Btn
            variant="primary"
            icon={saving ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
            disabled={saving || customerScopeInvalid}
            onClick={handleSubmit}
          >
            {role === Role.DRIVER ? 'Thêm lái xe' : 'Tạo tài khoản'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="users-error-banner">{error}</div>
      )}

      {/* Personal info */}
      <div className="users-form-section__title"><User size={12} /> Thông tin cá nhân</div>
      <div className="users-form-cards">
        <div className="users-form-card">
          <FormGroup label="Họ và tên">
            <IconInput
              icon={<User size={14} />}
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Nguyễn Văn A"
              valid={nameValid}
            />
          </FormGroup>
          <FormGroup label="Username">
            <IconInput
              icon={<AtSign size={14} />}
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="nguyen.van.a"
              autoComplete="off"
              valid={usernameValid}
            />
          </FormGroup>
        </div>
        <div className="users-form-card">
          <FormGroup label="Mã nhân viên">
            <IconInput
              icon={<Hash size={14} />}
              value={employeeCode}
              onChange={e => setEmployeeCode(e.target.value)}
              placeholder="Ví dụ: NV001"
            />
          </FormGroup>
          <FormGroup label="Email">
            <IconInput
              icon={<Mail size={14} />}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="nva@cty.vn"
              error={emailError}
            />
          </FormGroup>
        </div>
      </div>

      <div className="users-form-divider" />

      {/* Role & Password */}
      <div className="users-form-section__title"><ShieldCheck size={12} /> Quyền & Mật khẩu</div>
      <div className="row-2">
        <FormGroup label="Vai trò">
          <UuiSelectField
            label="Vai trò"
            hideLabel
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            options={roleOptions.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          />
        </FormGroup>
        <FormGroup
          label="Mật khẩu *"
          error={pwError ? 'Mật khẩu phải có tối thiểu 6 ký tự' : undefined}
        >
          <IconInput
            icon={<Lock size={14} />}
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Tối thiểu 6 ký tự"
            autoComplete="new-password"
            valid={pwValid}
            error={pwError}
            rightElement={
              <button
                type="button"
                aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                onClick={() => setShowPw(v => !v)}
                className="pw-toggle"
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            }
          />
        </FormGroup>
      </div>

      {/* Driver profile fields (only for DRIVER role) */}
      {role === Role.DRIVER && canManageClerkScope && (
        <SelectionScopeFields
          title="Đơn vị tính lương"
          icon={<Building2 size={12} />}
          helpText="Gán đơn vị cho lái xe để chốt lương theo phạm vi đơn vị ở Cài đặt ứng dụng. Có thể bỏ trống nếu lái xe vẫn thuộc phạm vi lương toàn công ty."
          searchPlaceholder="Tìm đơn vị theo tên hoặc mã"
          ariaLabel="Đơn vị tính lương của lái xe"
          options={businessUnitOptions}
          selectedIds={businessUnitIds}
          setSelectedIds={setBusinessUnitIds}
          required={false}
          requiredMessage="Cần chọn ít nhất một đơn vị tính lương."
          emptyText="Không tìm thấy đơn vị phù hợp."
          summaryLabel="Đã chọn"
        />
      )}

      {role === Role.CUSTOMER && (
        <>
          {canManageClerkScope && (
            <FormGroup label="Loại phạm vi cổng khách hàng">
              <UuiSelectField
                label="Loại phạm vi cổng khách hàng"
                hideLabel
                value={customerAccountType}
                onChange={(event) => setCustomerAccountType(event.target.value as CustomerAccountType)}
                options={[
                  { value: CustomerAccountType.SINGLE_ENTITY, label: 'Một pháp nhân' },
                  { value: CustomerAccountType.CORPORATE_GROUP, label: 'Nhóm công ty' },
                  { value: CustomerAccountType.AGENCY, label: 'Đại lý' },
                ]}
              />
            </FormGroup>
          )}
          <CustomerScopeFields
            customerIds={customerIds}
            setCustomerIds={setCustomerIds}
            customerList={customerList}
          />
          {customerAccountType === CustomerAccountType.SINGLE_ENTITY && customerIds.length > 1 && (
            <div className="users-error-banner">Tài khoản một pháp nhân chỉ được chọn một khách hàng.</div>
          )}
        </>
      )}

      {role === Role.ACCOUNTANT && canManageClerkScope && (
        <CustomerScopeFields
          customerIds={customerIds}
          setCustomerIds={setCustomerIds}
          customerList={customerList}
          required={false}
          title="Phạm vi khách hàng của kế toán"
          helpText="Nếu để trống, kế toán có phạm vi tài chính toàn công ty. Khi chọn khách hàng, nhật ký công nợ và thanh toán theo khách hàng chỉ hiển thị trong phạm vi này."
          emptyInactiveText="Để trống để giữ phạm vi tài chính toàn công ty."
        />
      )}
      {role === Role.ACCOUNTANT && !canManageClerkScope && (
        <div className="users-error-banner">Chỉ quản trị viên mới có thể gán phạm vi khách hàng cho kế toán.</div>
      )}

      {role === Role.OPS && canManageClerkScope && (
        <SelectionScopeFields
          title="Lô hàng được giao"
          icon={<Package size={12} />}
          helpText="Chọn ít nhất một lô hàng. Nhân viên giao nhận chỉ được mở và cập nhật các chuyến thuộc phạm vi này."
          searchPlaceholder="Tìm theo mã lô hoặc khách hàng"
          ariaLabel="Lô hàng được giao cho nhân viên giao nhận"
          options={shipmentSelectionOptions}
          selectedIds={shipmentIds}
          setSelectedIds={setShipmentIds}
          required
          requiredMessage="Cần chọn ít nhất một lô hàng cho nhân viên giao nhận."
          emptyText="Không tìm thấy lô hàng phù hợp."
          summaryLabel="Đã chọn"
        />
      )}
      {role === Role.OPS && !canManageClerkScope && (
        <div className="users-error-banner">Chỉ quản trị viên mới có thể gán lô hàng cho nhân viên giao nhận.</div>
      )}

    </Drawer>
  );
}
