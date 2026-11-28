import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Role, ROLE_LABELS } from '@tingting/shared';
import { userClient } from '../api/userClient';
import { qk } from '../api/keys';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { StatusStrip } from '../components/shared/StatusStrip';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, FilterBar } from '../design-system';
import { UuiSelectField } from '../design-system/forms/UuiSelectField';
import { usePageAnimations } from '../hooks/animations';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';

/**
 * Danh sách nhân sự — read-only personnel roster.
 *
 * A different surface from /users (permission administration): this page
 * renders the personnel profile columns only (Mã NV, họ tên, bộ phận, email,
 * điện thoại, trạng thái) over the same users data, with no roles, no logins
 * and no row actions.
 *
 * Scope — KB §6.4/§6.5 (24/11): the roster is the personnel directory and
 * names EVERY department (Lái xe, Vận hành giao nhận, Chứng từ, Điều vận,
 * Kế toán, Quản trị / Quản lý). This supersedes the 2026-10-09 ruling that
 * reduced this page to driver rows; that ruling's real subject — chấm công /
 * lương stay driver-only — lives on /timesheet and /salary and is untouched
 * here. Customer portal accounts are not personnel and never appear.
 *
 * Bộ phận resolves in one order: the row's ACTIVE business unit names
 * (ticket 171026123000, owner ruling 2026-10-17 — a deactivated unit must
 * never surface) and, when the row has none, the shared ROLE_LABELS business
 * name of its role (one business name per role everywhere, card 20260921_25).
 * The "Lọc theo bộ phận" dropdown offers exactly those same values, so a
 * department filter and the Bộ phận column always agree.
 */

/** One department per row: the ACTIVE business units it is linked to, or —
 * when it has none — the shared business name of its role. The filter value
 * keeps both kinds apart so a unit option and a role option can never
 * collide. */
type RosterDepartment =
  | { kind: 'unit'; id: number; label: string }
  | { kind: 'role'; role: Role; label: string };

