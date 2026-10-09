import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Role } from '@tingting/shared';
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
 * Danh sách nhân sự — read-only driver roster.
 *
 * A different surface from /users (permission administration): this page
 * renders the personnel profile columns only (Mã NV, họ tên, bộ phận, email,
 * điện thoại, trạng thái) over the same users data, with no roles, no logins
 * and no row actions. Bộ phận derives exactly the way /users derives it:
 * businessUnitIds mapped to business unit names, joined per row.
 *
 * Owner ruling 2026-10-09 ('chấm công chỉ dành cho lái xe' / no office
 * staff): personnel and timekeeping are DRIVER-ONLY — office roles are
 * administered on /users and never appear here. Office attendance/salary
 * fields are ruled out, not deferred.
 */

/** The roster is the driver roster; every office role stays on /users. */
function isRosterDriver(role: Role): boolean {
  return role === Role.DRIVER;
}

/** One fetch budgets the whole roster; users are a bounded population. */
const ROSTER_LIMIT = 500;

export default function HrRosterPage() {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');

  // qk.catalogs.users is the bare ['users'] key; the /users table caches
  // under ['users', appliedParams] (useTableQueryState appends), so this
  // whole-roster fetch is a distinct cache entry, not a collision.
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.catalogs.users,
    queryFn: () => userClient.getUsers({ limit: ROSTER_LIMIT }),
  });

  const { rootRef } = usePageAnimations({ ready: !isLoading });

  const personnel = useMemo(
    () => (data?.items ?? []).filter((u) => isRosterDriver(u.role)),
    [data],
  );

  const businessUnitMap = useMemo(
    () => new Map((data?.businessUnits ?? []).map((unit) => [unit.id, unit.name])),
    [data],
  );

  // The filter lists only the business units actually linked to roster rows.
  const departmentOptions = useMemo(() => {
    const used = new Set<number>();
    for (const u of personnel) {
      for (const id of u.businessUnitIds ?? []) used.add(id);
    }
    return [
      { value: 'all', label: 'Tất cả bộ phận' },
      ...[...used]
        .sort((a, b) => (businessUnitMap.get(a) ?? '').localeCompare(businessUnitMap.get(b) ?? ''))
        .map((id) => ({ value: String(id), label: businessUnitMap.get(id) ?? `#${id}` })),
    ];
  }, [personnel, businessUnitMap]);

  const term = search.trim().toLowerCase();
  const filtered = useMemo(() => personnel.filter((u) => {
    if (department !== 'all') {
      if (!(u.businessUnitIds ?? []).includes(Number(department))) return false;
    }
    if (!term) return true;
    return [u.fullName, u.employeeCode, u.email, u.phone, u.username]
      .some((v) => (v ?? '').toLowerCase().includes(term));
  }), [personnel, department, term]);

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
        <div className="record-table-wrap">
          <table className="record-table ops-table">
            <caption className="sr-only">Danh sách nhân sự</caption>
            <thead>
              <tr>
                <th>Mã NV</th>
                <th>Họ tên</th>
                <th>Bộ phận</th>
                <th>Email</th>
                <th>Điện thoại</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} data-label="">
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
                const unitIds = u.businessUnitIds ?? [];
                const unitNames = unitIds.length > 0
                  ? unitIds.map((id) => businessUnitMap.get(id) ?? '').filter(Boolean).join(', ')
                  : null;
                return (
                  <tr key={u.id}>
                    <td data-label="Mã NV" style={{ position: 'relative' }}>
                      <StatusStrip status={u.status} />
                      <span style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--text-data-size)' }}>{u.employeeCode ?? '—'}</span>
                    </td>
                    <td data-label="Họ tên">{u.fullName || '—'}</td>
                    <td data-label="Bộ phận">
                      {unitNames
                        ? <span style={{ fontSize: 'var(--text-data-size)' }}>{unitNames}</span>
                        : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                    </td>
                    <td data-label="Email">
                      {u.email
                        ? <span style={{ fontSize: 'var(--text-data-size)' }}>{u.email}</span>
                        : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                    </td>
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
