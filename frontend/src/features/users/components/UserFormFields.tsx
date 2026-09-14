// Shared form-field building blocks for the users add/edit panels.
// Split from UserForm.tsx in the 2026-09-01 structural wave (move-only).
import { useState } from 'react';
import {
  Check, Truck as TruckIcon, Building2, Search,
} from 'lucide-react';
import type { Customer } from '@tingting/shared';
// ── Icon Input ─────────────────────────────────────────────────────────────

export function IconInput({ icon, value, onChange, placeholder, type = 'text', autoComplete, valid, error, rightElement, disabled, inputRef, ariaInvalid, ariaDescribedBy }: {
  icon: React.ReactNode;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  valid?: boolean;
  error?: boolean;
  /** Field-level validation wiring: focus target + a11y association. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
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
        ref={inputRef}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
      />
      {valid && !rightElement && (
        <span className="icon-input__check"><Check size={14} /></span>
      )}
      {rightElement}
    </div>
  );
}

// ── Driver Fields (shared by Add/Edit panels, shown when role === DRIVER) ───

export function DriverFields({ baseSalary, socialInsurance }: {
  baseSalary: string;
  socialInsurance: string;
}) {
  return (
    <>
      <div className="users-form-divider" />
      <div className="users-form-section__title"><TruckIcon size={12} /> Thông tin lái xe</div>
      <div className="users-form-cards users-form-cards--driver">
        <div className="users-form-card">
          <div className="users-customer-scope__help">
            Lương cơ bản và BHXH của lái xe được quản lý ở Cấu hình lái xe để đi qua quy trình kiểm tra và phê duyệt. Trang Người dùng chỉ đổi tài khoản. Phân công xe cho lái xe nằm ở Danh mục Xe nội bộ (Điều vận).
          </div>
          {(baseSalary || socialInsurance) && (
            <div className="users-customer-scope__summary">
              {baseSalary ? `Lương hiện tại: ${baseSalary}` : 'Chưa có lương cấu hình'}
              {socialInsurance ? ` · BHXH/BHYT: ${socialInsurance}` : ''}
            </div>
          )}
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

export function CustomerScopeFields({
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

export interface SelectionOption {
  id: number;
  title: string;
  subtitle?: string;
}

export function SelectionScopeFields({
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
