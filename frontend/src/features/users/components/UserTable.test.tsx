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
  it('keeps all nine role choices reachable in the shared category dropdown, which carries no counter', async () => {
    renderTable({
      filter: Role.DRIVER,
      total: 12,
      staffCount: 5,
      driverCount: 6,
      roleCounts: { [Role.ADMIN]: 2, [Role.DRIVER]: 6 },
    });

    const filter = screen.getByRole('button', { name: /Lọc tài khoản theo vai trò/ });
    // The dropdown names the selected scope and nothing else — a numeral would
    // ride the value as a stray annotation, and it repeats on every option
    // rather than marking the one selected (operator 2026-10-03: "dropdown
    // should not contain counter").
    expect(filter).toHaveTextContent('Lái xe');
    expect(filter).not.toHaveTextContent('(6)');
    expect(screen.queryByRole('tablist', { name: 'Lọc tài khoản theo vai trò' })).toBeNull();
    fireEvent.click(filter);
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(9);
    for (const label of ['Tất cả', 'Quản trị viên', 'Quản lý', 'Kế toán', 'Lái xe', 'Vận hành', 'Khách hàng', 'Chứng từ', 'Điều vận']) {
      expect(screen.getByRole('option', { name: new RegExp(label) })).toBeVisible();
    }
    // …and no option carries a count, in either direction: the total, the
    // per-role count, and the roles the server did not count (which read 0).
    for (const label of ['Tất cả', 'Quản trị viên', 'Kế toán', 'Lái xe']) {
      expect(screen.getByRole('option', { name: label })).toBeVisible();
    }
    expect(screen.getByRole('option', { name: 'Kế toán' })).toHaveTextContent('Kế toán');
    expect(screen.getByRole('option', { name: 'Kế toán' }).textContent).not.toMatch(/\d/);
  });

  it('keeps the shared dropdown and search writers wired to the page state', async () => {
    const onFilterChange = vi.fn();
    const onSearchChange = vi.fn();
    renderTable({ onFilterChange, onSearchChange });

    const filter = screen.getByRole('button', { name: /Lọc tài khoản theo vai trò/ });
    fireEvent.click(filter);
    fireEvent.click(await screen.findByRole('option', { name: /^Lái xe/ }));
    expect(onFilterChange).toHaveBeenCalledWith('DRIVER');
    fireEvent.keyDown(filter, { key: 'Escape' });

    fireEvent.change(await screen.findByRole('textbox', { name: 'Tìm tài khoản' }), { target: { value: 'phuong' } });
    expect(onSearchChange).toHaveBeenCalledWith('phuong');
  });
});
