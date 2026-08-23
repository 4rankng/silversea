import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listTripsMock = vi.hoisted(() => vi.fn());
const getPayablesSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('../api/tripClient', () => ({
  tripClient: {
    listTrips: listTripsMock,
  },
}));

vi.mock('../api/financialClient', () => ({
  financialClient: {
    getPayablesSummary: (...args: unknown[]) => getPayablesSummaryMock(...args),
  },
}));

vi.mock('./payables-fuel-invoices', () => ({
  FuelInvoicesPanel: () => null,
}));

vi.mock('../hooks/useCatalogs', () => ({
  useCatalogs: () => ({ data: { suppliers: [] } }),
}));

vi.mock('../hooks/useQueries', () => ({
  usePostCommission: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 1, role: 'ACCOUNTANT' } }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters: vi.fn() }),
}));

vi.mock('../hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => true,
}));

import { CommissionModal, default as PayableListPage } from './PayableListPage';

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommissionModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isPending={false}
        error={null}
      />
    </QueryClientProvider>,
  );
}

describe('CommissionModal trip selector', () => {
  beforeEach(() => {
    listTripsMock.mockReset();
    listTripsMock.mockResolvedValue({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 });
  });

  it('queries one bounded page and forwards the debounced server search term', async () => {
    renderModal();

    await waitFor(() => expect(listTripsMock).toHaveBeenCalledWith({
      limit: 50,
      page: 1,
      search: undefined,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Chuyến liên quan (tuỳ chọn)' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Tìm theo mã chuyến, khách hàng hoặc tuyến…' }), {
      target: { value: 'Hải Phòng' },
    });

    await waitFor(() => expect(listTripsMock).toHaveBeenCalledWith({
      limit: 50,
      page: 1,
      search: 'Hải Phòng',
    }), { timeout: 1_000 });
  });
});

describe('PayableListPage server-side column sorting', () => {
  function payable(id: number, name: string, totalOutstanding: number) {
    return {
      supplier: {
        id,
        name,
        contactPerson: null,
        phone: null,
        taxCode: null,
        note: null,
        status: 'ACTIVE',
        linkedCustomerId: null,
        isFuelSupplier: false,
        createdAt: '',
        updatedAt: '',
        deletedAt: null,
      },
      totalOutstanding,
      aging: { current: totalOutstanding, d30: 0, d60: 0, over90: 0 },
      maxOverdueDays: 0,
      kind: 'vendor' as const,
    };
  }

  // total 30 with limit 25 → two pages, so a page-2 visit is observable.
  const envelope = {
    items: [payable(1, 'NCC A', 12_000_000), payable(2, 'NCC B', 8_000_000)],
    totalOutstanding: '42000000',
    totalSuppliers: 30,
    overdueSuppliers: 3,
    page: 1,
    limit: 25,
    total: 30,
    totalPages: 2,
    totals: {
      current: 20_000_000, d30: 0, d60: 0, over90: 0,
      currentCount: 2, d30Count: 0, d60Count: 0, over90Count: 0,
    },
  };

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PayableListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  function lastCallParams() {
    const calls = getPayablesSummaryMock.mock.calls;
    return calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
  }

  beforeEach(() => {
    getPayablesSummaryMock.mockReset().mockResolvedValue(envelope);
  });

  it('loads without sort params and marks every data column header unsorted', async () => {
    renderPage();
    expect((await screen.findAllByText('NCC A')).length).toBeGreaterThan(0);

    expect(lastCallParams()).toMatchObject({ page: 1, limit: 25 });
    expect(lastCallParams()?.sortBy).toBeUndefined();
    expect(lastCallParams()?.sortDir).toBeUndefined();
    for (const name of ['Nhà cung cấp', 'Tổng nợ', '0-30 ngày', '31-60 ngày', '61-90 ngày', '>90 ngày']) {
      expect(screen.getByRole('columnheader', { name }).getAttribute('aria-sort')).toBe('none');
    }
  });

  it('sends sortBy/sortDir on header clicks, toggles asc → desc, and tracks aria-sort', async () => {
    renderPage();
    expect((await screen.findAllByText('NCC A')).length).toBeGreaterThan(0);

    const totalHeader = screen.getByRole('columnheader', { name: 'Tổng nợ' });
    fireEvent.click(screen.getByRole('button', { name: 'Tổng nợ' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({
      sortBy: 'totalOutstanding', sortDir: 'asc', page: 1,
    }));
    expect(totalHeader.getAttribute('aria-sort')).toBe('ascending');

    // Re-query after the refetch re-render; a held node may be detached.
    fireEvent.click(screen.getByRole('button', { name: 'Tổng nợ' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({
      sortBy: 'totalOutstanding', sortDir: 'desc',
    }));
    expect(totalHeader.getAttribute('aria-sort')).toBe('descending');

    // An aging bucket column starts fresh ascending.
    fireEvent.click(screen.getByRole('button', { name: '31-60 ngày' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({
      sortBy: 'd30', sortDir: 'asc',
    }));
  });

  it('resets to page 1 when a sort is engaged from a later page', async () => {
    renderPage();
    expect((await screen.findAllByText('NCC A')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ page: 2 }));

    fireEvent.click(screen.getByRole('button', { name: 'Nhà cung cấp' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({
      sortBy: 'supplierName', sortDir: 'asc', page: 1,
    }));
  });
});
