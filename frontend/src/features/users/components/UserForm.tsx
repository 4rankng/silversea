import { useState, useEffect } from 'react';
import {
  ShieldCheck, Plus, KeyRound, Loader2, Save, User, Eye, EyeOff,
  Mail, Phone, Check, AtSign, Lock, Truck as TruckIcon, Building2, Search, Package,
} from 'lucide-react';
import { Drawer, Btn, FormGroup } from '../../../components/UI';
import { ROLE_LABELS } from '../utils';
import { CustomerAccountType, Role } from '@tingting/shared';
import type { Customer, Truck } from '@tingting/shared';
import type { BusinessUnit, ShipmentScopeOption, UserRow, CreateData, EditData } from '../utils';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';

// ── Icon Input ─────────────────────────────────────────────────────────────

function IconInput({ icon, value, onChange, placeholder, type = 'text', autoComplete, valid, error, rightElement, disabled }: {
  icon: React.ReactNode;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  valid?: boolean;
  error?: boolean;
  rightElement?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={`icon-input${valid ? ' icon-input--valid' : ''}${error ? ' icon-input--error' : ''}`}>
      <span className="icon-input__icon">{icon}</span>
      <input
        className="icon-input__field"
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
      />
      {valid && !rightElement && (
        <span className="icon-input__check"><Check size={14} /></span>
      )}
      {rightElement}
    </div>
  );
}

// ── Driver Fields (shared by Add/Edit panels, shown when role === DRIVER) ───

function DriverFields({ baseSalary, socialInsurance, assignedTruckId, setAssignedTruckId, truckList }: {
  baseSalary: string;
  socialInsurance: string;
  assignedTruckId: number | null;
  setAssignedTruckId: (v: number | null) => void;
  truckList: Truck[];
}) {
  return (
    <>
      <div className="users-form-divider" />
      <div className="users-form-section__title"><TruckIcon size={12} /> Thông tin lái xe</div>
      <div className="users-form-cards users-form-cards--driver">
        <div className="users-form-card">
          <div className="users-customer-scope__help">
            Lương cơ bản và BHXH của lái xe được quản lý ở Cấu hình lái xe để đi qua quy trình kiểm tra và phê duyệt. Trang Người dùng chỉ đổi tài khoản và xe phân công.
          </div>
          {(baseSalary || socialInsurance) && (
            <div className="users-customer-scope__summary">
              {baseSalary ? `Lương hiện tại: ${baseSalary}` : 'Chưa có lương cấu hình'}
              {socialInsurance ? ` · BHXH/BHYT: ${socialInsurance}` : ''}
            </div>
          )}
        </div>
        <div className="users-form-card">
          <FormGroup label="Xe phân công">
            <UuiSelectField
              label="Xe phân công"
              hideLabel
              value={String(assignedTruckId ?? 0)}
              onChange={(e) => setAssignedTruckId(Number(e.target.value) || null)}
              options={[
                { value: '0', label: 'Chưa phân công' },
                ...truckList.filter((t) => t.status === 'ACTIVE').map((t) => ({
                  value: String(t.id),
                  label: t.licensePlate,
                })),
              ]}
            />
          </FormGroup>
        </div>
      </div>
    </>
  );
}

function toggleIdSelection(selectedIds: number[], id: number) {
  return selectedIds.includes(id)
    ? selectedIds.filter((value) => value !== id)
    : [...selectedIds, id];
}

