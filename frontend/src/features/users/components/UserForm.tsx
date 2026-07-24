import { useState, useEffect } from 'react';
import {
  ShieldCheck, Plus, KeyRound, Loader2, Save, User, Eye, EyeOff,
  Mail, Phone, Check, AtSign, Lock, Truck as TruckIcon,
} from 'lucide-react';
import { Drawer, Btn, FormGroup } from '../../../components/UI';
import { ROLE_LABELS } from '../utils';
import { Role } from '@tingting/shared';
import type { Truck } from '@tingting/shared';
import type { UserRow, CreateData, EditData } from '../utils';

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

function DriverFields({ baseSalary, setBaseSalary, socialInsurance, setSocialInsurance, assignedTruckId, setAssignedTruckId, truckList }: {
  baseSalary: string;
  setBaseSalary: (v: string) => void;
  socialInsurance: string;
  setSocialInsurance: (v: string) => void;
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
          <FormGroup label="Lương cơ bản (đ)">
            <input
              className="input"
              type="number"
              min={0}
              value={baseSalary}
              onChange={e => setBaseSalary(e.target.value)}
              placeholder="0"
            />
          </FormGroup>
          <FormGroup label="BHXH / BHYT (đ)">
            <input
              className="input"
              type="number"
              min={0}
              value={socialInsurance}
              onChange={e => setSocialInsurance(e.target.value)}
              placeholder="0"
            />
          </FormGroup>
        </div>
        <div className="users-form-card">
          <FormGroup label="Xe phân công">
            <select
              className="input"
              value={assignedTruckId ?? 0}
              onChange={e => setAssignedTruckId(Number(e.target.value) || null)}
            >
              <option value={0}>Chưa phân công</option>
              {truckList.filter(t => t.status === 'ACTIVE').map(t => (
                <option key={t.id} value={t.id}>{t.licensePlate}</option>
              ))}
            </select>
          </FormGroup>
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
  /** Accountant scope: lock role/credentials, only driver + contact fields editable. */
  canEditDriversOnly?: boolean;
  onClose: () => void;
  onSave: (id: number, data: EditData) => Promise<boolean | void>;
}

export function EditPanel({ isOpen, user, isMe, saving, error, truckList, canEditDriversOnly, onClose, onSave }: EditPanelProps) {
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
    }
  }, [isOpen, user]);

  // Validation
  const nameValid = fullName.trim().length > 0;
  const usernameValid = username.trim().length > 0;
  const emailError = email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phoneError = phone.trim().length > 0 && !/^[\d\s+()-]{8,}$/.test(phone);
  const pwValid = password.length >= 6;
  const pwError = password.length > 0 && !pwValid;

  const handleSubmit = async () => {
    const payload: EditData = { fullName, username, email, phone, role, status, password };
    if (role === Role.DRIVER) {
      payload.baseSalary = baseSalary;
      payload.socialInsurance = socialInsurance;
      payload.assignedTruckId = assignedTruckId;
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
          <Btn variant="ghost" onClick={onClose}>Hủy</Btn>
          <Btn
            variant="primary"
            icon={saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
            disabled={saving}
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
          <select className="input" value={role} disabled={canEditDriversOnly} onChange={e => setRole(e.target.value as Role)}>
            {Object.values(Role).map(r => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </FormGroup>
        <FormGroup label="Trạng thái">
          <select className="input" value={status} disabled={canEditDriversOnly} onChange={e => setStatus(e.target.value)}>
            <option value="ACTIVE">Hoạt động</option>
            <option value="INACTIVE">Bị khoá</option>
          </select>
        </FormGroup>
      </div>

      {/* Driver profile fields (only for DRIVER role) */}
      {role === Role.DRIVER && (
        <DriverFields
          baseSalary={baseSalary} setBaseSalary={setBaseSalary}
          socialInsurance={socialInsurance} setSocialInsurance={setSocialInsurance}
          assignedTruckId={assignedTruckId} setAssignedTruckId={setAssignedTruckId}
          truckList={truckList}
        />
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
  onClose: () => void;
  onSave: (data: CreateData) => Promise<boolean | void>;
}

export function AddPanel({ isOpen, saving, error, truckList, onClose, onSave }: AddPanelProps) {
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

  useEffect(() => {
    if (isOpen) {
      setFullName(''); setUsername(''); setEmail('');
      setPhone(''); setRole(Role.DRIVER);
      setPassword(''); setShowPw(false);
      setBaseSalary(''); setSocialInsurance(''); setAssignedTruckId(null);
    }
  }, [isOpen]);

  // Validation
  const nameValid = fullName.trim().length > 0;
  const usernameValid = username.trim().length > 0;
  const emailError = email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phoneError = phone.trim().length > 0 && !/^[\d\s+()-]{8,}$/.test(phone);
  const pwValid = password.length >= 6;
  const pwError = password.length > 0 && !pwValid;

  const handleSubmit = async () => {
    const payload: CreateData = { fullName, username, email, phone, role, password };
    if (role === Role.DRIVER) {
      payload.baseSalary = baseSalary;
      payload.socialInsurance = socialInsurance;
      payload.assignedTruckId = assignedTruckId;
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
          <Btn variant="ghost" onClick={onClose}>Hủy</Btn>
          <Btn
            variant="primary"
            icon={saving ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
            disabled={saving}
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
          <select className="input" value={role} onChange={e => setRole(e.target.value as Role)}>
            {Object.values(Role).map(r => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
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
        <DriverFields
          baseSalary={baseSalary} setBaseSalary={setBaseSalary}
          socialInsurance={socialInsurance} setSocialInsurance={setSocialInsurance}
          assignedTruckId={assignedTruckId} setAssignedTruckId={setAssignedTruckId}
          truckList={truckList}
        />
      )}
    </Drawer>
  );
}
