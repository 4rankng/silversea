import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Customer, TripDetail } from '@tingting/shared';

const getAllCustomers = vi.fn();
const fetchAllTrips = vi.fn();

vi.mock('../../api/configClient', () => ({
  configClient: { getAllCustomers: (...args: unknown[]) => getAllCustomers(...args) },
}));

vi.mock('../../api/tripClient', () => ({
  tripClient: { fetchAllTrips: (...args: unknown[]) => fetchAllTrips(...args) },
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useBackShortcut', () => ({
  useBackShortcut: () => {},
}));

// Auth identity is mutable per test: null (no provider, full mode) by
// default; the dispatcher-mode tests point it at a DISPATCHER user.
const authState = vi.hoisted(() => ({ context: null as null | { user: { userId: number; username: string; role: string } } }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => authState.context,
}));

vi.mock('../../hooks/useCRUD', () => ({
  useCRUD: () => ({
    editingId: null,
    showAddForm: false,
    saving: false,
    deleting: null,
    error: null,
    setShowAddForm: vi.fn(),
    setEditingId: vi.fn(),
    cancelForm: vi.fn(),
    doCreate: vi.fn(),
    doUpdate: vi.fn(),
    doDelete: vi.fn(),
  }),
}));

import CustomersConfigPage from './CustomersConfigPage';

function makeCustomer(id: number, name: string, creditLimit: string): Customer {
  return {
    id,
    name,
    taxCode: null,
    contactPerson: null,
    phone: null,
    contactInfo: null,
    creditLimit,
    creditWarningThreshold: null,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Customer;
}

// Fixture order is NOT sorted on any column: limits run 30M, 10M, 20M.
const customers = [
  makeCustomer(1, 'Khách hàng An', '30000000'),
  makeCustomer(2, 'Khách hàng Bình', '10000000'),
  makeCustomer(3, 'Khách hàng Cường', '20000000'),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CustomersConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function nameOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.cfg-customer-table tbody .row-strong'))
    .map((el) => el.textContent ?? '');
}

beforeEach(() => {
  getAllCustomers.mockReset().mockResolvedValue(customers);
  fetchAllTrips.mockReset().mockResolvedValue({ items: [] as TripDetail[], total: 0 });
});

describe('CustomersConfigPage client-side sorting', () => {
  it('keeps the fetch order until a header is used', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách hàng An');
    expect(nameOrder(container)).toEqual(['Khách hàng An', 'Khách hàng Bình', 'Khách hàng Cường']);
  });

  it('sorts by name via the Vietnamese collation', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách hàng An');

    fireEvent.click(screen.getByRole('button', { name: 'Tên Khách hàng' }));
    await waitFor(() => expect(nameOrder(container)).toEqual([
      'Khách hàng An', 'Khách hàng Bình', 'Khách hàng Cường',
    ]));

    fireEvent.click(screen.getByRole('button', { name: 'Tên Khách hàng' }));
    await waitFor(() => expect(nameOrder(container)).toEqual([
      'Khách hàng Cường', 'Khách hàng Bình', 'Khách hàng An',
    ]));
  });
});

// DISPATCHER create-only mode: Casbin grants POST /customers but no
// PUT/DELETE, so the page must expose the create button while row-click
// editing stays unreachable for that role.
describe('CustomersConfigPage dispatcher create-only mode', () => {
  afterEach(() => { authState.context = null; });

  it('keeps the create button and drops the row-click edit affordance', async () => {
    authState.context = { user: { userId: 9, username: 'dieuvan', role: 'DISPATCHER' } };
    const { container } = renderPage();
    await screen.findByText('Khách hàng An');

    expect(screen.getByRole('button', { name: /Thêm khách hàng/ })).toBeInTheDocument();
    const row = container.querySelector('.cfg-customer-table tbody tr');
    expect(row).not.toBeNull();
    const rowEl = row as HTMLElement;
    expect(rowEl.getAttribute('onclick')).toBeNull();
    expect(rowEl.style.cursor).toBe('');
    expect(screen.queryByText(/Nhấn vào một hàng/)).not.toBeInTheDocument();
  });
});
