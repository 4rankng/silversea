import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';
import type { UserRow } from '../features/users/utils';

const getUsers = vi.fn();
let tableProps: Record<string, unknown> = {};

vi.mock('../api/userClient', () => ({
  userClient: { getUsers: (...args: unknown[]) => getUsers(...args) },
}));

vi.mock('../api/configClient', () => ({
  configClient: {
    getTrucks: vi.fn().mockResolvedValue([]),
    getAllCustomers: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../api/shipmentClient', () => ({
  listShipments: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { userId: 1, role: 'ADMIN', capabilities: ['manage_users'] },
  }),
}));

vi.mock('../features/users/hooks/useUserMutations', () => ({
  useUserMutations: () => ({
    saving: false,
    panelError: null,
    deleting: false,
    confirmDialog: null,
    doCreate: vi.fn(),
    doUpdate: vi.fn(),
    doDelete: vi.fn(),
    clearPanelError: vi.fn(),
  }),
}));

vi.mock('../features/users/components/UserTable', () => ({
  // Capture the props UsersPage hands to the table; render a probe so the
  // page contract (rows/totals/counts/handlers) can be asserted directly.
  UserTable: (props: Record<string, unknown>) => {
    tableProps = props;
    return <div data-testid="user-table" />;
  },
}));

vi.mock('../features/users/components/UserForm', () => ({
  AddPanel: () => null,
  EditPanel: () => null,
}));

vi.mock('../components/shared/Breadcrumbs', () => ({
  Breadcrumbs: () => null,
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import UsersPage from './UsersPage';

const users: UserRow[] = [
  {
    id: 1, username: 'an', fullName: 'An Nguyễn', email: null, phone: null,
    role: Role.DRIVER, status: 'ACTIVE', createdAt: '2026-08-01T00:00:00.000Z',
    driverId: null, assignedTruckId: null, baseSalary: null, socialInsurance: null,
  },
  {
    id: 2, username: 'binh', fullName: 'Bình Trần', email: null, phone: null,
    role: Role.ACCOUNTANT, status: 'ACTIVE', createdAt: '2026-08-02T00:00:00.000Z',
    driverId: null, assignedTruckId: null, baseSalary: null, socialInsurance: null,
  },
];

const usersEnvelope = {
  items: users,
  total: 2,
  businessUnits: [],
  counts: {
    total: 12,
    staffCount: 5,
    driverCount: 6,
    inactiveCount: 1,
    byRole: { [Role.DRIVER]: 6, [Role.ACCOUNTANT]: 2 },
  },
};

function renderUsersPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>,
  );
}

function lastCallParams() {
  const calls = getUsers.mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  getUsers.mockReset().mockResolvedValue(usersEnvelope);
  tableProps = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('UsersPage server-driven table query', () => {
  it('loads page 1 with no implicit filters and wires rows/totals/counts to UserTable', async () => {
    renderUsersPage();
    await waitFor(() => expect(screen.getByTestId('user-table')).toBeTruthy());

    expect(lastCallParams()).toMatchObject({ search: '', page: 1, limit: 10 });
    expect(lastCallParams()?.role).toBeUndefined();
    expect(lastCallParams()?.sortBy).toBeUndefined();

    await waitFor(() => expect(tableProps.paginated).toEqual(users));
    expect(tableProps.filteredTotal).toBe(2);
    expect(tableProps.total).toBe(12);
    expect(tableProps.staffCount).toBe(5);
    expect(tableProps.driverCount).toBe(6);
    expect(tableProps.inactiveCount).toBe(1);
    expect(tableProps.roleCounts).toEqual(usersEnvelope.counts.byRole);
  });

  it('sends the role filter as a param (never filtering client-side)', async () => {
    renderUsersPage();
    await waitFor(() => expect(screen.getByTestId('user-table')).toBeTruthy());

    (tableProps.onFilterChange as (f: string) => void)('DRIVER');
    await waitFor(() => expect(lastCallParams()).toMatchObject({ role: 'DRIVER', page: 1 }));
    expect(tableProps.filter).toBe('DRIVER');

    // Switching back to "all" must never send role='all' (the page maps it to
    // an absent param; the initial no-role query is cache-hit, no new call).
    (tableProps.onFilterChange as (f: string) => void)('all');
    await waitFor(() => expect(tableProps.filter).toBe('all'));
    const rolesSent = getUsers.mock.calls.map((call) => (call[0] as Record<string, unknown>).role);
    expect(rolesSent).not.toContain('all');
  });

  it('debounces search and resets to page 1 on a new term', async () => {
    renderUsersPage();
    await waitFor(() => expect(screen.getByTestId('user-table')).toBeTruthy());

    (tableProps.onPageChange as (p: number) => void)(2);
    await waitFor(() => expect(lastCallParams()).toMatchObject({ page: 2 }));

    (tableProps.onSearchChange as (s: string) => void)('binh');
    await waitFor(() => expect(lastCallParams()).toMatchObject({ search: 'binh', page: 1 }), { timeout: 2000 });
    expect(tableProps.search).toBe('binh');
  });

  it('toggles sort params: same field flips order, new field starts asc', async () => {
    renderUsersPage();
    await waitFor(() => expect(screen.getByTestId('user-table')).toBeTruthy());

    const clickSort = (field: 'name' | 'role' | 'status' | 'date') =>
      (tableProps.onSort as (f: 'name' | 'role' | 'status' | 'date') => void)(field);

    clickSort('name');
    await waitFor(() => expect(lastCallParams()).toMatchObject({ sortBy: 'name', sortOrder: 'asc' }));

    // Re-invoke through the fresh render's closure so the toggle sees sortBy='name'.
    clickSort('name');
    await waitFor(() => expect(lastCallParams()).toMatchObject({ sortBy: 'name', sortOrder: 'desc' }));

    clickSort('date');
    await waitFor(() => expect(lastCallParams()).toMatchObject({ sortBy: 'date', sortOrder: 'asc' }));
  });
});
