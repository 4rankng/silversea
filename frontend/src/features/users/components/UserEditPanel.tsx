// Edit panel — update an existing user account.
// Split from UserForm.tsx in the 2026-09-01 structural wave (move-only).
import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck, KeyRound, Loader2, Save, User, Eye, EyeOff,
  Mail, AtSign, Lock, Building2, Package, Hash, Link2, Unlink,
} from 'lucide-react';
import { isValidOptionalEmail } from '../../../lib/optional-email';
import { Drawer, Btn, FormGroup } from '../../../components/UI';
import { ROLE_LABELS } from '../utils';
import { CustomerAccountType, Role } from '@tingting/shared';
import type { Customer, Driver } from '@tingting/shared';
import type { BusinessUnit, ShipmentScopeOption, UserRow, EditData } from '../utils';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
import { useTrucksAndDrivers } from '../../../hooks/useCatalogQueries';
import { qk } from '../../../api/keys';
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
  /** QA 28/11 F-E — the driver↔account link verbs (ADMIN-only server-side;
   *  undefined keeps the control read-only). */
  onLinkDriver?: (userId: number, driver: { id: number; updatedAt: string }) => Promise<boolean>;
  onUnlinkDriver?: (driver: { id: number; updatedAt: string }) => Promise<boolean>;
  onClose: () => void;
  onSave: (id: number, data: EditData) => Promise<boolean | void>;
}

