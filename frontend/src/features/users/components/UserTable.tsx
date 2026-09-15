import {
  Plus, Pencil, Trash2,
  Loader2, KeyRound, Mail, Search, UserX, MoreVertical, X,
  ArrowUpDown, ArrowUp, ArrowDown, Building2,
  Users, ShieldCheck, UserCog,
} from 'lucide-react';
import { useState } from 'react';
import { useDropdownDismiss } from '../../../hooks/useDropdownDismiss';
import { Role, ROLE_LABELS, ROLE_PILL, FilterKey } from '../utils';
import type { UserRow } from '../utils';
import { StatusStrip, StatusSwatch } from '../../../components/shared/StatusStrip';
import { resolveEmptyIllustration } from '../../../lib/emptyIllustrations';
import { PageHeader } from '../../../components/UI';
import { Pagination, SummaryRail } from '../../../design-system';
import '../../../styles/record-table.css';
import '../../../styles/operational-table-typography.css';

interface UserTableProps {
  paginated: UserRow[];
  /** Filtered count from the server — drives the footer range + pagination. */
  filteredTotal: number;
  /** Per-role counts over the full visible set, for the active filter pill's badge. */
  roleCounts?: Record<string, number>;
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

export function UserTable({
  paginated, filteredTotal, roleCounts, total, staffCount, driverCount, inactiveCount,
  filter, search, canManage, canDelete = canManage, canEditDriversOnly = false,
  deleting, currentUserId,
  businessUnitMap,
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

      {/* ── Summary rail ─────────────────────────────────────────────────── */}
      <SummaryRail
        ariaLabel="Tóm tắt tài khoản"
        items={[
          { label: 'Tổng tài khoản', value: total },
          { label: 'Nhân sự văn phòng', value: staffCount },
          { label: 'Lái xe', value: driverCount },
          { label: 'Bị khoá / Ngưng', value: inactiveCount, tone: inactiveCount > 0 ? 'warning' : undefined },
        ]}
      />

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
            const count = f === 'all' ? total : roleCounts?.[f] ?? 0;
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
          businessUnitMap={businessUnitMap}
          deleting={deleting}
          currentUserId={currentUserId}
          onEdit={onEdit}
          onDelete={onDelete}
        />

        {/* Footer */}
        {(() => {
          const totalPages = Math.ceil(filteredTotal / pageSize);
          const startIdx = filteredTotal === 0 ? 0 : (currentPage - 1) * pageSize + 1;
          const endIdx = Math.min(filteredTotal, currentPage * pageSize);
          const summary = (
            <span className="users-table-foot__summary">
              Hiển thị <strong style={{ fontFamily: 'var(--font-data)' }}>{startIdx}-{endIdx}</strong> trong số <strong style={{ fontFamily: 'var(--font-data)' }}>{filteredTotal}</strong> tài khoản
            </span>
          );
          return (
            <div className="table-foot users-table-foot">
              {totalPages > 1 ? <Pagination page={currentPage} totalPages={totalPages} summary={summary} onChange={onPageChange} /> : summary}
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
          color: 'var(--ink-3)', fontSize: 'var(--text-data-size)',
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
  filtered, canManage, canDelete: _canDelete, canEditDriversOnly, deleting: _deleting, currentUserId,
  businessUnitMap,
  onEdit, onDelete: _onDelete,
  sortBy, sortOrder, onSort,
}: {
  filtered: UserRow[];
  canManage: boolean;
  canDelete: boolean;
  canEditDriversOnly: boolean;
  businessUnitMap?: Map<number, string>;
  deleting: number | null;
  currentUserId?: number;
  onEdit: (u: UserRow) => void;
  onDelete: (id: number) => void;
  sortBy: 'name' | 'role' | 'status' | 'date' | null;
  sortOrder: 'asc' | 'desc';
  onSort: (field: 'name' | 'role' | 'status' | 'date') => void;
}) {
  return (
    <div className="desktop-only">
      <div className="record-table-wrap">
        <table className="record-table ops-table" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th>Mã NV</th>
              <th aria-sort={sortBy === 'name' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="table-sort-button" onClick={() => onSort('name')}>
                  Họ tên
                  {sortBy === 'name' ? (sortOrder === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />) : <ArrowUpDown size={13} aria-hidden="true" className="table-sort-button__icon--idle" />}
                </button>
              </th>
              <th>Tên đăng nhập</th>
              <th aria-sort={sortBy === 'role' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="table-sort-button" onClick={() => onSort('role')}>
                  Phân quyền
                  {sortBy === 'role' ? (sortOrder === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />) : <ArrowUpDown size={13} aria-hidden="true" className="table-sort-button__icon--idle" />}
                </button>
              </th>
              <th>Email</th>
              <th>Bộ phận</th>
              <th aria-sort={sortBy === 'status' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="table-sort-button" onClick={() => onSort('status')}>
                  Trạng thái
                  {sortBy === 'status' ? (sortOrder === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />) : <ArrowUpDown size={13} aria-hidden="true" className="table-sort-button__icon--idle" />}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} data-label="">
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
              const unitIds = u.businessUnitIds ?? [];
              const unitNames = unitIds.length > 0
                ? unitIds.map(id => businessUnitMap?.get(id) ?? '').filter(Boolean).join(', ')
                : null;
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
                  <td data-label="Mã NV" style={{ position: 'relative' }}>
                    <StatusStrip status={u.status} />
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--text-data-size)' }}>{u.employeeCode ?? '—'}</span>
                  </td>
                  <td data-label="Họ tên">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <RoleAvatar role={u.role} />
                      <div>
                        <div className="user-name">
                          {u.fullName || <span style={{ color: 'var(--ink-3)', fontStyle: 'italic' }}>—</span>}
                          {isMe && <span className="user-name__you">(bạn)</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Tên đăng nhập">
                    <span className="user-handle">{u.username || '—'}</span>
                  </td>
                  <td data-label="Phân quyền">
                    <span className={pill.cls}><span className="dot" />{pill.label}</span>
                  </td>
                  <td data-label="Email">
                    {u.email
                      ? <span style={{ fontSize: 'var(--text-data-size)' }}>{u.email}</span>
                      : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                  </td>
                  <td data-label="Bộ phận">
                    {unitNames
                      ? <span style={{ fontSize: 'var(--text-data-size)' }}>{unitNames}</span>
                      : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                  </td>
                  <td data-label="Trạng thái" style={{ whiteSpace: 'nowrap' }}>
                    <span className={u.status === 'ACTIVE' ? 'pill pill--success' : 'pill pill--danger'}>
                      <span className="dot" />{u.status === 'ACTIVE' ? 'Hoạt động' : 'Bị khoá'}
                    </span>
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

function MobileCardList({ filtered, canManage, canDelete, canEditDriversOnly, businessUnitMap, deleting, currentUserId, onEdit, onDelete }: {
  filtered: UserRow[];
  canManage: boolean;
  canDelete: boolean;
  canEditDriversOnly: boolean;
  businessUnitMap?: Map<number, string>;
  deleting: number | null;
  currentUserId?: number;
  onEdit: (u: UserRow) => void;
  onDelete: (id: number) => void;
}) {
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);
  // The kebab menu joins the global click-away / Escape dismissal layer.
  useDropdownDismiss(activeMenuId !== null, () => setActiveMenuId(null));

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
          const unitIds = u.businessUnitIds ?? [];
          const unitNames = unitIds.length > 0
            ? unitIds.map(id => businessUnitMap?.get(id) ?? '').filter(Boolean).join(', ')
            : null;
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
                    {u.fullName || <span style={{ color: 'var(--ink-3)', fontStyle: 'italic' }}>—</span>}
                    {isMe && <span className="user-name__you">(bạn)</span>}
                  </div>
                  <div className="users-mobile-card__identity-meta">
                    {u.employeeCode && <span className="users-mobile-card__handle">{u.employeeCode}</span>}
                    {u.username && <span className="users-mobile-card__handle">{u.username}</span>}
                    <span className={`users-mobile-card__role ${pill.cls}`}><span className="dot" />{pill.label}</span>
                  </div>
                </div>

                {editable && canManage && canDelete && (
                  <div className="users-mobile-card__menu" data-dropdown-root={activeMenuId === u.id ? '' : undefined}>
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
                          <button role="menuitem" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',  border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--danger)', opacity: isMe ? 0.4 : 1 }}
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
                  {u.email && (
                    <span className="users-mobile-card__detail">
                      <Mail size={12} /> {u.email}
                    </span>
                  )}
                  {unitNames && (
                    <span className="users-mobile-card__detail">
                      <Building2 size={12} /> {unitNames}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
