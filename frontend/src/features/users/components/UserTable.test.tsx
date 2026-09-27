import type { ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';
import { UserTable } from './UserTable';
import type { UserRow } from '../utils';

const user: UserRow = {
  id: 1,
  username: 'phuongnt',
  fullName: 'Nguyễn Thị Phương',
  email: null,
  phone: null,
  role: Role.ADMIN,
  status: 'ACTIVE',
  createdAt: '2026-07-28T00:00:00.000Z',
  employeeCode: null,
  driverId: null,
  assignedTruckId: null,
  baseSalary: null,
  socialInsurance: null,
};

function renderTable(overrides: Partial<ComponentProps<typeof UserTable>> = {}) {
  return render(
      <UserTable
        paginated={[user]}
        filteredTotal={1}
        roleCounts={{ [Role.ADMIN]: 1 }}
        total={1}
        staffCount={1}
        driverCount={0}
        inactiveCount={0}
        filter="all"
        search=""
        canManage
        deleting={null}
        onFilterChange={vi.fn()}
        onSearchChange={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        sortBy={null}
        sortOrder="asc"
        onSort={vi.fn()}
        currentPage={1}
        pageSize={25}
        onPageChange={vi.fn()}
        {...overrides}
      />,
    );

}

describe('UserTable username display', () => {
  it('shows the stored username without a decorative @ prefix on desktop and mobile', () => {
    const { container } = renderTable();

    expect(container.querySelector('.user-handle')?.textContent).toBe('phuongnt');
    expect(container.querySelector('.users-mobile-card__handle')?.textContent).toBe('phuongnt');
    expect(container.textContent).not.toContain('@phuongnt');
    expect(screen.queryByRole('navigation', { name: 'Phân trang' })).not.toBeInTheDocument();
  });
  it('shows the account range once inside pagination and preserves page changes', () => {
    const onPageChange = vi.fn();
    renderTable({ filteredTotal: 70, total: 70, pageSize: 10, onPageChange });
    const pagination = screen.getByRole('navigation', { name: 'Phân trang' });
    expect(screen.getAllByText(/Hiển thị/)).toHaveLength(1);
    expect(pagination).toHaveTextContent('Hiển thị 1-10 trong số 70 tài khoản');
    fireEvent.click(within(pagination).getByRole('button', { name: 'Trang sau' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe('UserTable role filter strip (card 20260927_152)', () => {
  it('renders every role as a shared boxed tab carrying its own count numeral', () => {
    renderTable({
      filter: Role.DRIVER,
      total: 12,
      staffCount: 5,
      driverCount: 6,
      roleCounts: { [Role.ADMIN]: 2, [Role.DRIVER]: 6 },
    });

    const tablist = screen.getByRole('tablist', { name: 'Lọc tài khoản theo vai trò' });
    // The label set is the one the chip row carried; only the segment shape and
    // the pill around the numeral changed.
    for (const label of ['Tất cả', 'Quản trị viên', 'Quản lý', 'Kế toán', 'Lái xe', 'Nhân viên vận hành', 'Khách hàng', 'Chứng từ', 'Điều vận']) {
      expect(within(tablist).getByRole('tab', { name: new RegExp(label) })).toBeTruthy();
    }
    // Every tab prints a count: the account total on `Tất cả`, the per-role
    // count on the rest (a role the server did not count reads 0).
    expect(within(tablist).getByRole('tab', { name: /^Tất cả\s*12$/ })).toBeTruthy();
    expect(within(tablist).getByRole('tab', { name: /^Lái xe\s*6$/ })).toBeTruthy();
    expect(within(tablist).getByRole('tab', { name: /^Quản trị viên\s*2$/ })).toBeTruthy();
    expect(within(tablist).getByRole('tab', { name: /^Kế toán\s*0$/ })).toBeTruthy();
  });

  it('keeps the shared tab and search writers wired to the page state', () => {
    const onFilterChange = vi.fn();
    const onSearchChange = vi.fn();
    renderTable({ onFilterChange, onSearchChange });

    const tablist = screen.getByRole('tablist', { name: 'Lọc tài khoản theo vai trò' });
    fireEvent.click(within(tablist).getByRole('tab', { name: /^Lái xe/ }));
    expect(onFilterChange).toHaveBeenCalledWith('DRIVER');

    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm tài khoản' }), { target: { value: 'phuong' } });
    expect(onSearchChange).toHaveBeenCalledWith('phuong');
  });
});
