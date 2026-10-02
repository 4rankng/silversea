/**
 * Card 20260927_152 — the `/debt` strip rides the shared `FilterBar` band.
 *
 * The page-local search shell (`.debt-filter-search`) and its chip row are gone,
 * so these pin the BEHAVIOUR they drove — the debounced `search` param and the
 * bucket filter the `Tất cả` chip clears — through the shared slot, not the
 * markup that used to carry it.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const customer = (id: number, name: string, totalOutstanding: number) => ({
  customerId: id,
  customerName: name,
  contactInfo: null,
  linkedSupplierId: null,
  linkedSupplierApBalance: 0,
  netBalance: totalOutstanding,
  totalOutstanding,
  aging: { current: totalOutstanding, d30: 0, d60: 0, over90: 0 },
  maxOverdueDays: 0,
});

const envelope = {
  customers: [customer(1, 'Công ty A', 12_000_000), customer(2, 'Công ty B', 8_000_000)],
  page: 1,
  limit: 25,
  total: 2,
  totalPages: 1,
  totals: {
    total: 0, current: 0, d30: 0, d60: 0, over90: 0,
    currentCusts: 0, d30Custs: 0, d60Custs: 0, over90Custs: 0,
    overdueCount: 0, highRiskCount: 0,
  },
};

function renderPage(entry = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
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

describe('DebtListPage filter strip', () => {
  it('renders the shared bar: search plus the one status chip, and no secondary dropdown', async () => {
    renderPage();
    await screen.findAllByText('Công ty A');

    const bar = document.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    expect(bar).not.toBeNull();

    const input = within(bar).getByRole('textbox', { name: 'Tìm công nợ theo khách hàng' });
    expect(input.getAttribute('name')).toBe('customerDebtSearch');
    expect(input.getAttribute('placeholder')).toBe('Tìm khách hàng...');

    const chip = within(bar).getByRole('button', { name: /Tất cả/ });
    expect(chip.className).toContain('filter-chip');
    expect(chip.textContent).toContain('2');
    // This surface has no secondary criterion, so no `Bộ lọc` trigger exists.
    expect(within(bar).queryByRole('button', { name: /^Bộ lọc/ })).toBeNull();
  });

  it('sends the typed search as the debounced `search` param and returns to page 1', async () => {
    renderPage();
    await screen.findAllByText('Công ty A');

    const input = screen.getByRole('textbox', { name: 'Tìm công nợ theo khách hàng' });
    fireEvent.change(input, { target: { value: 'Công ty B' } });

    await waitFor(() => expect(lastCallParams()).toMatchObject({ search: 'Công ty B', page: 1 }));
  });

  it('clears an active bucket filter when the `Tất cả` chip is pressed', async () => {
    renderPage('/?filter=d30');
    await screen.findAllByText('Công ty A');
    expect(lastCallParams()).toMatchObject({ bucket: 'd30' });

    fireEvent.click(screen.getByRole('button', { name: /Tất cả/ }));

    await waitFor(() => expect(lastCallParams()?.bucket).toBeUndefined());
  });
});
