import { render } from '@testing-library/react';
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
  driverId: null,
  assignedTruckId: null,
  baseSalary: null,
  socialInsurance: null,
};

describe('UserTable username display', () => {
  it('shows the stored username without a decorative @ prefix on desktop and mobile', () => {
    const { container } = render(
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
      />,
    );

    expect(container.querySelector('.user-handle')?.textContent).toBe('phuongnt');
    expect(container.querySelector('.users-mobile-card__handle')?.textContent).toBe('phuongnt');
    expect(container.textContent).not.toContain('@phuongnt');
  });
});
