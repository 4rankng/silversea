import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCustomerAging = vi.fn();
const getBlob = vi.fn();

vi.mock('../api/financialClient', () => ({
  financialClient: { getCustomerAging: (...args: unknown[]) => getCustomerAging(...args) },
}));

vi.mock('../lib/api', () => ({
  api: { getBlob: (...args: unknown[]) => getBlob(...args) },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useListAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters: vi.fn() }),
}));

vi.mock('../hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => true,
}));

import DebtListPage from './DebtListPage';

function customer(id: number, name: string, totalOutstanding: number) {
  return {
    customerId: id,
    customerName: name,
    contactInfo: null,
    linkedSupplierId: null,
    linkedSupplierApBalance: 0,
    netBalance: totalOutstanding,
    totalOutstanding,
    aging: { current: totalOutstanding, d30: 0, d60: 0, over90: 0 },
    maxOverdueDays: 0,
  };
}

const emptyTotals = {
  total: 0, current: 0, d30: 0, d60: 0, over90: 0,
  currentCusts: 0, d30Custs: 0, d60Custs: 0, over90Custs: 0,
  overdueCount: 0, highRiskCount: 0,
};

// total 30 with limit 25 → two pages, so a page-2 visit is observable.
const envelope = {
  customers: [customer(1, 'Công ty A', 12_000_000), customer(2, 'Công ty B', 8_000_000)],
  page: 1,
  limit: 25,
  total: 30,
  totalPages: 2,
  totals: emptyTotals,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DebtListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastCallParams() {
  const calls = getCustomerAging.mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  getCustomerAging.mockReset().mockResolvedValue(envelope);
  getBlob.mockReset();
});

describe('DebtListPage server-side column sorting', () => {
  it('loads without sort params and marks every column header unsorted', async () => {
    renderPage();
    expect((await screen.findAllByText('Công ty A')).length).toBeGreaterThan(0);

    expect(lastCallParams()).toMatchObject({ page: 1, limit: 25 });
    expect(lastCallParams()?.sortBy).toBeUndefined();
    expect(lastCallParams()?.sortDir).toBeUndefined();
    for (const name of ['Khách hàng', 'Tổng nợ', 'Net công nợ', 'Quá hạn']) {
      expect(screen.getByRole('columnheader', { name }).getAttribute('aria-sort')).toBe('none');
    }
  });

  it('sends sortBy/sortDir on header clicks, toggles asc → desc, and tracks aria-sort', async () => {
    renderPage();
    expect((await screen.findAllByText('Công ty A')).length).toBeGreaterThan(0);

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

    // A different column starts fresh ascending.
    fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({
      sortBy: 'customerName', sortDir: 'asc',
    }));
  });

  it('resets to page 1 when a sort is engaged from a later page', async () => {
    renderPage();
    expect((await screen.findAllByText('Công ty A')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ page: 2 }));

    fireEvent.click(screen.getByRole('button', { name: 'Quá hạn' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({
      sortBy: 'maxOverdueDays', sortDir: 'asc', page: 1,
    }));
  });
});