function CustomerScopeFields({
  customerIds,
  setCustomerIds,
  customerList,
  required = true,
  title = 'Phạm vi khách hàng',
  helpText = 'Chọn ít nhất một pháp nhân. Tài khoản tập đoàn hoặc đại lý có thể được liên kết nhiều pháp nhân; dữ liệu vẫn tách riêng theo từng khách hàng.',
  emptyInactiveText = 'Tài khoản đã khóa có thể tạm thời chưa liên kết khách hàng.',
}: {
  customerIds: number[];
  setCustomerIds: (ids: number[]) => void;
  customerList: Customer[];
  required?: boolean;
  title?: string;
  helpText?: string;
  emptyInactiveText?: string;
}) {
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLocaleLowerCase('vi-VN');
  const visibleCustomers = customerList.filter(customer =>
    !normalizedSearch ||
    customer.name.toLocaleLowerCase('vi-VN').includes(normalizedSearch) ||
    (customer.taxCode ?? '').toLocaleLowerCase('vi-VN').includes(normalizedSearch),
  );
  const selectedNames = customerIds
    .map(id => customerList.find(customer => customer.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const toggleCustomer = (customerId: number) => {
    setCustomerIds(toggleIdSelection(customerIds, customerId));
  };

  return (
    <>
      <div className="users-form-divider" />
      <div className="users-form-section__title">
        <Building2 size={12} /> {title}
      </div>
      <div className="users-customer-scope">
        <p className="users-customer-scope__help">
          {helpText}
        </p>
        <label className="users-customer-scope__search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">Tìm khách hàng</span>
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Tìm tên hoặc mã số thuế"
          />
        </label>
        <div className="users-customer-scope__list" role="group" aria-label="Pháp nhân khách hàng được xem">
          {visibleCustomers.length === 0 ? (
            <p className="users-customer-scope__empty">Không tìm thấy khách hàng phù hợp.</p>
          ) : visibleCustomers.map(customer => {
            const checked = customerIds.includes(customer.id);
            return (
              <label key={customer.id} className={`users-customer-scope__option${checked ? ' is-selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCustomer(customer.id)}
                />
                <span>
                  <strong>{customer.name}</strong>
                  {customer.taxCode && <small>MST {customer.taxCode}</small>}
                </span>
              </label>
            );
          })}
        </div>
        <div className={`users-customer-scope__summary${required && customerIds.length === 0 ? ' is-error' : ''}`}>
          {customerIds.length === 0
            ? required
              ? 'Cần chọn ít nhất một khách hàng.'
              : emptyInactiveText
            : `Đã chọn ${customerIds.length}: ${selectedNames.join(', ')}`}
        </div>
      </div>
    </>
  );
}

interface SelectionOption {
  id: number;
  title: string;
  subtitle?: string;
}

function SelectionScopeFields({
  title,
  icon,
  helpText,
  searchPlaceholder,
  ariaLabel,
  options,
  selectedIds,
  setSelectedIds,
  required = false,
  requiredMessage,
  emptyText,
  summaryLabel,
}: {
  title: string;
  icon: React.ReactNode;
  helpText: string;
  searchPlaceholder: string;
  ariaLabel: string;
  options: SelectionOption[];
  selectedIds: number[];
  setSelectedIds: (ids: number[]) => void;
  required?: boolean;
  requiredMessage: string;
  emptyText: string;
  summaryLabel: string;
}) {
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLocaleLowerCase('vi-VN');
  const visibleOptions = options.filter((option) => {
    if (!normalizedSearch) return true;
    const haystack = `${option.title} ${option.subtitle ?? ''}`.toLocaleLowerCase('vi-VN');
    return haystack.includes(normalizedSearch);
  });
  const selectedTitles = selectedIds
    .map((id) => options.find((option) => option.id === id)?.title ?? 'Mục không còn trong danh mục')
    .filter((value, index, array) => array.indexOf(value) === index);

  return (
    <>
      <div className="users-form-divider" />
      <div className="users-form-section__title">
        {icon} {title}
      </div>
      <div className="users-customer-scope">
        <p className="users-customer-scope__help">{helpText}</p>
        <label className="users-customer-scope__search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">{searchPlaceholder}</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
          />
        </label>
        <div className="users-customer-scope__list" role="group" aria-label={ariaLabel}>
          {visibleOptions.length === 0 ? (
            <p className="users-customer-scope__empty">{emptyText}</p>
          ) : visibleOptions.map((option) => {
            const checked = selectedIds.includes(option.id);
            return (
              <label key={option.id} className={`users-customer-scope__option${checked ? ' is-selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => setSelectedIds(toggleIdSelection(selectedIds, option.id))}
                />
                <span>
                  <strong>{option.title}</strong>
                  {option.subtitle && <small>{option.subtitle}</small>}
                </span>
              </label>
            );
          })}
        </div>
        <div className={`users-customer-scope__summary${required && selectedIds.length === 0 ? ' is-error' : ''}`}>
          {selectedIds.length === 0
            ? required
              ? requiredMessage
              : 'Chưa chọn mục nào.'
            : `${summaryLabel} ${selectedIds.length}: ${selectedTitles.join(', ')}`}
        </div>
      </div>
    </>
  );
}

// ── Edit Panel ──────────────────────────────────────────────────────────────

interface EditPanelProps {
  isOpen: boolean;
  user: UserRow;
  isMe: boolean;
  saving: boolean;
  error: string | null;
  truckList: Truck[];
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
  isOpen, user, isMe, saving, error, truckList, customerList, businessUnits, shipmentOptions,
  canManageClerkScope = true,
  canEditDriversOnly, onClose, onSave,
}: EditPanelProps) {
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [username, setUsername] = useState(user.username ?? '');
  const [email, setEmail]       = useState(user.email ?? '');
  const [phone, setPhone]       = useState(user.phone ?? '');
  const [role, setRole]         = useState<Role>(user.role);
  const [status, setStatus]     = useState(user.status);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [baseSalary, setBaseSalary]           = useState(user.baseSalary ?? '');
  const [socialInsurance, setSocialInsurance] = useState(user.socialInsurance ?? '');
  const [assignedTruckId, setAssignedTruckId] = useState<number | null>(user.assignedTruckId ?? null);
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
      setRole(user.role);
      setStatus(user.status);
      setPassword('');
      setShowPw(false);
      setBaseSalary(user.baseSalary ?? '');
      setSocialInsurance(user.socialInsurance ?? '');
      setAssignedTruckId(user.assignedTruckId ?? null);
      setCustomerIds(user.customerIds?.length ? user.customerIds : user.customerId ? [user.customerId] : []);
      setCustomerAccountType(user.customerAccountType ?? CustomerAccountType.SINGLE_ENTITY);
      setBusinessUnitIds(user.businessUnitIds ?? []);
      setShipmentIds(user.shipmentIds ?? []);
    }
  }, [isOpen, user]);

  // Validation
  const nameValid = fullName.trim().length > 0;
  const usernameValid = username.trim().length > 0;
  const emailError = email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phoneError = phone.trim().length > 0 && !/^[\d\s+()-]{8,}$/.test(phone);
  const pwValid = password.length >= 6;
  const pwError = password.length > 0 && !pwValid;
  const customerScopeRequired = role === Role.CUSTOMER && status !== 'INACTIVE';
  const clerkScopeRequired = role === Role.CUS && status !== 'INACTIVE';
  const forwarderScopeRequired = role === Role.OPS && status !== 'INACTIVE';
  const clerkScopeInvalid = clerkScopeRequired && (
    businessUnitIds.length === 0 || (customerIds.length === 0 && shipmentIds.length === 0)
  );
  const forwarderScopeInvalid = forwarderScopeRequired && shipmentIds.length === 0;
  const customerScopeInvalid = customerScopeRequired && (
    customerIds.length === 0
    || (customerAccountType === CustomerAccountType.SINGLE_ENTITY && customerIds.length > 1)
  );
  const businessUnitOptions: SelectionOption[] = businessUnits.map((unit) => ({
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
    canManageClerkScope || candidateRole !== Role.CUS || user.role === Role.CUS,
  );
  const roleSelectDisabled = canEditDriversOnly || (!canManageClerkScope && user.role === Role.CUS);

  const handleSubmit = async () => {
    if (customerScopeInvalid) return;
    if (clerkScopeInvalid) return;
    if (forwarderScopeInvalid) return;
    const payload: EditData = { fullName, username, email, phone, role, status, password };
    if (role === Role.DRIVER) {
      payload.baseSalary = baseSalary;
      payload.socialInsurance = socialInsurance;
      payload.assignedTruckId = assignedTruckId;
      if (canManageClerkScope) payload.businessUnitIds = businessUnitIds;
    }
    if (role === Role.CUSTOMER) {
      payload.customerIds = customerIds;
      payload.customerId = customerIds[0] ?? null;
      if (canManageClerkScope) payload.customerAccountType = customerAccountType;
    }
    if (role === Role.CUS) {
      payload.customerIds = customerIds;
      payload.customerId = customerIds[0] ?? null;
      payload.businessUnitIds = businessUnitIds;
      payload.shipmentIds = shipmentIds;
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
            disabled={saving || customerScopeInvalid || clerkScopeInvalid}
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
          <FormGroup label="Email">
            <IconInput
              icon={<Mail size={14} />}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="nva@cty.vn"
              error={emailError}
              disabled={canEditDriversOnly}
            />
          </FormGroup>
          <FormGroup label="Số điện thoại">
            <IconInput
              icon={<Phone size={14} />}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="0912 345 678"
              error={phoneError}
            />
          </FormGroup>
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
      {role === Role.DRIVER && (
        <>
          <DriverFields
            baseSalary={baseSalary}
            socialInsurance={socialInsurance}
            assignedTruckId={assignedTruckId} setAssignedTruckId={setAssignedTruckId}
            truckList={truckList}
          />
          {!canEditDriversOnly && canManageClerkScope && (
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
        </>
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

      {role === Role.CUS && !canEditDriversOnly && canManageClerkScope && (
        <>
          <SelectionScopeFields
            title="Đơn vị phụ trách"
            icon={<Building2 size={12} />}
            helpText="Chọn ít nhất một đơn vị phụ trách. Nhân viên chứng từ chỉ được thao tác trên lô thuộc các đơn vị này."
            searchPlaceholder="Tìm đơn vị theo tên hoặc mã"
            ariaLabel="Đơn vị phụ trách của nhân viên chứng từ"
            options={businessUnitOptions}
            selectedIds={businessUnitIds}
            setSelectedIds={setBusinessUnitIds}
            required={clerkScopeRequired}
            requiredMessage="Cần chọn ít nhất một đơn vị phụ trách."
            emptyText="Không tìm thấy đơn vị phù hợp."
            summaryLabel="Đã chọn"
          />
          <CustomerScopeFields
            customerIds={customerIds}
            setCustomerIds={setCustomerIds}
            customerList={customerList}
            required={false}
            title="Khách hàng được giao"
            helpText="Chọn các khách hàng mà nhân viên chứng từ được xử lý. Có thể để trống nếu chỉ giao theo từng lô cụ thể."
            emptyInactiveText="Có thể chỉ giao theo lô hàng cụ thể."
          />
          <SelectionScopeFields
            title="Lô hàng chỉ định"
            icon={<Package size={12} />}
            helpText="Giao thêm các lô cụ thể khi cần mở quyền hẹp hơn theo từng hồ sơ. Backend sẽ kiểm tra lô có thuộc đúng đơn vị phụ trách."
            searchPlaceholder="Tìm theo mã lô hoặc khách hàng"
            ariaLabel="Lô hàng chỉ định cho nhân viên chứng từ"
            options={shipmentSelectionOptions}
            selectedIds={shipmentIds}
            setSelectedIds={setShipmentIds}
            required={false}
            requiredMessage="Cần chọn ít nhất một lô hàng."
            emptyText="Không tìm thấy lô hàng phù hợp."
            summaryLabel="Đã chọn"
          />
          {clerkScopeRequired && customerIds.length === 0 && shipmentIds.length === 0 && (
            <div className="users-error-banner">Cần chọn ít nhất một khách hàng hoặc một lô hàng cho nhân viên chứng từ.</div>
          )}
        </>
      )}
      {role === Role.CUS && !canEditDriversOnly && !canManageClerkScope && (
        <div className="users-error-banner">Chỉ quản trị viên mới có thể chỉnh phạm vi nhân viên chứng từ.</div>
      )}

      {/* Password — hidden for accountants (they cannot reset credentials) */}
      {!canEditDriversOnly && (
        <>
          <div className="users-form-divider" />
          <div className="users-form-section__title"><KeyRound size={12} /> Đặt lại mật khẩu</div>
          <FormGroup
            label="Mật khẩu mới (để trống = không thay đổi)"
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
        </>
      )}
    </Drawer>
  );
}

// ── Add Panel ──────────────────────────────────────────────────────────────

interface AddPanelProps {
  isOpen: boolean;
  saving: boolean;
  error: string | null;
  truckList: Truck[];
  customerList: Customer[];
  businessUnits: BusinessUnit[];
  shipmentOptions: ShipmentScopeOption[];
  canManageClerkScope?: boolean;
  onClose: () => void;
  onSave: (data: CreateData) => Promise<boolean | void>;
}

export function AddPanel({
  isOpen, saving, error, truckList, customerList, businessUnits, shipmentOptions, canManageClerkScope = true, onClose, onSave,
}: AddPanelProps) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [role, setRole]         = useState<Role>(Role.DRIVER);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [baseSalary, setBaseSalary]           = useState('');
  const [socialInsurance, setSocialInsurance] = useState('');
  const [assignedTruckId, setAssignedTruckId] = useState<number | null>(null);
  const [customerIds, setCustomerIds] = useState<number[]>([]);
  const [customerAccountType, setCustomerAccountType] = useState<CustomerAccountType>(
    CustomerAccountType.SINGLE_ENTITY,
  );
  const [businessUnitIds, setBusinessUnitIds] = useState<number[]>([]);
  const [shipmentIds, setShipmentIds] = useState<number[]>([]);

  useEffect(() => {
    if (isOpen) {
      setFullName(''); setUsername(''); setEmail('');
      setPhone(''); setRole(Role.DRIVER);
      setPassword(''); setShowPw(false);
      setBaseSalary(''); setSocialInsurance(''); setAssignedTruckId(null);
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
  const phoneError = phone.trim().length > 0 && !/^[\d\s+()-]{8,}$/.test(phone);
  const pwValid = password.length >= 6;
  const pwError = password.length > 0 && !pwValid;
  const clerkScopeInvalid = role === Role.CUS && (
    businessUnitIds.length === 0 || (customerIds.length === 0 && shipmentIds.length === 0)
  );
  const forwarderScopeInvalid = role === Role.OPS && shipmentIds.length === 0;
  const customerScopeInvalid = role === Role.CUSTOMER && (
    customerIds.length === 0
    || (customerAccountType === CustomerAccountType.SINGLE_ENTITY && customerIds.length > 1)
  );
  const businessUnitOptions: SelectionOption[] = businessUnits.map((unit) => ({
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
    if (clerkScopeInvalid) return;
    if (forwarderScopeInvalid) return;
    const payload: CreateData = { fullName, username, email, phone, role, password };
    if (role === Role.DRIVER) {
      payload.baseSalary = baseSalary;
      payload.socialInsurance = socialInsurance;
      payload.assignedTruckId = assignedTruckId;
      if (canManageClerkScope) payload.businessUnitIds = businessUnitIds;
    }
    if (role === Role.CUSTOMER) {
      payload.customerIds = customerIds;
      payload.customerId = customerIds[0] ?? null;
      payload.customerAccountType = customerAccountType;
    }
    if (role === Role.CUS) {
      payload.customerIds = customerIds;
      payload.customerId = customerIds[0] ?? null;
      payload.businessUnitIds = businessUnitIds;
      payload.shipmentIds = shipmentIds;
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
            disabled={saving || customerScopeInvalid || clerkScopeInvalid}
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
          <FormGroup label="Số điện thoại">
            <IconInput
              icon={<Phone size={14} />}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="0912 345 678"
              error={phoneError}
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
      {role === Role.DRIVER && (
        <>
          <DriverFields
            baseSalary={baseSalary}
            socialInsurance={socialInsurance}
            assignedTruckId={assignedTruckId} setAssignedTruckId={setAssignedTruckId}
            truckList={truckList}
          />
          {canManageClerkScope && (
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
        </>
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

      {role === Role.CUS && canManageClerkScope && (
        <>
          <SelectionScopeFields
            title="Đơn vị phụ trách"
            icon={<Building2 size={12} />}
            helpText="Chọn ít nhất một đơn vị phụ trách cho nhân viên chứng từ."
            searchPlaceholder="Tìm đơn vị theo tên hoặc mã"
            ariaLabel="Đơn vị phụ trách của nhân viên chứng từ"
            options={businessUnitOptions}
            selectedIds={businessUnitIds}
            setSelectedIds={setBusinessUnitIds}
            required
            requiredMessage="Cần chọn ít nhất một đơn vị phụ trách."
            emptyText="Không tìm thấy đơn vị phù hợp."
            summaryLabel="Đã chọn"
          />
          <CustomerScopeFields
            customerIds={customerIds}
            setCustomerIds={setCustomerIds}
            customerList={customerList}
            required={false}
            title="Khách hàng được giao"
            helpText="Chọn các khách hàng được giao cho nhân viên chứng từ. Có thể để trống nếu chỉ giao theo lô cụ thể."
            emptyInactiveText="Có thể chỉ giao theo lô hàng cụ thể."
          />
          <SelectionScopeFields
            title="Lô hàng chỉ định"
            icon={<Package size={12} />}
            helpText="Giao thêm các lô cụ thể khi cần mở quyền hẹp theo hồ sơ."
            searchPlaceholder="Tìm theo mã lô hoặc khách hàng"
            ariaLabel="Lô hàng chỉ định cho nhân viên chứng từ"
            options={shipmentSelectionOptions}
            selectedIds={shipmentIds}
            setSelectedIds={setShipmentIds}
            required={false}
            requiredMessage="Cần chọn ít nhất một lô hàng."
            emptyText="Không tìm thấy lô hàng phù hợp."
            summaryLabel="Đã chọn"
          />
          {customerIds.length === 0 && shipmentIds.length === 0 && (
            <div className="users-error-banner">Cần chọn ít nhất một khách hàng hoặc một lô hàng cho nhân viên chứng từ.</div>
          )}
        </>
      )}
      {role === Role.CUS && !canManageClerkScope && (
        <div className="users-error-banner">Chỉ quản trị viên mới có thể tạo hoặc gán phạm vi cho nhân viên chứng từ.</div>
      )}
    </Drawer>
  );
}
