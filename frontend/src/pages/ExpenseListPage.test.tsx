import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseWithRefs, PaginatedResponse } from '@tingting/shared';

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args), post: (...args: unknown[]) => apiPost(...args) },
}));

const useAuthMock = vi.fn<() => { user: { role: string; userId: number; username: string } | null }>(() => ({ user: null }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }));

vi.mock('../api/configClient', () => ({
  configClient: {
    getAllSuppliers: vi.fn().mockResolvedValue([]),
    getAllExpenseCategories: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../hooks/useCatalogs', () => ({
  useCatalogs: () => ({ data: { trucks: [] } }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useListAnimations: () => {},
}));

import ExpenseListPage from './ExpenseListPage';

const rows: ExpenseWithRefs[] = [
  {
    id: 1,
    expenseDate: '2026-08-20',
    supplierId: 3,
    categoryId: 5,
    truckId: 7,
    vehicleComponent: 'TRUCK',
    amount: '1250000',
    paymentStatus: 'UNPAID',
    validFrom: null,
    validTo: null,
    receiptId: null,
    note: null,
    createdBy: null,
    createdAt: '2026-08-21T02:00:00.000Z',
    updatedAt: '2026-08-21T02:00:00.000Z',
    deletedAt: null,
    supplier: {
      id: 3, name: 'Garage Auto 123', shortName: 'Garage', contactPerson: null, phone: null,
      taxCode: null, note: null, status: 'ACTIVE', linkedCustomerId: null, isFuelSupplier: false,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    },
    category: {
      id: 5, name: 'Sửa chữa', isRenewable: false, reminderLeadDays: 0, status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    },
    truck: { id: 7, licensePlate: '51H-123.45' },
  },
  {
    id: 2,
    expenseDate: '2026-08-19',
    supplierId: 4,
    categoryId: 6,
    truckId: null,
    vehicleComponent: null,
    amount: '480000',
    paymentStatus: 'PAID',
    validFrom: null,
    validTo: null,
    receiptId: null,
    note: null,
    createdBy: null,
    createdAt: '2026-08-19T01:00:00.000Z',
    updatedAt: '2026-08-19T01:00:00.000Z',
    deletedAt: null,
    supplier: {
      id: 4, name: 'Total Petroline', contactPerson: null, phone: null, taxCode: null,
      note: null, status: 'ACTIVE', linkedCustomerId: null, isFuelSupplier: true,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    },
    category: {
      id: 6, name: 'Nhiên liệu', isRenewable: false, reminderLeadDays: 0, status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    },
  },
];

function envelope(items: ExpenseWithRefs[], total = items.length): PaginatedResponse<ExpenseWithRefs> {
  return { items, total, page: 1, pageSize: 20 };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ExpenseListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue(envelope(rows, 43));
});

describe('ExpenseListPage', () => {
  it('fetches page 1 with backend-native pagination params and renders records', async () => {
    renderPage();

    expect(await screen.findByText('Garage Auto 123')).toBeTruthy();
    expect(screen.getByText('Ghi nợ')).toBeTruthy();
    expect(screen.getByText('Đã trả')).toBeTruthy();

    // The endpoint speaks page/limit — never the legacy pageSize param.
    expect(apiGet).toHaveBeenCalledWith('/expenses?page=1&limit=20');
    expect(apiGet.mock.calls.every(call => !String(call[0]).includes('pageSize='))).toBe(true);

    // Pagination summary carries the envelope total (43), not the row count.
    expect(screen.getByText('43')).toBeTruthy();
  });

  it('maps the date-range filter to fromDate/toDate and stays on page 1', async () => {
    renderPage();
    await screen.findByText('Garage Auto 123');

    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '01/08/2026' } });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/expenses?page=1&limit=20&fromDate=2026-08-01');
    });
    // Regression guard: the legacy dateFrom param is never sent.
    expect(apiGet.mock.calls.every(call => !String(call[0]).includes('dateFrom='))).toBe(true);
  });

  it('requests page 2 server-side when a pagination page is clicked', async () => {
    apiGet.mockResolvedValue(envelope(rows, 43));
    renderPage();
    await screen.findByText('Garage Auto 123');

    fireEvent.click(screen.getByRole('button', { name: '2' }));

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/expenses?page=2&limit=20');
    });
  });

  it('drives the summary rail from the envelope summary, not page math', async () => {
    apiGet.mockResolvedValue({
      ...envelope(rows, 43),
      summary: {
        totalAmount: 98_765_000,
        paidAmount: 87_654_000,
        unpaidAmount: 11_111_000,
        paidCount: 39,
        unpaidCount: 4,
      },
    });
    renderPage();
    await screen.findByText('Garage Auto 123');

    // Server full-set figures — unreachable from the two-row page fixture.
    expect(screen.getByText('11.111.000 ₫')).toBeTruthy();
    expect(screen.getByText('87.654.000 ₫')).toBeTruthy();
  });

  it('sorts server-side: header click sends sortBy/sortDir and resets the page', async () => {
    renderPage();
    await screen.findByText('Garage Auto 123');

    // Move to page 2 first so the sort's page reset is observable.
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/expenses?page=2&limit=20');
    });

    // Fresh column starts ascending, on page 1.
    fireEvent.click(screen.getByRole('button', { name: 'Số tiền' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/expenses?page=1&limit=20&sortBy=amount&sortDir=asc');
    });

    // Same header flips to descending.
    fireEvent.click(screen.getByRole('button', { name: 'Số tiền' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/expenses?page=1&limit=20&sortBy=amount&sortDir=desc');
    });
  });
});


// Dual-control review surface (QA-086 FE): pending rows badge as Chờ kiểm
// tra, checked rows offer role-gated Duyệt/Từ chối, and the review actions
// post to the approval endpoints then refetch.
describe('ExpenseListPage direct records', () => {
  beforeEach(() => {
    apiPost.mockReset().mockResolvedValue({});
    useAuthMock.mockReturnValue({ user: null });
  });

  it('badges a pending row and hides review actions without a role', async () => {
    apiGet.mockResolvedValueOnce(envelope([{ ...rows[0]!, id: 101, approvalStatus: 'PENDING' }]));
    renderPage();
    expect(await screen.findByText('Cần hoàn thiện')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
  });

  it('keeps legacy drafts editable without restoring review actions for admins', async () => {
    useAuthMock.mockReturnValue({ user: { role: 'ADMIN', userId: 1, username: 'admin' } });
    apiGet.mockResolvedValue(envelope([{ ...rows[0]!, id: 102, approvalStatus: 'CHECKED' }]));
    renderPage();
    expect(await screen.findByText('Cần hoàn thiện')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('keeps posted payment badges for approved legacy rows', async () => {
    apiGet.mockResolvedValueOnce(envelope([{ ...rows[0]!, id: 103 }]));
    renderPage();
    expect(await screen.findByText('Ghi nợ')).toBeTruthy();
  });
});

// FIN-POL-01a: empty date fields still have visible context and reversible filters.
it('keeps visible date labels and clears the selected date range', async () => {
  renderPage();
  await screen.findByText('Garage Auto 123');
  expect(screen.getByText('Từ ngày').closest('label')).toContainElement(screen.getByLabelText('Từ ngày'));
  expect(screen.getByText('Đến ngày').closest('label')).toContainElement(screen.getByLabelText('Đến ngày'));
  fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '01/08/2026' } });
  fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '31/08/2026' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Xóa bộ lọc' }));
  expect(screen.getByLabelText('Từ ngày')).toHaveValue('');
  expect(screen.getByLabelText('Đến ngày')).toHaveValue('');
});