export function EditPanel({
  isOpen, user, isMe, saving, error, customerList, businessUnits, shipmentOptions,
  canManageClerkScope = true,
  onLinkDriver, onUnlinkDriver,
 onClose, onSave,
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
  // No phone state (SIL-823): the form renders no phone field, so there is
  // nothing to hold — drivers.phone stays untouched on save.
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
  const roleSelectDisabled = !canManageClerkScope && user.role === Role.CUS;

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
    // Partial update (SIL-823): only fields the form displays. The form has no
    // phone field, so `phone` must never ride the payload — a `''` echo cleared
    // the driver's phone in the drivers table (Bùi Tiến Dũng, 2026-11-14).
    const payload: EditData = { fullName, username, email: email.trim(), employeeCode, role, status, password };
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
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: 'ACTIVE', label: 'Hoạt động' },
              { value: 'INACTIVE', label: 'Bị khoá' },
            ]}
          />
        </FormGroup>
      </div>

      {/* Driver profile fields (only for DRIVER role) */}
      {role === Role.DRIVER && canManageClerkScope && (
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

      {/* QA 28/11 F-E — the linked fleet profile + link/unlink control. The
          error message for unissued orders points HERE ("vào Quản trị người
          dùng"): without this link the driver's app account never receives
          phát lệnh, and batch issue refuses the row. The admin child mounts
          ONLY with wired mutations (all react-query state lives inside it, so
          non-admin/non-driver panels never touch the catalog query). */}
      {role === Role.DRIVER && (
        canManageClerkScope && onLinkDriver && onUnlinkDriver ? (
          <DriverLinkSection
            user={user}
            saving={saving}
            onLinkDriver={onLinkDriver}
            onUnlinkDriver={onUnlinkDriver}
          />
        ) : (
          <>
            <div className="users-form-divider" />
            <div className="users-form-section__title"><Link2 size={12} /> Hồ sơ tài xế</div>
            {user.driverId != null ? (
              <div className="users-driver-link">
                <div className="users-driver-link__info">
                  <strong>{user.driverName ?? `Hồ sơ tài xế #${user.driverId}`}</strong>
                  <span className="users-driver-link__meta">
                    {user.driverStatus === 'INACTIVE' ? 'Hồ sơ ngừng hoạt động' : 'Đang liên kết — tài khoản nhận lệnh qua hồ sơ này'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="users-driver-link__hint">Chưa liên kết hồ sơ tài xế.</p>
            )}
          </>
        )
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
            required={customerScopeRequired}
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
        <div className="users-error-banner">Chỉ quản trị viên mới có thể chỉnh phạm vi khách hàng của kế toán.</div>
      )}

      {role === Role.OPS && canManageClerkScope && (
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
      {role === Role.OPS && !canManageClerkScope && (
        <div className="users-error-banner">Chỉ quản trị viên mới có thể chỉnh lô hàng của nhân viên giao nhận.</div>
      )}

      {/* Password — hidden for accountants (they cannot reset credentials) */}
      {(
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

/**
 * QA 28/11 F-E — the admin-only driver↔account link control. All react-query
 * state lives HERE (never in EditPanel): the section mounts only for DRIVER
 * accounts with wired mutations, so panels that don't need the Drivers
 * catalog (and provider-less tests of the rest of the form) never touch it.
 *
 * Read: the linked profile (drivers.userId ← users.id via listUsers' LEFT
 * JOIN). Write: [Liên kết hồ sơ] sets drivers.userId on the picked catalog
 * row (the fleet record carrying the account's Mã NV pre-selects itself —
 * QAPAY1128-style rows link with one look); a Mã NV with NO matching unlinked
 * profile SAYS SO (no silent success); [Hủy liên kết] clears the link. Both
 * ride the config binding endpoints (ADMIN-only, version-gated).
 */
function DriverLinkSection({
  user,
  saving,
  onLinkDriver,
  onUnlinkDriver,
}: {
  user: UserRow;
  saving: boolean;
  onLinkDriver: (userId: number, driver: { id: number; updatedAt: string }) => Promise<boolean>;
  onUnlinkDriver: (driver: { id: number; updatedAt: string }) => Promise<boolean>;
}) {
  // The linked-driver read mirrors local state so a link/unlink renders
  // immediately (the page's `user` prop stays the row snapshot the table
  // opened with; the refetch updates the table, not this prop).
  const [linkedDriver, setLinkedDriver] = useState<{ id: number; name: string | null; status: string | null } | null>(
    user.driverId != null ? { id: user.driverId, name: user.driverName ?? null, status: user.driverStatus ?? null } : null,
  );
  useEffect(() => {
    setLinkedDriver(user.driverId != null ? { id: user.driverId, name: user.driverName ?? null, status: user.driverStatus ?? null } : null);
    setPickedDriverId('');
  }, [user.driverId, user.driverName, user.driverStatus]);
  const [pickedDriverId, setPickedDriverId] = useState('');
  const queryClient = useQueryClient();
  // Candidate profiles: the Drivers catalog. The combined trucks+drivers
  // cache is already warm on /users (the table's Xe column reads it).
  const { data: trucksDriversData, refetch: refetchCandidates } = useTrucksAndDrivers({ enabled: true });
  const driverCandidates: Driver[] = (trucksDriversData?.drivers ?? []).filter(
    (driver) => driver.userId == null && driver.status === 'ACTIVE' && driver.deletedAt == null,
  );
  // The fleet record carrying the account's Mã NV pre-selects itself.
  const employeeCodeMatch = driverCandidates.find(
    (driver) => driver.code != null && driver.code.trim() !== '' && driver.code.trim() === user.employeeCode?.trim(),
  ) ?? null;

  const handleLinkDriver = async () => {
    const picked = driverCandidates.find((driver) => String(driver.id) === pickedDriverId)
      ?? employeeCodeMatch
      ?? null;
    if (picked == null) return;
    const ok = await onLinkDriver(user.id, { id: picked.id, updatedAt: picked.updatedAt });
    if (ok) {
      setLinkedDriver({ id: picked.id, name: picked.name, status: picked.status });
      setPickedDriverId('');
      // Drop the now-linked profile from the candidate list.
      void queryClient.invalidateQueries({ queryKey: qk.catalogs.trucksDrivers });
    }
  };

  const handleUnlinkDriver = async () => {
    if (linkedDriver == null) return;
    // The version token comes from the catalog row; without it the unlink
    // can't prove freshness — surface that instead of guessing a token the
    // server would 409.
    const candidate = trucksDriversData?.drivers.find((driver) => driver.id === linkedDriver.id);
    if (!candidate) return;
    const ok = await onUnlinkDriver({ id: linkedDriver.id, updatedAt: candidate.updatedAt });
    if (ok) {
      setLinkedDriver(null);
      void queryClient.invalidateQueries({ queryKey: qk.catalogs.trucksDrivers });
      void refetchCandidates();
    }
  };

  return (
    <>
      <div className="users-form-divider" />
      <div className="users-form-section__title"><Link2 size={12} /> Hồ sơ tài xế</div>
      {linkedDriver ? (
        <div className="users-driver-link">
          <div className="users-driver-link__info">
            <strong>{linkedDriver.name ?? `Hồ sơ tài xế #${linkedDriver.id}`}</strong>
            <span className="users-driver-link__meta">
              {linkedDriver.status === 'INACTIVE' ? 'Hồ sơ ngừng hoạt động' : 'Đang liên kết — tài khoản nhận lệnh qua hồ sơ này'}
            </span>
          </div>
          <Btn
            variant="secondary"
            icon={saving ? <Loader2 size={13} className="spin" /> : <Unlink size={13} />}
            disabled={saving}
            onClick={() => void handleUnlinkDriver()}
          >
            Hủy liên kết
          </Btn>
        </div>
      ) : (
        <div className="users-driver-link users-driver-link--pending">
          <p className="users-driver-link__hint">
            Chưa liên kết hồ sơ tài xế — lệnh phát cho tài xế này sẽ không vào hộp thư của lái xe.
          </p>
          {user.employeeCode?.trim() && employeeCodeMatch == null && (
            <p className="users-driver-link__miss" role="alert">
              {`Không tìm thấy hồ sơ tài xế nào có mã NV "${user.employeeCode.trim()}" trong Danh mục Tài xế — hãy chọn thủ công bên dưới.`}
            </p>
          )}
          {driverCandidates.length > 0 ? (
            <div className="users-driver-link__controls">
              <FormGroup label="Hồ sơ tài xế chưa liên kết">
                <UuiSelectField
                  label="Hồ sơ tài xế chưa liên kết"
                  value={pickedDriverId || (employeeCodeMatch ? String(employeeCodeMatch.id) : '')}
                  onChange={(e) => setPickedDriverId(e.target.value)}
                  options={[
                    { value: '', label: '— Chọn hồ sơ tài xế —' },
                    ...driverCandidates.map((driver) => ({
                      value: String(driver.id),
                      label: [driver.name, driver.code ? `Mã ${driver.code}` : null].filter(Boolean).join(' · '),
                    })),
                  ]}
                />
              </FormGroup>
              <Btn
                variant="primary"
                icon={saving ? <Loader2 size={13} className="spin" /> : <Link2 size={13} />}
                disabled={saving || (pickedDriverId === '' && employeeCodeMatch == null)}
                onClick={() => void handleLinkDriver()}
              >
                Liên kết hồ sơ
              </Btn>
            </div>
          ) : (
            <p className="users-driver-link__hint">
              {user.employeeCode?.trim()
                ? 'Không có hồ sơ tài xế chưa liên kết nào khớp mã NV này — kiểm tra Danh mục Tài xế.'
                : 'Không có hồ sơ tài xế chưa liên kết nào trong Danh mục Tài xế.'}
            </p>
          )}
        </div>
      )}
    </>
  );
}

// ── Add Panel ──────────────────────────────────────────────────────────────
