import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseWithRefs, PaginatedResponse } from '@tingting/shared';

const apiGet = vi.fn();

vi.mock('../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

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

    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-08-01' } });

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

  it('drives the KPI strip from the envelope summary, not page math', async () => {
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
    expect(screen.getByText('11.111.000')).toBeTruthy();
    expect(screen.getByText('87.654.000')).toBeTruthy();
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
