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

const downloadCSV = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock('../lib/csv', () => ({ downloadCSV }));
vi.mock('../components/shared/Toast', () => ({ useToast: () => ({ toast }) }));

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
    for (const name of ['Nhà cung cấp', 'Tổng nợ', 'Chưa đến hạn', 'Quá hạn 1-30', 'Quá hạn 31-90', 'Quá hạn >90']) {
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
    fireEvent.click(screen.getByRole('button', { name: 'Quá hạn 1-30' }));
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

describe('PayableListPage export feedback (card 071026141590)', () => {
  beforeEach(() => {
    downloadCSV.mockReset().mockResolvedValue(undefined);
    toast.mockReset();
  });

  it('the Xuất báo cáo button reports busy, then toasts success per the export contract', async () => {
    const { fireEvent, waitFor } = await import('@testing-library/react');
    const { default: PayableListPage } = await import('./PayableListPage');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { MemoryRouter } = await import('react-router-dom');
    const { render, screen } = await import('@testing-library/react');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let resolveCsv: () => void = () => {};
    downloadCSV.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveCsv = resolve; }));
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PayableListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const btn = await screen.findByRole('button', { name: /Xuất báo cáo/ });
    fireEvent.click(btn);
    // Busy label while the file builds (FinancePage export contract).
    expect(await screen.findByRole('button', { name: /Đang xuất…/ })).toBeTruthy();
    resolveCsv();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' })));
    await waitFor(() => expect(screen.getByRole('button', { name: /Xuất báo cáo/ })).toBeTruthy());
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Card 071026141620 — the summary rail's labels must ALWAYS carry a value: an
// em dash while the query is unsettled (the accounting rail's contract), real
// numbers once loaded, and a real 0 when the set is empty. The QA finding
// ("labels render without values") is exactly the state this contract rules
// out. Merged into this file after a careless whole-file overwrite of the
// suites above (restored verbatim); tests drive the same API seam as the rest.
describe('PayableListPage summary rail values (card 071026141620)', () => {
  function renderRail() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PayableListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  function railValues(): string[] {
    const rail = screen.getByRole('region', { name: 'Tóm tắt công nợ phải trả' });
    return [...rail.querySelectorAll('dd')].map((dd) => dd.textContent ?? '');
  }

  beforeEach(() => {
    listTripsMock.mockReset().mockResolvedValue({ items: [] });
    getPhoiPhieuReportMock.mockReset().mockResolvedValue({ rows: [], grand: null });
  });

  it('shows an em dash on every label while loading — never a blank, never a fake 0', () => {
    getPayablesSummaryMock.mockReset().mockReturnValue(new Promise(() => {}));
    renderRail();
    expect(railValues()).toEqual(['—', '—', '—']);
  });

  it('shows an em dash on every label when the query failed, with the error stated', async () => {
    getPayablesSummaryMock.mockReset().mockRejectedValue(new Error('mất kết nối máy chủ'));
    renderRail();
    await screen.findByText('mất kết nối máy chủ');
    expect(railValues()).toEqual(['—', '—', '—']);
  });

  it('shows real numbers once loaded', async () => {
    getPayablesSummaryMock.mockReset().mockResolvedValue({
      items: [],
      totalOutstanding: '42051910',
      totalSuppliers: 8,
      overdueSuppliers: 3,
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 1,
      totals: { current: 0, d30: 0, d60: 0, over90: 0, currentCount: 0, d30Count: 0, d60Count: 0, over90Count: 0 },
    });
    renderRail();
    await waitFor(() => expect(railValues()[1]).toBe('8'));
    expect(railValues()[2]).toBe('3');
    expect(railValues()[0]).toContain('42');
  });

  it('shows a real 0 (not a dash, not a blank) for a loaded empty set', async () => {
    getPayablesSummaryMock.mockReset().mockResolvedValue({
      items: [],
      totalOutstanding: '0',
      totalSuppliers: 0,
      overdueSuppliers: 0,
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 1,
      totals: { current: 0, d30: 0, d60: 0, over90: 0, currentCount: 0, d30Count: 0, d60Count: 0, over90Count: 0 },
    });
    renderRail();
    await waitFor(() => expect(railValues()[1]).toBe('0'));
    expect(railValues().slice(1)).toEqual(['0', '0']);
  });
});
