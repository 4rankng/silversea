import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('../../hooks/useDropdownDismiss', () => ({
  useDropdownDismiss: () => {},
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
  authState.context = { user: { userId: 1, username: 'admin', role: 'ADMIN' } };
  getAllCustomers.mockReset().mockResolvedValue(customers);
  fetchAllTrips.mockReset().mockResolvedValue({ items: [] as TripDetail[], total: 0 });
});

describe('CustomersConfigPage client-side sorting', () => {
  it('keeps all summary metrics and customer fields in the compact layout', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách hàng An', { selector: '.cfg-customer-full-name' });
    const summary = screen.getByRole('group', { name: 'Tổng quan khách hàng' });
    for (const label of ['Tổng khách hàng', 'Đang hoạt động', 'Top 4 chiếm', 'Tạm khoá']) {
      expect(within(summary).getByText(label)).toBeInTheDocument();
    }
    const row = container.querySelector('.cfg-customer-table tbody tr') as HTMLTableRowElement;
    expect(row.querySelectorAll('td[data-label]:not(.record-table__action)')).toHaveLength(12);
    // Compact records expose every desktop field in the native disclosure.
    const details = row.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Thông tin chi tiết')).toBeInTheDocument();
    expect(details.querySelectorAll('dt')).toHaveLength(12);
    for (const label of ['Tên đầy đủ', 'Tên viết tắt', 'Địa chỉ', 'SĐT liên hệ', 'Hạn thanh toán cước']) {
      expect(within(details).getByText(label)).toBeInTheDocument();
    }
    fireEvent.click(within(details).getByText('Thông tin chi tiết'));
    expect(details.open).toBe(true);
    expect(within(details).getByText('Khách hàng An')).toBeVisible();
    fireEvent.click(within(row).getByRole('button', { name: 'Thao tác khách hàng Khách hàng An' }));
    expect(within(row).getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Xoá' })).toBeInTheDocument();
  });

  it('keeps the fetch order until a header is used', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách hàng An', { selector: '.cfg-customer-full-name' });
    expect(nameOrder(container)).toEqual(['Khách hàng An', 'Khách hàng Bình', 'Khách hàng Cường']);
  });

  it('sorts by name via the Vietnamese collation', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách hàng An', { selector: '.cfg-customer-full-name' });

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

// DISPATCHER now has full edit/delete access (matching CUS). The action
// column and per-row menu render for all catalog-editor roles.
describe('CustomersConfigPage dispatcher edit/delete access', () => {
  afterEach(() => { authState.context = null; });

  it('shows the create button and per-row action menu for DISPATCHER', async () => {
    authState.context = { user: { userId: 9, username: 'dieuvan', role: 'DISPATCHER' } };
    const { container } = renderPage();
    await screen.findByText('Khách hàng An', { selector: '.cfg-customer-full-name' });

    expect(screen.getByRole('button', { name: /Thêm khách hàng/ })).toBeInTheDocument();
    expect(container.querySelectorAll('.cfg-customer-table thead th')).toHaveLength(13);
    expect(container.querySelector('.record-table__action')).not.toBeNull();
  });

  it('renders the action column for full catalog editors', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách hàng An', { selector: '.cfg-customer-full-name' });

    expect(container.querySelectorAll('.cfg-customer-table thead th')).toHaveLength(13);
    expect(container.querySelector('.record-table__action')).not.toBeNull();
  });
});


describe('UI-CD-09 catalog query whitespace', () => {
  it('normalizes API queries while preserving the typed search', async () => {
    renderPage();
    await screen.findAllByText('Khách hàng An');
    const input = screen.getByRole('textbox', { name: 'Tìm khách hàng theo tên, tên ngắn, mã số thuế, điện thoại hoặc người liên hệ' });
    fireEvent.change(input, { target: { value: '  que  vo  ' } });
    await waitFor(() => expect(getAllCustomers).toHaveBeenLastCalledWith('que vo'));
    expect(input).toHaveValue('  que  vo  ');
    getAllCustomers.mockClear();
    fireEvent.change(input, { target: { value: 'que vo' } });
    expect(getAllCustomers).not.toHaveBeenCalled();
    expect(input).toHaveValue('que vo');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
  });
});

describe('SIS-ROLE-01/02 optional customer trip statistics', () => {
  it('does not request unavailable trip statistics for CUS', async () => {
    authState.context = { user: { userId: 2, username: 'cus', role: 'CUS' } };
    renderPage();
    await screen.findByText('Khách hàng An', { selector: '.cfg-customer-full-name' });
    expect(fetchAllTrips).not.toHaveBeenCalled();
    expect(screen.getByText('Tài khoản không xem doanh thu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', { name: /Tìm khách hàng/ }), { target: { value: 'An' } });
    await waitFor(() => expect(getAllCustomers).toHaveBeenLastCalledWith('An'));
    expect(fetchAllTrips).not.toHaveBeenCalled();
  });

  it('loads the catalog independently and does not refetch statistics for search', async () => {
    let resolveTrips!: (value: { items: TripDetail[]; total: number }) => void;
    fetchAllTrips.mockImplementation(() => new Promise(resolve => { resolveTrips = resolve; }));
    renderPage();
    await screen.findByText('Khách hàng An', { selector: '.cfg-customer-full-name' });
    expect(screen.getByText('Đang tải doanh thu…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeDisabled();
    expect(fetchAllTrips).toHaveBeenCalledTimes(1);
    expect(fetchAllTrips).toHaveBeenCalledWith({ dateFrom: expect.stringMatching(/^\d{4}-\d{2}-01$/), dateTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    fireEvent.change(screen.getByRole('textbox', { name: /Tìm khách hàng/ }), { target: { value: 'Bình' } });
    await waitFor(() => expect(getAllCustomers).toHaveBeenLastCalledWith('Bình'));
    expect(fetchAllTrips).toHaveBeenCalledTimes(1);
    resolveTrips({ items: [], total: 0 });
    await screen.findByText('Chưa có doanh thu tháng này');
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeEnabled();
  });

  it('keeps customers visible when statistics fail and retries only statistics', async () => {
    fetchAllTrips.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ items: [], total: 0 });
    renderPage();
    await screen.findByText('Khách hàng An', { selector: '.cfg-customer-full-name' });
    await screen.findByText('Không thể tải doanh thu.');
    expect(screen.queryByText('Chưa có doanh thu tháng này')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeDisabled();
    const catalogCalls = getAllCustomers.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByText('Chưa có doanh thu tháng này');
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeEnabled();
    expect(getAllCustomers).toHaveBeenCalledTimes(catalogCalls);
    expect(fetchAllTrips).toHaveBeenCalledTimes(2);
  });
});
