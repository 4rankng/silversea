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
const getPhoiPhieuReport = vi.hoisted(() => vi.fn());

vi.mock('../api/financialClient', () => ({
  financialClient: { getCustomerAging: (...args: unknown[]) => getCustomerAging(...args) },
}));

// Card 380 — the monthly production summary section fetches the phoi-phieu
// period reports; the page tests mock it so the section renders without it.
vi.mock('../api/phoiPhieuClient', () => ({
  getPhoiPhieuReport: (...args: unknown[]) => getPhoiPhieuReport(...args),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 7, role: 'ACCOUNTANT' } }),
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
  // The card-380 summary section fetches the same endpoint with limit 500 for
  // its còn-nợ join; those calls are not the page's own paging behaviour.
  const calls = getCustomerAging.mock.calls.filter(
    (call) => (call[0] as { limit?: number } | undefined)?.limit !== 500,
  );
  return calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
}

const summaryReportEnvelope = {
  rows: [
    { party: 'Công ty A', soLuong: 2, tongPhaiThuTra: 5_000_000, daThuTra: 1_000_000, conLai: 4_000_000 },
    { party: 'Công ty B', soLuong: 1, tongPhaiThuTra: 2_000_000, daThuTra: 0, conLai: 2_000_000 },
  ],
  grand: { party: 'TỔNG CỘNG', soLuong: 3, tongPhaiThuTra: 7_000_000, daThuTra: 1_000_000, conLai: 6_000_000 },
};

const emptyReportEnvelope = { rows: [], grand: null };

beforeEach(() => {
  getCustomerAging.mockReset().mockResolvedValue(envelope);
  getBlob.mockReset();
  getPhoiPhieuReport.mockReset().mockResolvedValue(emptyReportEnvelope);
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

// Card 380 — the monthly production summary rides this page for /debt: its
// còn-nợ column must print the SAME number the ledger table prints as Tổng nợ
// for the same party (same endpoint, same field — month-close reconciliation).
describe('DebtListPage monthly production summary (card 380)', () => {
  beforeEach(() => {
    getCustomerAging.mockReset().mockResolvedValue(envelope);
    getPhoiPhieuReport.mockReset().mockImplementation((kind: string) => {
      if (kind === 'THU') return Promise.resolve(summaryReportEnvelope);
      return Promise.resolve(emptyReportEnvelope);
    });
  });

  it('renders the summary whose còn nợ equals the page Tổng nợ per party', async () => {
    renderPage();
    await screen.findAllByText('Công ty A');

    const mainCell = screen.getAllByText('Công ty A')
      .map((el) => el.closest('td'))
      .find((td) => td?.dataset.label === 'Khách hàng');
    expect(mainCell).toBeDefined();
    const tongNo = mainCell!.closest('tr')!.querySelector('td[data-label="Tổng nợ"]')!.textContent;
    expect(tongNo).toBe('12.000.000 ₫');

    const summaryCell = screen.getAllByText('Công ty A')
      .map((el) => el.closest('td'))
      .find((td) => td?.dataset.label === 'Chủ xe');
    expect(summaryCell).toBeDefined();
    const conNo = summaryCell!.closest('tr')!.querySelector('td[data-label="Còn nợ"]')!.textContent;
    expect(conNo).toBe(tongNo);
  });

  it('keeps every Lập Phiếu button disabled with the gap reason', async () => {
    renderPage();
    await screen.findAllByText('Công ty A');

    const buttons = screen.getAllByRole('button', { name: /Lập phiếu cho/ });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute('title')).toContain('chưa có');
    }
  });

  it('renders the month totals band with the VAT gap named', async () => {
    renderPage();
    await screen.findAllByText('Công ty A');

    const vatNote = screen.getByText(/Tổng hợp công nợ theo tháng/);
    expect(vatNote.textContent).toContain('Phải thu: 7.000.000 ₫');
    expect(vatNote.textContent).toContain('VAT: —');
  });
});
