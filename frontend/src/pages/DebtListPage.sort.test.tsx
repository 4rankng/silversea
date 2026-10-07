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
  it('shows the net figure for a customer that has no linked supplier (card 071026211110)', async () => {
    // The backend always computes netBalance — aging.service.ts:685 subtracts the
    // linked supplier's AP balance from the receivable, and that balance is 0 when
    // no supplier is linked, so netBalance === totalOutstanding for these rows.
    // This page's OWN export (/reports/receivables-aging/export) writes that same
    // number for every row (statement-customer.service.ts:483). Showing an em dash
    // here made the screen and the export disagree about the same customer, and
    // hid exactly the overdue balances an accountant reads this page for.
    const unlinked = {
      ...customer(3, 'Chưa liên kết NCC', 4_200_000),
      linkedSupplierId: null,
      linkedSupplierApBalance: 0,
      netBalance: 4_200_000,
      maxOverdueDays: 27,
    };
    getCustomerAging.mockResolvedValue({
      ...envelope,
      customers: [customer(1, 'Công ty A', 12_000_000), unlinked],
      total: 2,
      totalPages: 1,
    });

    renderPage();
    expect((await screen.findAllByText('Chưa liên kết NCC')).length).toBeGreaterThan(0);

    // The customer name also appears in the risk card, so pick the cell inside
    // the table row rather than the first text match on the page.
    const netCell = [...document.querySelectorAll('td[data-label="Net công nợ"]')]
      .find((c) => c.closest('tr')?.textContent?.includes('Chưa liên kết NCC'));
    expect(netCell).toBeTruthy();
    expect(netCell?.textContent).not.toBe('—');
    expect(netCell?.textContent).toContain('4.200.000');
  });

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
