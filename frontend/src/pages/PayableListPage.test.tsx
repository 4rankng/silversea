import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PayableListPage from './PayableListPage';

/**
 * Card 071026141620 — the /payables summary block's labels must ALWAYS carry
 * a value: an em dash while the query is unsettled (the accounting rail's
 * contract), real numbers once loaded, and a real 0 when the set is empty.
 * The QA finding ("labels render without values") is exactly the state this
 * contract rules out.
 */
const { tableStateMock, usePostCommissionMock, useCatalogsMock, useAuthMock, useToastMock } = vi.hoisted(() => ({
  tableStateMock: vi.fn(),
  usePostCommissionMock: vi.fn(),
  useCatalogsMock: vi.fn(),
  useAuthMock: vi.fn(),
  useToastMock: vi.fn(),
}));

vi.mock('../design-system/hooks/useTableQueryState', () => ({ useTableQueryState: tableStateMock }));
vi.mock('../hooks/useQueries', () => ({ usePostCommission: usePostCommissionMock }));
vi.mock('../hooks/useCatalogs', () => ({ useCatalogs: useCatalogsMock }));
vi.mock('../hooks/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('../components/shared/Toast', () => ({ useToast: () => ({ toast: useToastMock }) }));
vi.mock('../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }));
vi.mock('../features/accounting/PartyMonthlyProductionSummary', () => ({ PartyMonthlyProductionSummary: () => null }));
vi.mock('./payables-fuel-invoices', () => ({ FuelInvoicesPanel: () => null }));

type TableStateArgs = { isLoading: boolean; data?: Record<string, unknown>; error?: Error | null };

function tableState({ isLoading, data, error = null }: TableStateArgs) {
  tableStateMock.mockReturnValue({
    search: '',
    setSearch: vi.fn(),
    page: 1,
    setPage: vi.fn(),
    filters: {},
    setFilter: vi.fn(),
    isLoading,
    query: { data, error },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/payables']}>
      <QueryClientProvider client={client}>
        <PayableListPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function railValues(): string[] {
  const rail = screen.getByRole('region', { name: 'Tóm tắt công nợ phải trả' });
  return [...rail.querySelectorAll('dd')].map((dd) => dd.textContent ?? '');
}

beforeEach(() => {
  usePostCommissionMock.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
  useCatalogsMock.mockReturnValue({ data: undefined, isLoading: false });
  useAuthMock.mockReturnValue({ user: { role: 'ACCOUNTANT', id: 1 } });
});

describe('payables summary rail (card 071026141620)', () => {
  it('shows an em dash on every label while loading — never a blank, never a fake 0', () => {
    tableState({ isLoading: true });
    renderPage();
    expect(railValues()).toEqual(['—', '—', '—']);
  });

  it('shows an em dash on every label when the query failed, with the error stated', () => {
    tableState({ isLoading: false, error: new Error('mất kết nối máy chủ') });
    renderPage();
    expect(railValues()).toEqual(['—', '—', '—']);
    expect(screen.getByText('mất kết nối máy chủ')).toBeTruthy();
  });

  it('shows real numbers once loaded', () => {
    tableState({
      isLoading: false,
      data: {
        items: [],
        totalOutstanding: '42051910',
        totalSuppliers: 8,
        overdueSuppliers: 3,
        page: 1,
        limit: 25,
        total: 0,
        totalPages: 1,
        totals: { current: 0, d30: 0, d60: 0, over90: 0, currentCount: 0, d30Count: 0, d60Count: 0, over90Count: 0 },
      },
    });
    renderPage();
    const values = railValues();
    expect(values[1]).toBe('8');
    expect(values[2]).toBe('3');
    expect(values[0]).toContain('42');
  });

  it('shows a real 0 (not a dash, not a blank) for a loaded empty set', () => {
    tableState({
      isLoading: false,
      data: {
        items: [],
        totalOutstanding: '0',
        totalSuppliers: 0,
        overdueSuppliers: 0,
        page: 1,
        limit: 25,
        total: 0,
        totalPages: 1,
        totals: { current: 0, d30: 0, d60: 0, over90: 0, currentCount: 0, d30Count: 0, d60Count: 0, over90Count: 0 },
      },
    });
    renderPage();
    expect(railValues().slice(1)).toEqual(['0', '0']);
  });
});
