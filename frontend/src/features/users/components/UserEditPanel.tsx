// Edit panel — update an existing user account.
// Split from UserForm.tsx in the 2026-09-01 structural wave (move-only).
import { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck, KeyRound, Loader2, Save, User, Eye, EyeOff,
  Mail, AtSign, Lock, Building2, Package, Hash,
} from 'lucide-react';
import { isValidOptionalEmail } from '../../../lib/optional-email';
import { Drawer, Btn, FormGroup } from '../../../components/UI';
import { ROLE_LABELS } from '../utils';
import { CustomerAccountType, Role } from '@tingting/shared';
import type { Customer } from '@tingting/shared';
import type { BusinessUnit, ShipmentScopeOption, UserRow, EditData } from '../utils';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
import { IconInput, CustomerScopeFields, SelectionScopeFields, type SelectionOption } from './UserFormFields';
interface EditPanelProps {
  isOpen: boolean;
  user: UserRow;
  isMe: boolean;
  saving: boolean;
  error: string | null;
  customerList: Customer[];
  businessUnits: BusinessUnit[];
  shipmentOptions: ShipmentScopeOption[];
  canManageClerkScope?: boolean;
  /** Accountant scope: lock role/credentials, only driver + contact fields editable. */
  canEditDriversOnly?: boolean;
  onClose: () => void;
  onSave: (id: number, data: EditData) => Promise<boolean | void>;
}

