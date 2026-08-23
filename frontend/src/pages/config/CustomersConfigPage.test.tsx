import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('sorts by credit limit asc on first click and desc on the second', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách hàng An');

    fireEvent.click(screen.getByRole('button', { name: 'Hạn mức TD' }));
    await waitFor(() => expect(nameOrder(container)).toEqual([
      'Khách hàng Bình', 'Khách hàng Cường', 'Khách hàng An',
    ]));

    fireEvent.click(screen.getByRole('button', { name: 'Hạn mức TD' }));
    await waitFor(() => expect(nameOrder(container)).toEqual([
      'Khách hàng An', 'Khách hàng Cường', 'Khách hàng Bình',
    ]));
  });

  it('sorts by name via the Vietnamese collation', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách hàng An');

    fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
    await waitFor(() => expect(nameOrder(container)).toEqual([
      'Khách hàng An', 'Khách hàng Bình', 'Khách hàng Cường',
    ]));

    fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
    await waitFor(() => expect(nameOrder(container)).toEqual([
      'Khách hàng Cường', 'Khách hàng Bình', 'Khách hàng An',
    ]));
  });
});
