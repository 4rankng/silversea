import {
  Users, ShieldCheck, UserCog, Lock, Plus, Pencil, Trash2,
  Loader2, KeyRound, Mail, Phone, Search, UserX, MoreVertical, X,
  ArrowUpDown, ArrowUp, ArrowDown, Building2,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { formatDate } from '../../../lib/format';
import { Role, ROLE_LABELS, ROLE_PILL, FilterKey } from '../utils';
import type { UserRow } from '../utils';
import { StatusStrip, StatusSwatch } from '../../../components/shared/StatusStrip';
import { resolveEmptyIllustration } from '../../../lib/emptyIllustrations';
import { PageHeader } from '../../../components/UI';
import { AssetIcon } from '../../../components/AssetIcon';

interface UserTableProps {
  users: UserRow[];
  filtered: UserRow[];
  paginated: UserRow[];
  total: number;
  staffCount: number;
  driverCount: number;
  inactiveCount: number;
  filter: FilterKey;
  search: string;
  canManage: boolean;
  canDelete?: boolean;
  /** Accountant scope: may open the edit Drawer for DRIVER rows only. */
  canEditDriversOnly?: boolean;
  /** truckId → licensePlate, for the "Xe" column on driver rows. */
  truckMap?: Map<number, string>;
  customerMap?: Map<number, string>;
  businessUnitMap?: Map<number, string>;
  deleting: number | null;
  currentUserId?: number;
  onFilterChange: (f: FilterKey) => void;
  onSearchChange: (s: string) => void;
  onEdit: (u: UserRow) => void;
  onDelete: (id: number) => void;
  onAdd: () => void;
  // Sort props
  sortBy: 'name' | 'role' | 'status' | 'date' | null;
  sortOrder: 'asc' | 'desc';
  onSort: (field: 'name' | 'role' | 'status' | 'date') => void;
  // Pagination props
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

const AVATAR_CLS: Record<Role, string> = {
  [Role.ADMIN]: 'user-avatar--admin',
  [Role.MANAGER]: 'user-avatar--manager',
  [Role.ACCOUNTANT]: 'user-avatar--accountant',
  [Role.DRIVER]: 'user-avatar--driver',
  [Role.OPS]: 'user-avatar--forwarder',
  [Role.CUSTOMER]: 'user-avatar--forwarder',
  [Role.CUS]: 'user-avatar--accountant',
  [Role.DISPATCHER]: 'user-avatar--manager',
};

const AVATAR_ICON: Record<Role, typeof Users> = {
  [Role.ADMIN]: ShieldCheck,
  [Role.MANAGER]: UserCog,
  [Role.ACCOUNTANT]: KeyRound,
  [Role.DRIVER]: Users,
  [Role.OPS]: UserCog,
  [Role.CUSTOMER]: Users,
  [Role.CUS]: UserCog,
  [Role.DISPATCHER]: UserCog,
};

const ROLE_FILTER_CLS: Record<string, string> = {
  [Role.ADMIN]: 'filter-pill--admin',
  [Role.MANAGER]: 'filter-pill--manager',
  [Role.ACCOUNTANT]: 'filter-pill--accountant',
  [Role.DRIVER]: 'filter-pill--driver',
  [Role.OPS]: 'filter-pill--forwarder',
  [Role.CUSTOMER]: 'filter-pill--forwarder',
  [Role.CUS]: 'filter-pill--accountant',
  [Role.DISPATCHER]: 'filter-pill--manager',
};

function RoleAvatar({ role }: { role: Role }) {
  const Icon = AVATAR_ICON[role] || Users;
  return (
    <div className={`user-avatar ${AVATAR_CLS[role]}`}>
      <Icon size={18} aria-hidden="true" />
    </div>
  );
}

/** Can the current user edit this row? Full managers can; scoped accountants can only edit drivers. */
function canEditRow(u: UserRow, canManage: boolean, canEditDriversOnly: boolean) {
  return canManage || (canEditDriversOnly && u.role === Role.DRIVER);
}

/** Resolve the assigned truck's license plate for a driver row, if any. */
function getPlate(u: UserRow, truckMap?: Map<number, string>) {
  return u.role === Role.DRIVER && u.assignedTruckId != null ? truckMap?.get(u.assignedTruckId) : undefined;
}

function getCustomerScopeLabel(u: UserRow, customerMap?: Map<number, string>) {
  if (u.role !== Role.CUSTOMER && u.role !== Role.ACCOUNTANT) return undefined;
  const ids = u.customerIds?.length ? u.customerIds : u.customerId ? [u.customerId] : [];
  if (ids.length === 0) {
    return u.role === Role.ACCOUNTANT ? 'Phạm vi tài chính toàn công ty' : 'Chưa liên kết khách hàng';
  }
  const names = ids.map(id => customerMap?.get(id) ?? 'Khách hàng không còn trong danh mục');
  return u.role === Role.ACCOUNTANT ? `Phạm vi kế toán: ${names.join(', ')}` : names.join(', ');
}

function getClerkScopeLabel(
  u: UserRow,
  customerMap?: Map<number, string>,
  businessUnitMap?: Map<number, string>,
) {
  if (u.role !== Role.CUS) return undefined;
  const parts: string[] = [];
  const unitIds = u.businessUnitIds ?? [];
  if (unitIds.length > 0) {
    const unitNames = unitIds.map((id) => businessUnitMap?.get(id) ?? 'Đơn vị không còn trong danh mục');
    parts.push(`Đơn vị: ${unitNames.join(', ')}`);
  }
  const customerIds = u.customerIds?.length ? u.customerIds : u.customerId ? [u.customerId] : [];
  if (customerIds.length > 0) {
    const names = customerIds.map((id) => customerMap?.get(id) ?? 'Khách hàng không còn trong danh mục');
    parts.push(`Khách hàng: ${names.join(', ')}`);
  }
  if ((u.shipmentIds?.length ?? 0) > 0) {
    parts.push(`Lô chỉ định: ${u.shipmentIds!.length}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Chưa gán phạm vi';
}

export function UserTable({
  users, filtered, paginated, total, staffCount, driverCount, inactiveCount,
  filter, search, canManage, canDelete = canManage, canEditDriversOnly = false,
  truckMap, deleting, currentUserId,
  customerMap, businessUnitMap,
  onFilterChange, onSearchChange, onEdit, onDelete, onAdd,
  sortBy, sortOrder, onSort,
  currentPage, pageSize, onPageChange,
}: UserTableProps) {
  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <PageHeader
        title={<>Quản lý <em>người dùng</em></>}
        iconName="users-hr"
        description={`${total} tài khoản · ${staffCount} nhân sự · ${driverCount} lái xe`}
        action={
          canManage ? (
            <button
              className="btn btn--primary"
              onClick={onAdd}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <Plus size={14} /> Thêm tài khoản
            </button>
          ) : null
        }
      />

      {/* ── KPI grid ────────────────────────────────────────────────────── */}
      <div className="kpi-grid users-kpi-grid">
        <div className="kpi">
          <div className="kpi__top">
            <span className="kpi__label">Tổng tài khoản</span>
          </div>
          <div className="kpi__value">{total}</div>
          <div className="kpi__meta">
            <span className="kpi__meta-pill kpi__meta--up">
              +0 mới
            </span>
            <span className="kpi__meta-note">Đang hoạt động tốt</span>
          </div>
          <div className="kpi__watermark" aria-hidden="true"><Users size={72} /></div>
        </div>
        <div className="kpi kpi--warn">
          <div className="kpi__top">
            <span className="kpi__label">Nhân sự văn phòng</span>
          </div>
          <div className="kpi__value">{staffCount}</div>
          <div className="kpi__meta">
            <span className="kpi__meta-pill kpi__meta-pill--warn">
              Văn phòng
            </span>
            <span className="kpi__meta-note">Admin · Quản lý · Kế toán</span>
          </div>
          <div className="kpi__watermark" aria-hidden="true"><UserCog size={72} /></div>
        </div>
        <div className="kpi kpi--success">
          <div className="kpi__top">
            <span className="kpi__label">Lái xe</span>
          </div>
          <div className="kpi__value">{driverCount}</div>
          <div className="kpi__meta">
            <span className="kpi__meta-pill kpi__meta-pill--success">
              Hiện trường
            </span>
            <span className="kpi__meta-note">Có quyền app lái xe</span>
          </div>
          <div className="kpi__watermark" aria-hidden="true"><AssetIcon name="driver" size={72} /></div>
        </div>
        <div className="kpi kpi--danger">
          <div className="kpi__top">
            <span className="kpi__label">Bị khoá / Ngưng</span>
          </div>
          <div className="kpi__value">{inactiveCount}</div>
          <div className="kpi__meta">
            {inactiveCount > 0 ? (
              <span className="kpi__meta-pill kpi__meta-pill--danger">
                Cần kiểm tra
              </span>
            ) : (
              <span className="kpi__meta-pill kpi__meta-pill--neutral">
                An toàn
              </span>
            )}
            <span className="kpi__meta-note">Không thể truy cập</span>
          </div>
          <div className="kpi__watermark" aria-hidden="true"><Lock size={72} /></div>
        </div>
      </div>

      {/* ── Unified panel: toolbar + table + footer ─────────────────────── */}
      <div className="users-table-panel" data-tour-id="users-table">
        {/* Filter toolbar */}
        <div
          className="toolbar users-role-toolbar"
          data-tour-id="users-role-filters"
          role="group"
          aria-label="Lọc tài khoản theo vai trò"
        >
          {(['all', ...Object.values(Role)] as FilterKey[]).map(f => {
            const count = f === 'all' ? total : users.filter(u => u.role === f).length;
            const label = f === 'all' ? 'Tất cả' : ROLE_LABELS[f as Role];
            return (
              <button
                key={f}
                className={`filter-pill${filter === f ? ' is-active' : ''} ${ROLE_FILTER_CLS[f] || ''}`}
                onClick={() => onFilterChange(f)}
                aria-pressed={filter === f}
              >
                <span>{label}</span>
                {filter === f && <span className="filter-pill__count">{count}</span>}
              </button>
            );
          })}
          <div className="toolbar__spacer" />
          <div className="toolbar__search" style={{ position: 'relative' }}>
            <Search size={14} />
            <input
              type="text"
              aria-label="Tìm tài khoản"
              placeholder="Tìm theo username, email, SĐT..."
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              style={{ paddingRight: search ? '28px' : '10px' }}
            />
            {search && (
              <button
                className="search-clear-btn"
                onClick={() => onSearchChange('')}
                title="Xóa tìm kiếm"
                aria-label="Xóa nội dung tìm kiếm"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Legend */}
        {(canManage || canEditDriversOnly) && (
          <div className="users-list-legend">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Pencil size={12} style={{ opacity: 0.5 }} />
              Nhấp vào hàng để chỉnh sửa
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <StatusSwatch status="ACTIVE" />
              Hoạt động
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <StatusSwatch status="LOCKED" />
              Bị khoá
            </span>
          </div>
        )}

        {/* Desktop table */}
        <DesktopTable
          filtered={paginated}
          canManage={canManage}
          canDelete={canDelete}
          canEditDriversOnly={canEditDriversOnly}
          truckMap={truckMap}
          customerMap={customerMap}
          businessUnitMap={businessUnitMap}
          deleting={deleting}
          currentUserId={currentUserId}
          onEdit={onEdit}
          onDelete={onDelete}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={onSort}
        />

        {/* Mobile cards */}
        <MobileCardList
          filtered={paginated}
          canManage={canManage}
          canDelete={canDelete}
          canEditDriversOnly={canEditDriversOnly}
          truckMap={truckMap}
          customerMap={customerMap}
          businessUnitMap={businessUnitMap}
          deleting={deleting}
          currentUserId={currentUserId}
          onEdit={onEdit}
          onDelete={onDelete}
        />

        {/* Footer */}
        {(() => {
          const totalPages = Math.ceil(filtered.length / pageSize);
          const startIdx = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
          const endIdx = Math.min(filtered.length, currentPage * pageSize);
          return (
            <div className="table-foot users-table-foot">
              <span className="users-table-foot__summary">
                Hiển thị <strong style={{ fontFamily: 'var(--font-mono)' }}>{startIdx}-{endIdx}</strong> trong số <strong style={{ fontFamily: 'var(--font-mono)' }}>{filtered.length}</strong> tài khoản
              </span>
              {totalPages > 1 && (
                <div className="users-pagination" aria-label="Phân trang tài khoản">
                  <button
                    className="btn-page users-pagination__nav"
                    disabled={currentPage === 1}
                    onClick={() => onPageChange(currentPage - 1)}
                    style={{
                      minHeight: 44, padding: '8px 12px', border: '1px solid var(--line-2)', borderRadius: 9,
                      background: currentPage === 1 ? 'var(--surface-2)' : '#fff',
                      cursor: currentPage === 1 ? 'not-allowed' : 'pointer', fontSize: 12,
                      color: currentPage === 1 ? 'var(--ink-4)' : 'var(--ink-2)'
                    }}
                  >
                    Trước
                  </button>
                  {Array.from({ length: totalPages }).map((_, idx) => {
                    const page = idx + 1;
                    return (
                      <button
                        key={page}
                        className={`btn-page users-pagination__page${currentPage === page ? ' is-active' : ''}`}
                        onClick={() => onPageChange(page)}
                        style={{
                          minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: 9, border: currentPage === page ? '1px solid var(--brand)' : '1px solid var(--line-2)',
                          background: currentPage === page ? 'var(--brand)' : '#fff',
                          color: currentPage === page ? '#fff' : 'var(--ink)',
                          fontWeight: currentPage === page ? '600' : 'normal',
                          cursor: 'pointer', fontSize: 12
                        }}
                      >
                        {page}
                      </button>
                    );
                  })}
                  <button
                    className="btn-page users-pagination__nav"
                    disabled={currentPage === totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                    style={{
                      minHeight: 44, padding: '8px 12px', border: '1px solid var(--line-2)', borderRadius: 9,
                      background: currentPage === totalPages ? 'var(--surface-2)' : '#fff',
                      cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', fontSize: 12,
                      color: currentPage === totalPages ? 'var(--ink-4)' : 'var(--ink-2)'
                    }}
                  >
                    Sau
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Permission notice */}
      {!canManage && (
        <div style={{
          marginTop: 20, padding: '12px 16px',
          background: 'var(--surface-2)', borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 10,
          color: 'var(--ink-3)', fontSize: 12.5,
        }}>
          <KeyRound size={14} />
          {canEditDriversOnly
            ? 'Bạn chỉ có thể chỉnh sửa thông tin lái xe (lương, xe phân công, liên hệ).'
            : 'Chỉ quản trị viên hoặc giám đốc mới có thể tạo, sửa hoặc xóa tài khoản.'}
        </div>
      )}
    </>
  );
}

/* ── Desktop table (inside panel) ─────────────────────────────────────────── */

function DesktopTable({
  filtered, canManage, canDelete: _canDelete, canEditDriversOnly, truckMap, deleting: _deleting, currentUserId,
  customerMap, businessUnitMap,
  onEdit, onDelete: _onDelete,
  sortBy, sortOrder, onSort,
}: {
  filtered: UserRow[];
  canManage: boolean;
  canDelete: boolean;
  canEditDriversOnly: boolean;
  truckMap?: Map<number, string>;
  customerMap?: Map<number, string>;
  businessUnitMap?: Map<number, string>;
  deleting: number | null;
  currentUserId?: number;
  onEdit: (u: UserRow) => void;
  onDelete: (id: number) => void;
  sortBy: 'name' | 'role' | 'status' | 'date' | null;
  sortOrder: 'asc' | 'desc';
  onSort: (field: 'name' | 'role' | 'status' | 'date') => void;
}) {
  // 5 columns: Tài khoản, Liên hệ, Vai trò, Xe, Ngày tạo (status via left-edge strip)

  return (
    <div className="desktop-only">
      <div className="table-scroll">
        <table className="tt-table" style={{ minWidth: 880 }}>
          <thead>
            <tr>
              <th aria-sort={sortBy === 'name' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="users-sort-button" onClick={() => onSort('name')}>
                  Tài khoản
                  {sortBy === 'name' ? (sortOrder === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={13} style={{ opacity: 0.4 }} />}
                </button>
              </th>
              <th>Liên hệ</th>
              <th aria-sort={sortBy === 'role' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="users-sort-button" onClick={() => onSort('role')}>
                  Vai trò
                  {sortBy === 'role' ? (sortOrder === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={13} style={{ opacity: 0.4 }} />}
                </button>
              </th>
              <th>Xe</th>
              <th aria-sort={sortBy === 'date' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="users-sort-button" onClick={() => onSort('date')}>
                  Ngày tạo
                  {sortBy === 'date' ? (sortOrder === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={13} style={{ opacity: 0.4 }} />}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="users-empty">
                    <img src={resolveEmptyIllustration('empty-users')} alt="" aria-hidden="true" className="users-empty__illustration" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <p className="users-empty__title">Không tìm thấy tài khoản</p>
                    <p className="users-empty__desc">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>
                  </div>
                </td>
              </tr>
            )}
            {filtered.map(u => {
              const pill = ROLE_PILL[u.role] || { cls: 'pill pill--neutral', label: u.role };
              const isMe = u.id === currentUserId;
              const editable = canEditRow(u, canManage, canEditDriversOnly);
              const plate = getPlate(u, truckMap);
              const customerScope = getCustomerScopeLabel(u, customerMap);
              const clerkScope = getClerkScopeLabel(u, customerMap, businessUnitMap);
              return (
                <tr
                  key={u.id}
                  className={editable ? 'is-clickable' : undefined}
                  onClick={editable ? () => onEdit(u) : undefined}
                  onKeyDown={editable ? (event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onEdit(u);
                    }
                  } : undefined}
                  tabIndex={editable ? 0 : undefined}
                  style={{ cursor: editable ? 'pointer' : 'default' }}
                >
                  <td style={{ position: 'relative' }}>
                    <StatusStrip status={u.status} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <RoleAvatar role={u.role} />
                      <div>
                        <div className="user-name">
                          {u.fullName || u.username || <span style={{ color: 'var(--ink-3)', fontStyle: 'italic' }}>—</span>}
                          {isMe && <span className="user-name__you">(bạn)</span>}
                        </div>
                        {u.username && <div className="user-handle">{u.username}</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="user-contact">
                      {u.email && (
                        <div className="user-contact__row">
                          <Mail size={13} />
                          <span>{u.email}</span>
                        </div>
                      )}
                      {u.phone && (
                        <div className="user-contact__row">
                          <Phone size={13} />
                          <span>{u.phone}</span>
                        </div>
                      )}
                      {!u.email && !u.phone && <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </div>
                  </td>
                  <td>
                    <span className={pill.cls}><span className="dot" />{pill.label}</span>
                    {customerScope && (
                      <div className="user-customer-scope-label" title={customerScope}>
                        <Building2 size={12} aria-hidden="true" />
                        <span>{customerScope}</span>
                      </div>
                    )}
                    {!customerScope && clerkScope && (
                      <div className="user-customer-scope-label" title={clerkScope}>
                        <Building2 size={12} aria-hidden="true" />
                        <span>{clerkScope}</span>
                      </div>
                    )}
                  </td>
                  <td>
                    {plate
                      ? <span className="user-truck-plate">{plate}</span>
                      : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                  </td>
                  <td style={{ color: 'var(--ink-3)', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                    {formatDate(u.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Mobile card list (inside panel) ──────────────────────────────────────── */

function MobileCardList({ filtered, canManage, canDelete, canEditDriversOnly, truckMap, customerMap, businessUnitMap, deleting, currentUserId, onEdit, onDelete }: {
  filtered: UserRow[];
  canManage: boolean;
  canDelete: boolean;
  canEditDriversOnly: boolean;
  truckMap?: Map<number, string>;
  customerMap?: Map<number, string>;
  businessUnitMap?: Map<number, string>;
  deleting: number | null;
  currentUserId?: number;
  onEdit: (u: UserRow) => void;
  onDelete: (id: number) => void;
}) {
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (activeMenuId === null) return;
    const handleClose = () => setActiveMenuId(null);
    document.addEventListener('click', handleClose);
    return () => document.removeEventListener('click', handleClose);
  }, [activeMenuId]);

  return (
    <div className="mobile-only">
      {filtered.length === 0 ? (
        <div className="users-empty">
          <div className="users-empty__icon"><UserX size={24} /></div>
          <p className="users-empty__title">Không tìm thấy tài khoản</p>
          <p className="users-empty__desc">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>
        </div>
      ) : (
        filtered.map(u => {
          const pill = ROLE_PILL[u.role] || { cls: 'pill pill--neutral', label: u.role };
          const isMe = u.id === currentUserId;
          const editable = canEditRow(u, canManage, canEditDriversOnly);
          const plate = getPlate(u, truckMap);
          const customerScope = getCustomerScopeLabel(u, customerMap);
          const clerkScope = getClerkScopeLabel(u, customerMap, businessUnitMap);
          return (
            <div
                  key={u.id}
                  className={`m-card users-mobile-card${editable ? ' is-clickable' : ''}`}
                  style={{ cursor: editable ? 'pointer' : 'default', position: 'relative' }}
                  onClick={editable ? () => onEdit(u) : undefined}
                  onKeyDown={editable ? (event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onEdit(u);
                    }
                  } : undefined}
                  role={editable ? 'button' : undefined}
                  tabIndex={editable ? 0 : undefined}
                >
              <StatusStrip status={u.status} />
              <div className="users-mobile-card__header">
                <RoleAvatar role={u.role} />
                <div className="users-mobile-card__info">
                  <div className="users-mobile-card__name">
                    {u.fullName || u.username || <span style={{ color: 'var(--ink-3)', fontStyle: 'italic' }}>—</span>}
                    {isMe && <span className="user-name__you">(bạn)</span>}
                  </div>
                  <div className="users-mobile-card__identity-meta">
                    {u.username && <span className="users-mobile-card__handle">{u.username}</span>}
                    <span className={`users-mobile-card__role ${pill.cls}`}><span className="dot" />{pill.label}</span>
                  </div>
                </div>

                {editable && canManage && canDelete && (
                  <div className="users-mobile-card__menu">
                    <button
                      className="kebab-btn"
                      aria-label={`Mở thao tác cho ${u.fullName || u.username || 'tài khoản'}`}
                      aria-haspopup="menu"
                      aria-expanded={activeMenuId === u.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuId(activeMenuId === u.id ? null : u.id);
                      }}
                      style={{ padding: 0 }}
                    >
                      <MoreVertical size={16} />
                    </button>
                    {activeMenuId === u.id && (
                      <div className="users-mobile-card__dropdown" role="menu" style={{
                        position: 'absolute', right: 0, top: '100%', zIndex: 100,
                        background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
                        overflow: 'hidden', minWidth: 120,
                      }} onClick={(e) => e.stopPropagation()}>
                        {canManage && canDelete && (
                          <button role="menuitem" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 12.5, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--danger)', opacity: isMe ? 0.4 : 1 }}
                            disabled={!!deleting || isMe}
                            onClick={() => { setActiveMenuId(null); if (!isMe) onDelete(u.id); }}>
                            {deleting === u.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} Xoá
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="users-mobile-card__details">
                <div className="users-mobile-card__detail-list">
                  {plate && (
                    <span className="user-truck-plate">{plate}</span>
                  )}
                  {customerScope && (
                    <span className="users-mobile-card__detail">
                      <Building2 size={12} /> {customerScope}
                    </span>
                  )}
                  {!customerScope && clerkScope && (
                    <span className="users-mobile-card__detail">
                      <Building2 size={12} /> {clerkScope}
                    </span>
                  )}
                  {u.email && (
                    <span className="users-mobile-card__detail">
                      <Mail size={12} /> {u.email}
                    </span>
                  )}
                  {u.phone && (
                    <span className="users-mobile-card__detail">
                      <Phone size={12} /> {u.phone}
                    </span>
                  )}
                  <span className="users-mobile-card__detail" style={{ color: 'var(--ink-4)' }}>
                    {formatDate(u.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