export default function HrRosterPage() {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');

  // The roster reads its own office-staff-readable projection
  // (/auth/users/roster) — /auth/users is an admin surface and 403s the
  // finance roles this page's menu addresses (card 20261009_2). Same bare
  // ['users'] key as before: distinct from the /users table's keyed entries.
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.catalogs.users,
    queryFn: () => userClient.getHrRoster(),
  });

  const { rootRef } = usePageAnimations({ ready: !isLoading });

  const personnel = useMemo(
    // Customer portal accounts are customers, not personnel — the server
    // already excludes them; the page keeps the same guard so a stale or
    // widened payload can never put a portal customer on the roster.
    () => (data?.items ?? []).filter((u) => u.role !== Role.CUSTOMER),
    [data],
  );

  // Card 171026123000: /hr/roster renders ACTIVE business units only — a
  // deactivated unit must never surface as a Bộ phận name or a filter choice,
  // even if the payload still carries it or a stale link points at it.
  const businessUnitMap = useMemo(
    () => new Map((data?.businessUnits ?? [])
      .filter((unit) => unit.status === 'ACTIVE')
      .map((unit) => [unit.id, unit.name])),
    [data],
  );

  // Each row resolves to ONE department: its ACTIVE business units when it
  // has any, else the shared business name of its role.
  const departmentOf = useMemo(() => {
    const map = new Map<number, RosterDepartment>();
    for (const u of personnel) {
      const unitNames = (u.businessUnitIds ?? [])
        .map((id) => businessUnitMap.get(id))
        .filter((name): name is string => name != null);
      map.set(u.id, unitNames.length > 0
        ? { kind: 'unit', id: (u.businessUnitIds ?? [])[0], label: unitNames.join(', ') }
        : { kind: 'role', role: u.role, label: ROLE_LABELS[u.role] });
    }
    return map;
  }, [personnel, businessUnitMap]);

  // The filter offers exactly the departments the rows carry, so a filter
  // choice and the Bộ phận column always name the same thing.
  const departmentOptions = useMemo(() => {
    const units = new Map<number, string>();
    const roles = new Map<Role, string>();
    for (const department of departmentOf.values()) {
      if (department.kind === 'unit') units.set(department.id, department.label);
      else roles.set(department.role, department.label);
    }
    const options = [
      ...[...units].map(([id, label]) => ({ value: `unit:${id}`, label })),
      ...[...roles].map(([role, label]) => ({ value: `role:${role}`, label })),
    ].sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: 'all', label: 'Tất cả bộ phận' }, ...options];
  }, [departmentOf]);

  const term = search.trim().toLowerCase();
  const filtered = useMemo(() => personnel.filter((u) => {
    if (department !== 'all') {
      const [kind, value] = department.split(':');
      const row = departmentOf.get(u.id);
      if (kind === 'unit') {
        if (!(u.businessUnitIds ?? []).includes(Number(value))) return false;
      } else if (!row || row.kind !== 'role' || row.role !== value) {
        return false;
      }
    }
    if (!term) return true;
    return [u.fullName, u.employeeCode, u.email, u.phone, u.username]
      .some((v) => (v ?? '').toLowerCase().includes(term));
  }), [personnel, department, departmentOf, term]);

  // Card 20260922_22 presence rule: an EMAIL column no filtered row fills
  // hides itself instead of a column of '—' dashes. One row with a value
  // keeps the column (zero-value threshold only).
  const emailPresent = useMemo(
    () => filtered.some((u) => (u.email ?? '').trim() !== ''),
    [filtered],
  );

  if (isLoading) {
    return (
      <div className="hr-roster" style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="spin" style={{ width: 28, height: 28, border: '3px solid var(--line-2)', borderTopColor: 'var(--brand)', borderRadius: '50%' }} />
      </div>
    );
  }

  return (
    <div className="hr-roster" style={{ paddingBottom: 40 }} ref={rootRef}>
      <Breadcrumbs
        className="hr-roster__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Danh sách nhân sự' },
        ]}
      />
      <PageHeader title="Danh sách nhân sự" />

      <p style={{ margin: '0 0 12px', color: 'var(--ink-3)', fontSize: 'var(--text-data-size)' }}>
        Hồ sơ nhân sự — thêm/sửa tài khoản và phân quyền tại "Quản lý Người dùng" (/users).
      </p>

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Tìm mã NV, họ tên, email, điện thoại…',
          ariaLabel: 'Tìm trong danh sách nhân sự',
          inputProps: { name: 'hrRosterSearch' },
        }}
      >
        <UuiSelectField
          label="Bộ phận"
          hideLabel
          ariaLabel="Lọc theo bộ phận"
          inline
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
          options={departmentOptions}
        />
      </FilterBar>

      {isError && (
        <EmptyState
          context="users"
          title="Không thể tải danh sách nhân sự"
          description="Đã xảy ra lỗi khi tải dữ liệu. Thử tải lại trang."
        />
      )}

      {!isError && (
        <div className="record-table-wrap record-table-wrap--table">
          <table className="record-table ops-table">
            <caption className="sr-only">Danh sách nhân sự</caption>
            <thead>
              <tr>
                <th>Mã NV</th>
                <th>Họ tên</th>
                <th>Bộ phận</th>
                {emailPresent && <th>Email</th>}
                <th>Điện thoại</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={emailPresent ? 6 : 5} data-label="">
                    <div style={{ padding: '24px 0' }}>
                      <EmptyState
                        variant="compact"
                        context="users"
                        title="Không tìm thấy nhân sự"
                        description="Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm"
                      />
                    </div>
                  </td>
                </tr>
              )}
              {filtered.map((u) => {
                const department = departmentOf.get(u.id);
                return (
                  <tr key={u.id}>
                    <td data-label="Mã NV" style={{ position: 'relative' }}>
                      <StatusStrip status={u.status} />
                      <span style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--text-data-size)' }}>{u.employeeCode ?? '—'}</span>
                    </td>
                    <td data-label="Họ tên">{u.fullName || '—'}</td>
                    <td data-label="Bộ phận">
                      {/* The row's one department: its ACTIVE business units,
                          else the shared business name of its role — never
                          '—' (SIL-812). */}
                      <span style={{ fontSize: 'var(--text-data-size)' }}>{department?.label ?? '—'}</span>
                    </td>
                    {emailPresent && (
                    <td data-label="Email">
                      {u.email
                        ? <span style={{ fontSize: 'var(--text-data-size)' }}>{u.email}</span>
                        : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                    </td>
                    )}
                    <td data-label="Điện thoại">
                      {u.phone
                        ? <span style={{ fontSize: 'var(--text-data-size)' }}>{u.phone}</span>
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
      )}
    </div>
  );
}
