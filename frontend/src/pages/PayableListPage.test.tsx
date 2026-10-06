import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listTripsMock = vi.hoisted(() => vi.fn());
const getPayablesSummaryMock = vi.hoisted(() => vi.fn());
const getPhoiPhieuReportMock = vi.hoisted(() => vi.fn());

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

// Card 380 — the monthly production summary section fetches the phoi-phieu
// period reports; page tests stub it so the section renders without noise.
vi.mock('../api/phoiPhieuClient', () => ({
  getPhoiPhieuReport: (...args: unknown[]) => getPhoiPhieuReportMock(...args),
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
    // The card-380 summary section fetches the same endpoint with limit 500 for
    // its còn-nợ join; those calls are not the page's own paging behaviour.
    const calls = getPayablesSummaryMock.mock.calls.filter(
      (call) => (call[0] as { limit?: number } | undefined)?.limit !== 500,
    );
    return calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
  }

  beforeEach(() => {
    getPayablesSummaryMock.mockReset().mockResolvedValue(envelope);
    getPhoiPhieuReportMock.mockReset().mockResolvedValue({ rows: [], grand: null });
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

// Card 20260927_152: the strip is the shared `FilterBar` band and the category
// group rides its quick-filter slot — the page-local `.payables-toolbar` is gone.
describe('PayableListPage filter strip', () => {
  function payable(id: number, name: string, totalOutstanding: number) {
    return {
      supplier: {
        id, name, contactPerson: null, phone: null, taxCode: null, note: null,
        status: 'ACTIVE', linkedCustomerId: null, isFuelSupplier: false,
        createdAt: '', updatedAt: '', deletedAt: null,
      },
      totalOutstanding,
      aging: { current: totalOutstanding, d30: 0, d60: 0, over90: 0 },
      maxOverdueDays: 0,
      kind: 'vendor' as const,
    };
  }

  beforeEach(() => {
    getPayablesSummaryMock.mockReset().mockResolvedValue({
      items: [payable(1, 'NCC A', 12_000_000)],
      totalOutstanding: '12000000',
      totalSuppliers: 1,
      overdueSuppliers: 0,
      page: 1,
      limit: 25,
      total: 1,
      totalPages: 1,
      totals: { current: 12_000_000, d30: 0, d60: 0, over90: 0, currentCount: 1, d30Count: 0, d60Count: 0, over90Count: 0 },
    });
    getPhoiPhieuReportMock.mockReset().mockResolvedValue({ rows: [], grand: null });
  });

  it('renders the shared bar with the search and the category group inside it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PayableListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect((await screen.findAllByText('NCC A')).length).toBeGreaterThan(0);

    const bar = container.querySelector('.filter-bar');
    expect(bar).toBeTruthy();
    expect(container.querySelector('.pm-summary__error')).toBeNull();
    expect(container.querySelector('.payables-toolbar')).toBeNull();
    expect(bar?.contains(screen.getByLabelText('Tìm công nợ theo nhà cung cấp'))).toBe(true);
    expect(bar?.contains(screen.getByRole('tablist', { name: 'Lọc theo loại công nợ' }))).toBe(true);
  });
});

// Card 380 — the monthly production summary rides this page for /payables: its
// còn-nợ column must print the SAME number the ledger table prints as Tổng nợ
// for the same party (same endpoint, same field — month-close reconciliation).
describe('PayableListPage monthly production summary (card 380)', () => {
  // Shapes mirror the server envelope the page itself consumes.
  const payableRow = (name: string, totalOutstanding: number) => ({
    supplier: {
      id: 1, name, contactPerson: null, phone: null, taxCode: null, note: null,
      status: 'ACTIVE', linkedCustomerId: null, isFuelSupplier: false,
      createdAt: '', updatedAt: '', deletedAt: null,
    },
    totalOutstanding,
    aging: { current: totalOutstanding, d30: 0, d60: 0, over90: 0 },
    maxOverdueDays: 0,
    kind: 'vendor' as const,
  });

  beforeEach(() => {
    getPayablesSummaryMock.mockReset().mockResolvedValue({
      items: [payableRow('NCC A', 12_000_000), payableRow('Chủ xe B', 8_000_000)],
      totalOutstanding: '20000000',
      totalSuppliers: 2,
      overdueSuppliers: 0,
      page: 1,
      limit: 500,
      total: 2,
      totalPages: 1,
      totals: { current: 20_000_000, d30: 0, d60: 0, over90: 0, currentCount: 2, d30Count: 0, d60Count: 0, over90Count: 0 },
    });
    getPhoiPhieuReportMock.mockReset().mockImplementation((kind: string) => {
      if (kind === 'TRA') {
        return Promise.resolve({
          rows: [
            { party: 'NCC A', soLuong: 2, tongPhaiThuTra: 5_000_000, daThuTra: 1_000_000, conLai: 4_000_000 },
            { party: 'Chủ xe B', soLuong: 1, tongPhaiThuTra: 2_000_000, daThuTra: 0, conLai: 2_000_000 },
          ],
          grand: { party: 'TỔNG CỘNG', soLuong: 3, tongPhaiThuTra: 7_000_000, daThuTra: 1_000_000, conLai: 6_000_000 },
        });
      }
      return Promise.resolve({ rows: [], grand: null });
    });
  });

  it('renders the summary whose còn nợ equals the page Tổng nợ per party', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PayableListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findAllByText('NCC A');

    const mainCell = screen.getAllByText('NCC A')
      .map((el) => el.closest('td'))
      .find((td) => td?.dataset.label === 'Nhà cung cấp');
    expect(mainCell).toBeDefined();
    const tongNo = mainCell!.closest('tr')!.querySelector('td[data-label="Tổng nợ"]')!.textContent;
    expect(tongNo).toBe('12.000.000 ₫');

    const summaryCell = screen.getAllByText('NCC A')
      .map((el) => el.closest('td'))
      .find((td) => td?.dataset.label === 'Chủ xe');
    expect(summaryCell).toBeDefined();
    const conNo = summaryCell!.closest('tr')!.querySelector('td[data-label="Còn nợ"]')!.textContent;
    expect(conNo).toBe(tongNo);
  });
});