export function EditPanel({
  isOpen, user, isMe, saving, error, customerList, businessUnits, shipmentOptions,
  canManageClerkScope = true,
  canEditDriversOnly, onClose, onSave,
}: EditPanelProps) {
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [username, setUsername] = useState(user.username ?? '');
  const [email, setEmail]       = useState(user.email ?? '');
  // Field-level Vietnamese validation messages — the raw server zod text
  // ("email: Invalid email") never renders; first invalid field is focused.
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const pwInputRef = useRef<HTMLInputElement | null>(null);
  const [phone, setPhone]       = useState(user.phone ?? '');
  const [employeeCode, setEmployeeCode] = useState(user.employeeCode ?? '');
  const [role, setRole]         = useState<Role>(user.role);
  const [status, setStatus]     = useState(user.status);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [customerIds, setCustomerIds] = useState<number[]>(
    user.customerIds?.length ? user.customerIds : user.customerId ? [user.customerId] : [],
  );
  const [customerAccountType, setCustomerAccountType] = useState<CustomerAccountType>(
    user.customerAccountType ?? CustomerAccountType.SINGLE_ENTITY,
  );
  const [businessUnitIds, setBusinessUnitIds] = useState<number[]>(user.businessUnitIds ?? []);
  const [shipmentIds, setShipmentIds] = useState<number[]>(user.shipmentIds ?? []);

  useEffect(() => {
    if (isOpen) {
      setFullName(user.fullName ?? '');
      setUsername(user.username ?? '');
      setEmail(user.email ?? '');
      setPhone(user.phone ?? '');
      setEmployeeCode(user.employeeCode ?? '');
      setRole(user.role);
      setStatus(user.status);
      setPassword('');
      setShowPw(false);
      setCustomerIds(user.customerIds?.length ? user.customerIds : user.customerId ? [user.customerId] : []);
      setCustomerAccountType(user.customerAccountType ?? CustomerAccountType.SINGLE_ENTITY);
      setBusinessUnitIds(user.businessUnitIds ?? []);
      setShipmentIds(user.shipmentIds ?? []);
    }
  }, [isOpen, user]);

  // Validation
  const nameValid = fullName.trim().length > 0;
  const usernameValid = username.trim().length > 0;
  const emailError = !isValidOptionalEmail(email);
  const pwValid = password.length >= 6;
  const pwError = password.length > 0 && !pwValid;
  const customerScopeRequired = role === Role.CUSTOMER && status !== 'INACTIVE';
  const forwarderScopeRequired = role === Role.OPS && status !== 'INACTIVE';
  const forwarderScopeInvalid = forwarderScopeRequired && shipmentIds.length === 0;
  const customerScopeInvalid = customerScopeRequired && (
    customerIds.length === 0
    || (customerAccountType === CustomerAccountType.SINGLE_ENTITY && customerIds.length > 1)
  );
  // ACTIVE units for new picks, plus the user's already-assigned units even
  // when deactivated — removing an existing link must be a deliberate act,
  // never a side effect of the filter.
  const businessUnitOptions: SelectionOption[] = businessUnits
    .filter((unit) => unit.status === 'ACTIVE' || user.businessUnitIds?.includes(unit.id))
    .map((unit) => ({
      id: unit.id,
      title: unit.name,
      subtitle: [
        unit.code ? `Mã ${unit.code}` : null,
        unit.status === 'INACTIVE' ? 'Ngừng sử dụng' : null,
      ].filter(Boolean).join(' · ') || undefined,
    }));
  const shipmentSelectionOptions: SelectionOption[] = shipmentOptions.map((shipment) => ({
    id: shipment.id,
    title: shipment.shipmentCode ?? 'Lô hàng chưa có mã',
    subtitle: shipment.customerName
      ? `${shipment.customerName} · ${shipment.status}`
      : `Khách hàng chưa có tên · ${shipment.status}`,
  }));
  const roleOptions = Object.values(Role).filter((candidateRole) =>
    canManageClerkScope || candidateRole !== Role.CUS || user.role === Role.CUS,
  );
  const roleSelectDisabled = canEditDriversOnly || (!canManageClerkScope && user.role === Role.CUS);

  const handleSubmit = async () => {
    // Field validation with visible labels first — invalid email/password
    // never reaches the server, so no English schema banner can appear.
    const nextEmailMsg = !isValidOptionalEmail(email)
      ? 'Email chưa đúng định dạng (ví dụ nva@cty.vn)' : null;
    const nextPwMsg = password.length > 0 && password.length < 6
      ? 'Mật khẩu mới phải có tối thiểu 6 ký tự' : null;
    setEmailMsg(nextEmailMsg);
    setPwMsg(nextPwMsg);
    if (nextEmailMsg != null) { emailInputRef.current?.focus(); return; }
    if (nextPwMsg != null) { pwInputRef.current?.focus(); return; }
    if (customerScopeInvalid) return;
    if (forwarderScopeInvalid) return;
    const payload: EditData = { fullName, username, email: email.trim(), phone, employeeCode, role, status, password };
    if (role === Role.DRIVER) {
      if (canManageClerkScope) payload.businessUnitIds = businessUnitIds;
    }
    if (role === Role.CUSTOMER) {
      payload.customerIds = customerIds;
      payload.customerId = customerIds[0] ?? null;
      if (canManageClerkScope) payload.customerAccountType = customerAccountType;
    }
    if (role === Role.OPS && canManageClerkScope) {
      payload.shipmentIds = shipmentIds;
    }
    if (role === Role.ACCOUNTANT && canManageClerkScope) {
      payload.customerIds = customerIds;
      payload.customerId = customerIds[0] ?? null;
    }
    const ok = await onSave(user.id, payload);
    if (ok) onClose();
  };

  const displayName = user.fullName || user.username || user.email || 'Tài khoản';
  const subtitle = isMe ? `${displayName} (bạn)` : displayName;
  const title = role === Role.DRIVER ? `Chỉnh sửa lái xe ${displayName}` : 'Chỉnh sửa tài khoản';

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      onConfirm={handleSubmit}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Hủy</Btn>
          <Btn
            variant="primary"
            icon={saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
            disabled={saving || customerScopeInvalid}
            onClick={handleSubmit}
          >
            Lưu thay đổi
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
              disabled={canEditDriversOnly}
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
              onChange={e => { setEmail(e.target.value); if (emailMsg) setEmailMsg(null); }}
              placeholder="nva@cty.vn"
              error={emailError || emailMsg != null}
              disabled={canEditDriversOnly}
              inputRef={emailInputRef}
              ariaInvalid={emailMsg != null}
              ariaDescribedBy={emailMsg != null ? 'user-email-error' : undefined}
            />
          </FormGroup>
          {emailMsg && (
            <p id="user-email-error" role="alert" style={{ color: 'var(--err, #dc2626)', margin: '4px 0 0', fontSize: 'var(--text-caption-size)' }}>
              {emailMsg}
            </p>
          )}
        </div>
      </div>

      <div className="users-form-divider" />

      {/* Role & status */}
      <div className="users-form-section__title"><ShieldCheck size={12} /> Quyền & trạng thái</div>
      <div className="row-2">
        <FormGroup label="Vai trò">
          <UuiSelectField
            label="Vai trò"
            hideLabel
            value={role}
            disabled={roleSelectDisabled}
            onChange={(e) => setRole(e.target.value as Role)}
            options={roleOptions.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          />
        </FormGroup>
        <FormGroup label="Trạng thái">
          <UuiSelectField
            label="Trạng thái"
            hideLabel
            value={status}
            disabled={canEditDriversOnly}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: 'ACTIVE', label: 'Hoạt động' },
              { value: 'INACTIVE', label: 'Bị khoá' },
            ]}
          />
        </FormGroup>
      </div>

      {/* Driver profile fields (only for DRIVER role) */}
      {role === Role.DRIVER && !canEditDriversOnly && canManageClerkScope && (
        <SelectionScopeFields
          title="Đơn vị tính lương"
          icon={<Building2 size={12} />}
          helpText="Gán các đơn vị mà lái xe thuộc về để chốt lương theo đơn vị được cấu hình ở Cài đặt ứng dụng. Có thể để trống nếu lái xe vẫn thuộc phạm vi lương toàn công ty."
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

      {role === Role.CUSTOMER && !canEditDriversOnly && (
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
            required={customerScopeRequired}
          />
          {customerAccountType === CustomerAccountType.SINGLE_ENTITY && customerIds.length > 1 && (
            <div className="users-error-banner">Tài khoản một pháp nhân chỉ được chọn một khách hàng.</div>
          )}
        </>
      )}

      {role === Role.ACCOUNTANT && !canEditDriversOnly && canManageClerkScope && (
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
      {role === Role.ACCOUNTANT && !canEditDriversOnly && !canManageClerkScope && (
        <div className="users-error-banner">Chỉ quản trị viên mới có thể chỉnh phạm vi khách hàng của kế toán.</div>
      )}

      {role === Role.OPS && !canEditDriversOnly && canManageClerkScope && (
        <SelectionScopeFields
          title="Lô hàng được giao"
          icon={<Package size={12} />}
          helpText="Nhân viên giao nhận chỉ xem và cập nhật các chuyến thuộc những lô hàng được giao tại đây."
          searchPlaceholder="Tìm theo mã lô hoặc khách hàng"
          ariaLabel="Lô hàng được giao cho nhân viên giao nhận"
          options={shipmentSelectionOptions}
          selectedIds={shipmentIds}
          setSelectedIds={setShipmentIds}
          required={forwarderScopeRequired}
          requiredMessage="Cần chọn ít nhất một lô hàng cho nhân viên giao nhận."
          emptyText="Không tìm thấy lô hàng phù hợp."
          summaryLabel="Đã chọn"
        />
      )}
      {role === Role.OPS && !canEditDriversOnly && !canManageClerkScope && (
        <div className="users-error-banner">Chỉ quản trị viên mới có thể chỉnh lô hàng của nhân viên giao nhận.</div>
      )}

      {/* Password — hidden for accountants (they cannot reset credentials) */}
      {!canEditDriversOnly && (
        <>
          <div className="users-form-divider" />
          <div className="users-form-section__title"><KeyRound size={12} /> Đặt lại mật khẩu</div>
          <FormGroup
            label="Mật khẩu mới (để trống = không thay đổi)"
          >
            <IconInput
              icon={<Lock size={14} />}
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); if (pwMsg) setPwMsg(null); }}
              placeholder="Tối thiểu 6 ký tự"
              autoComplete="new-password"
              valid={pwValid}
              error={pwError || pwMsg != null}
              inputRef={pwInputRef}
              ariaInvalid={pwMsg != null}
              ariaDescribedBy={pwMsg != null ? 'user-pw-error' : undefined}
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
          {pwMsg && (
            <p id="user-pw-error" role="alert" style={{ color: 'var(--err, #dc2626)', margin: '4px 0 0', fontSize: 'var(--text-caption-size)' }}>
              {pwMsg}
            </p>
          )}
        </>
      )}
    </Drawer>
  );
}

// ── Add Panel ──────────────────────────────────────────────────────────────
