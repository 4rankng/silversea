/**
 * Card 369 (REQ-5.10-01) — "Tổng quát về tiền" on the accounting overview:
 * the two due-group debt cards (amounts, exact Tổng identity, per-group count
 * drill-down links, as-of + Tải lại footer) and the weekly container-deposit
 * chart block. The two drill-down targets (/debt and /payables ?filter=) are
 * pinned through the real pages because those URLs are this card's only
 * navigation contract.
 *
 * The chart module is stubbed at the boundary: this file owns the contract
 * (the block mounts the chart with the queried weeks), while the chart's own
 * rendering is covered by its component tests.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const getCustomerAging = vi.hoisted(() => vi.fn());
const getPayablesSummary = vi.hoisted(() => vi.fn());
const listTrips = vi.hoisted(() => vi.fn());

vi.mock('../../api/financialClient', () => ({
  financialClient: {
    getCustomerAging: (...args: unknown[]) => getCustomerAging(...args),
    getPayablesSummary: (...args: unknown[]) => getPayablesSummary(...args),
  },
}));

vi.mock('../../api/tripClient', () => ({
  tripClient: { listTrips: (...args: unknown[]) => listTrips(...args) },
}));

vi.mock('../../pages/payables-fuel-invoices', () => ({
  FuelInvoicesPanel: () => null,
}));

vi.mock('../../hooks/useCatalogs', () => ({
  useCatalogs: () => ({ data: { suppliers: [] } }),
}));

vi.mock('../../hooks/useQueries', () => ({
  usePostCommission: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 1, role: 'ACCOUNTANT' } }),
}));

vi.mock('../../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useListAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters: vi.fn() }),
}));

vi.mock('../../hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => true,
}));

vi.mock('../../components/charts/DepositWeeklyChart', () => ({
  DepositWeeklyChart: ({ weeks }: { weeks: Array<{ label: string }> }) => (
    <div data-testid="deposit-weekly-chart" data-weeks={weeks.map((week) => week.label).join(',')} />
  ),
}));

// Card 370 — stubbed at the boundary like the deposit chart: this file owns
// the block contract (the queried groups reach the chart), the chart's own
// rendering is covered by its component tests.
vi.mock('../../components/charts/DueDebtBarChart', () => ({
  DueDebtBarChart: ({ groups }: { groups: Array<{ key: string; label: string }> }) => (
    <div data-testid="due-debt-bar-chart" data-groups={groups.map((group) => group.key).join(',')} />
  ),
}));

import { AccountingOverview } from './AccountingOverview';
import DebtListPage from '../../pages/DebtListPage';
import PayableListPage from '../../pages/PayableListPage';
import { routes } from '../../lib/routes';
import type {
  DepositWeeklySummary,
  MoneyAlertsSummary,
  PayablesSummary,
  ProfitabilitySummary,
  ReceivablesSummary,
} from './accountingWorkspaceTypes';

/* ─── Fixtures ─────────────────────────────────────────────────────────────── */

// 2026-10-05T07:45Z = 14:45 Vietnam wall-clock — the app's display timezone.
const AS_OF_MS = Date.parse('2026-10-05T07:45:00.000Z');

const receivablesData: ReceivablesSummary = {
  buckets: [
    { range: '0-30', label: 'Trong hạn', count: 5, amount: 30_000_000 },
    { range: '31-60', label: '31-60 ngày', count: 3, amount: 20_000_000 },
  ],
  totalOutstanding: 50_000_000,
  totalCustomers: 8,
  overdueCustomers: 3,
  overdueAmount: 20_000_000,
  dueGroups: {
    inTerm: { amount: 30_000_000, count: 5 },
    overdue: { amount: 20_000_000, count: 3 },
  },
};

const payablesData: PayablesSummary = {
  totalOutstanding: '19000000',
  totalSuppliers: 30,
  overdueSuppliers: 2,
  dueGroups: {
    inTerm: { amount: 12_000_000, count: 4 },
    overdue: { amount: 7_000_000, count: 2 },
  },
};

const profitabilityData: ProfitabilitySummary = {
  totals: { revenue: 200_000_000, directCost: 120_000_000, sharedOverhead: 50_000_000, profit: 30_000_000 },
  reconciliation: { status: 'RECONCILED', note: '' },
  sourceCoverage: { missingAttribution: 1 },
  asOf: '2026-10-05',
};

const depositWeeklyData: DepositWeeklySummary = {
  weeks: [
    { weekStart: '2026-09-28', label: 'Tuần 28/09', count: 3, depositAmount: 30_000_000, refundedAmount: 10_000_000 },
    { weekStart: '2026-10-05', label: 'Tuần 05/10', count: 1, depositAmount: 5_000_000, refundedAmount: 0 },
  ],
  totals: { count: 4, depositAmount: 35_000_000, refundedAmount: 10_000_000 },
};

// The money-alerts snapshot is its own request with its own response time
// (15:15 Vietnam) — pinned separately from AS_OF_MS so the default render
// keeps exactly the two card-369 'Số liệu tính đến 14:45' footers.
const MONEY_AS_OF_MS = Date.parse('2026-10-05T08:15:00.000Z');

const moneyAlertsData: MoneyAlertsSummary = {
  funds: { tm: 12_000_000, company: 34_000_000, reserve: 21_000_000 },
  dueDebtGroups: [
    { key: 'dueSoon5d', label: 'Sắp đến hạn (≤ 5 ngày)', amount: 25_000_000, customers: 4 },
    { key: 'overdue1to10', label: 'Quá hạn 1–10 ngày', amount: 9_000_000, customers: 2 },
    { key: 'overdue11to30', label: 'Quá hạn 30 ngày', amount: 6_000_000, customers: 1 },
    { key: 'overdue30plus', label: 'Quá hạn 60 ngày', amount: 5_000_000, customers: 1 },
  ],
  unrefundedDeposits: { count: 3, amount: 30_000_000 },
  // The contract pins this to the receivables dueGroups.overdue row totals —
  // same rows as the card-369 'Quá hạn' line (20M over 3 customers).
  overdueDebt: { customers: 3, amount: 20_000_000 },
  fundNegative: false,
};

/* ─── Harness ─────────────────────────────────────────────────────────────── */

// The component reads data, dataUpdatedAt and refetch off each query result;
// the cast keeps the fixture honest without reproducing react-query's whole
// UseQueryResult surface.
function queryResult<T>(
  data: T | undefined,
  dataUpdatedAt: number,
  refetch: Mock,
  state: { isLoading?: boolean; isError?: boolean; data?: undefined } = {},
) {
  return {
    data,
    isLoading: false,
    isError: false,
    dataUpdatedAt,
    refetch,
    ...state,
  } as unknown as UseQueryResult<T, Error>;
}

function renderOverview(
  receivables: ReceivablesSummary = receivablesData,
  payables: PayablesSummary = payablesData,
  moneyAlerts: MoneyAlertsSummary = moneyAlertsData,
  moneyAlertsUpdatedAt: number = MONEY_AS_OF_MS,
) {
  const refetchReceivables = vi.fn();
  const refetchPayables = vi.fn();
  const refetchMoneyAlerts = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/accounting']}>
        <AccountingOverview
          to="2026-10-05"
          transportViewHref="/accounting?view=transport"
          receivables={queryResult(receivables, AS_OF_MS, refetchReceivables)}
          payables={queryResult(payables, AS_OF_MS, refetchPayables)}
          depositWeekly={queryResult(depositWeeklyData, AS_OF_MS, vi.fn())}
          moneyAlerts={queryResult(moneyAlerts, moneyAlertsUpdatedAt, refetchMoneyAlerts)}
          profitability={queryResult(profitabilityData, AS_OF_MS, vi.fn())}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, refetchReceivables, refetchPayables, refetchMoneyAlerts };
}

function renderPage(element: ReactElement, entry: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function dueCard(title: string) {
  return screen.getByText(title).closest('section') as HTMLElement;
}

function groupRow(card: HTMLElement, label: string) {
  return within(card).getByText(label).closest('div') as HTMLElement;
}

/** Displayed VND string → integer, for the identity check "as displayed". */
function vnd(text: string | null | undefined): number {
  return Number((text ?? '').replace(/\D/g, ''));
}

/* ─── Overview: the two due-group cards ───────────────────────────────────── */

describe('AccountingOverview — Tổng quát về tiền (card 369)', () => {
  it('renders both cards with the exact Tổng = Quá hạn + Trong hạn identity as displayed', () => {
    renderOverview();

    for (const [title, total, overdue, inTerm] of [
      ['Nợ phải thu theo hạn nợ', '50.000.000 ₫', '20.000.000 ₫', '30.000.000 ₫'],
      ['Nợ phải trả theo hạn nợ', '19.000.000 ₫', '7.000.000 ₫', '12.000.000 ₫'],
    ] as const) {
      const card = dueCard(title);
      const totalRow = groupRow(card, 'Tổng');
      const overdueRow = groupRow(card, 'Quá hạn');
      const inTermRow = groupRow(card, 'Trong hạn');

      // Values are formatCurrency over the rounded dueGroups amounts, and
      // Tổng is the displayed sum of the two groups.
      expect(within(totalRow).getByText(total)).toBeInTheDocument();
      expect(within(overdueRow).getByText(overdue)).toBeInTheDocument();
      expect(within(inTermRow).getByText(inTerm)).toBeInTheDocument();
      expect(vnd(total)).toBe(vnd(overdue) + vnd(inTerm));
    }

    // Bar widths come from the two amounts (30M + 20M → 60/40 split).
    const bar = dueCard('Nợ phải thu theo hạn nợ').querySelector('.accounting-due-card__bar') as HTMLElement;
    expect(bar.querySelector('.accounting-due-card__bar-in-term')?.getAttribute('style')).toContain('width: 60%');
    expect(bar.querySelector('.accounting-due-card__bar-overdue')?.getAttribute('style')).toContain('width: 40%');
  });

  it('guards the bar split against a divide-by-zero when both groups are empty', () => {
    renderOverview(
      { ...receivablesData, dueGroups: { inTerm: { amount: 0, count: 0 }, overdue: { amount: 0, count: 0 } } },
      { ...payablesData, dueGroups: { inTerm: { amount: 0, count: 0 }, overdue: { amount: 0, count: 0 } } },
    );

    const bar = dueCard('Nợ phải thu theo hạn nợ').querySelector('.accounting-due-card__bar') as HTMLElement;
    expect(bar.querySelector('.accounting-due-card__bar-in-term')?.getAttribute('style')).toContain('width: 0%');
    expect(bar.querySelector('.accounting-due-card__bar-overdue')?.getAttribute('style')).toContain('width: 0%');
    expect(bar.innerHTML).not.toContain('NaN');
  });

  it('gives every group its own count link to the matching filtered list', () => {
    renderOverview();

    const receivablesCard = dueCard('Nợ phải thu theo hạn nợ');
    const receivablesOverdue = within(receivablesCard).getByRole('link', { name: /Số lượng: 3/ });
    const receivablesInTerm = within(receivablesCard).getByRole('link', { name: /Số lượng: 5/ });
    expect(receivablesOverdue.getAttribute('href')).toBe(`${routes.debt}?filter=overdue&asOf=2026-10-05`);
    expect(receivablesInTerm.getAttribute('href')).toBe(`${routes.debt}?filter=current&asOf=2026-10-05`);
    // Receivables counts are customers.
    expect(receivablesOverdue.textContent).toContain('khách hàng');

    const payablesCard = dueCard('Nợ phải trả theo hạn nợ');
    const payablesOverdue = within(payablesCard).getByRole('link', { name: /Số lượng: 2/ });
    const payablesInTerm = within(payablesCard).getByRole('link', { name: /Số lượng: 4/ });
    expect(payablesOverdue.getAttribute('href')).toBe(`${routes.payables}?filter=overdue&asOf=2026-10-05`);
    expect(payablesInTerm.getAttribute('href')).toBe(`${routes.payables}?filter=current&asOf=2026-10-05`);
    // Payables counts are suppliers/carriers — entities, never "khách hàng".
    expect(payablesOverdue.textContent).toContain('nhà cung cấp / nhà xe');
    expect(payablesInTerm.textContent).not.toContain('khách hàng');
  });

  it("refetches only the card's own summary when 'Tải lại' is pressed", () => {
    const { refetchReceivables, refetchPayables } = renderOverview();

    fireEvent.click(within(dueCard('Nợ phải thu theo hạn nợ')).getByRole('button', { name: 'Tải lại' }));
    expect(refetchReceivables).toHaveBeenCalledTimes(1);
    expect(refetchPayables).not.toHaveBeenCalled();

    fireEvent.click(within(dueCard('Nợ phải trả theo hạn nợ')).getByRole('button', { name: 'Tải lại' }));
    expect(refetchPayables).toHaveBeenCalledTimes(1);
    expect(refetchReceivables).toHaveBeenCalledTimes(1);
  });

  it("renders 'Số liệu tính đến HH:MM' from each query's dataUpdatedAt", () => {
    renderOverview();
    expect(screen.getAllByText('Số liệu tính đến 14:45')).toHaveLength(2);
  });

  it('keeps every pre-existing summary rail item', () => {
    renderOverview();
    const rail = screen.getByRole('region', { name: 'Chỉ số kế toán' });
    for (const label of [
      'Phải thu',
      'Khách hàng',
      'Quá hạn',
      'Phải trả',
      'Nhà cung cấp / nhà xe',
      'Lợi nhuận kỳ',
    ]) {
      expect(within(rail).getByText(label)).toBeInTheDocument();
    }
  });

  it('mounts the container-deposit chart block with the queried weeks', () => {
    renderOverview();
    expect(screen.getByText('Biểu đồ cột cược container theo tuần')).toBeInTheDocument();
    expect(screen.getByTestId('deposit-weekly-chart').getAttribute('data-weeks')).toBe('Tuần 28/09,Tuần 05/10');
  });
});

/* ─── Overview: fund notice, due-debt chart, alert strips (card 370) ─────── */

describe('AccountingOverview — cảnh báo quỹ và công nợ (card 370)', () => {
  it('renders the fund quick-notice with both balances, the reserve line and its own as-of footer', () => {
    const { refetchMoneyAlerts } = renderOverview(
      receivablesData,
      payablesData,
      moneyAlertsData,
      AS_OF_MS,
    );

    const card = screen.getByText('Thông báo Quỹ').closest('section') as HTMLElement;
    expect(within(card).getByText('Quỹ TM')).toBeInTheDocument();
    expect(within(card).getByText('12.000.000 ₫')).toBeInTheDocument();
    expect(within(card).getByText('Quỹ công ty')).toBeInTheDocument();
    expect(within(card).getByText('34.000.000 ₫')).toBeInTheDocument();
    expect(within(card).getByText('Dự phòng dòng tiền')).toBeInTheDocument();
    expect(within(card).getByText('21.000.000 ₫')).toBeInTheDocument();

    // Same footer contract as the debt cards: its Tải lại refetches only the
    // money-alerts snapshot.
    expect(within(card).getByText('Số liệu tính đến 14:45')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Tải lại' }));
    expect(refetchMoneyAlerts).toHaveBeenCalledTimes(1);
  });

  it('mounts the due-debt chart block with the queried groups', () => {
    renderOverview();
    expect(screen.getByText('Cảnh báo nợ đến hạn / quá hạn')).toBeInTheDocument();
    expect(screen.getByTestId('due-debt-bar-chart').getAttribute('data-groups'))
      .toBe('dueSoon5d,overdue1to10,overdue11to30,overdue30plus');
  });

  it('renders the deposit and overdue alert strips with their counts and amounts', () => {
    renderOverview();
    expect(screen.getByText('Container chưa hoàn cược')).toBeInTheDocument();
    expect(screen.getByText('Số lượng: 3 · Tổng tiền: 30.000.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('Nợ quá hạn')).toBeInTheDocument();
    // Pinned to the receivables dueGroups.overdue totals (3 khách / 20M).
    expect(screen.getByText('Số khách: 3 · Tổng tiền: 20.000.000 ₫')).toBeInTheDocument();
  });

  it("keeps the 'Quỹ âm' strip out of the DOM while fundNegative is false", () => {
    renderOverview(receivablesData, payablesData, { ...moneyAlertsData, fundNegative: false });
    expect(screen.queryByText('Quỹ âm')).not.toBeInTheDocument();
    expect(screen.queryByText('Cả hai quỹ đều âm — cần bổ sung dòng tiền ngay')).not.toBeInTheDocument();
  });

  it("renders the 'Quỹ âm' strip when fundNegative is true", () => {
    renderOverview(receivablesData, payablesData, { ...moneyAlertsData, fundNegative: true });
    expect(screen.getByText('Quỹ âm')).toBeInTheDocument();
    expect(screen.getByText('Cả hai quỹ đều âm — cần bổ sung dòng tiền ngay')).toBeInTheDocument();
  });
});

/* ─── Drill-down targets ──────────────────────────────────────────────────── */

describe('overview drill-down links initialize the bucket filter', () => {
  const debtCustomer = (id: number, name: string, totalOutstanding: number) => ({
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

  const debtEnvelope = {
    customers: [debtCustomer(1, 'Công ty A', 12_000_000)],
    page: 1,
    limit: 25,
    total: 1,
    totalPages: 1,
    totals: {
      total: 0, current: 0, d30: 0, d60: 0, over90: 0,
      currentCusts: 0, d30Custs: 0, d60Custs: 0, over90Custs: 0,
      overdueCount: 0, highRiskCount: 0,
    },
  };

  const payablesEnvelope = {
    items: [{
      supplier: {
        id: 1, name: 'NCC A', contactPerson: null, phone: null, taxCode: null, note: null,
        status: 'ACTIVE', linkedCustomerId: null, isFuelSupplier: false,
        createdAt: '', updatedAt: '', deletedAt: null,
      },
      totalOutstanding: 12_000_000,
      aging: { current: 12_000_000, d30: 0, d60: 0, over90: 0 },
      maxOverdueDays: 0,
      kind: 'vendor' as const,
    }],
    totalOutstanding: '12000000',
    totalSuppliers: 1,
    overdueSuppliers: 0,
    page: 1,
    limit: 25,
    total: 1,
    totalPages: 1,
    totals: {
      current: 12_000_000, d30: 0, d60: 0, over90: 0,
      currentCount: 1, d30Count: 0, d60Count: 0, over90Count: 0,
    },
  };

  beforeEach(() => {
    getCustomerAging.mockReset().mockResolvedValue(debtEnvelope);
    getPayablesSummary.mockReset().mockResolvedValue(payablesEnvelope);
    listTrips.mockReset().mockResolvedValue({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 });
  });

  it('/debt?filter=overdue&asOf= initializes the bucket and pins the snapshot date', async () => {
    renderPage(<DebtListPage />, '/debt?filter=overdue&asOf=2026-10-02');
    await screen.findAllByText('Công ty A');

    const calls = getCustomerAging.mock.calls;
    expect(calls[calls.length - 1]?.[0]).toMatchObject({ bucket: 'overdue', asOfDate: '2026-10-02' });
  });

  it('/payables?filter=overdue&asOf= passes bucket and snapshot date to the client', async () => {
    renderPage(<PayableListPage />, '/payables?filter=overdue&asOf=2026-10-02');
    await screen.findAllByText('NCC A');

    const calls = getPayablesSummary.mock.calls;
    expect(calls[calls.length - 1]?.[0]).toMatchObject({ bucket: 'overdue', asOfDate: '2026-10-02' });
  });
});

/* ─── Card 051026231511: the two count rails are drill-downs ──────────────── */

/**
 * SPEC 5.10 §A item 1 — "Khách hàng" and "Nhà cung cấp / nhà xe" were static
 * text. They now link into the list that owns each count, using the same
 * query-string convention the due-group cards use (`<path>?asOf=<date>`, both
 * list pages read `?filter=` and `?asOf=`).
 *
 * Both counts are the FULL set of debtors / payables, and both list pages only
 * accept *narrowing* filter values — so the links carry `?asOf=` (snapshot
 * parity) and deliberately omit `?filter=`: unfiltered IS the whole set.
 */
describe('AccountingOverview — count rails drill down (card 051026231511)', () => {
  const OVERVIEW_DATE = '2026-10-05';

  /** Same wiring as renderOverview, but able to pin loading/error state. */
  function renderOverviewWithState(
    receivables: { isLoading?: boolean; isError?: boolean; data?: undefined } = {},
    payables: { isLoading?: boolean; isError?: boolean; data?: undefined } = {},
  ) {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/accounting']}>
          <AccountingOverview
            to={OVERVIEW_DATE}
            transportViewHref="/accounting?view=transport"
            receivables={queryResult(receivablesData, AS_OF_MS, vi.fn(), receivables)}
            payables={queryResult(payablesData, AS_OF_MS, vi.fn(), payables)}
            depositWeekly={queryResult(depositWeeklyData, AS_OF_MS, vi.fn())}
            moneyAlerts={queryResult(moneyAlertsData, MONEY_AS_OF_MS, vi.fn())}
            profitability={queryResult(profitabilityData, AS_OF_MS, vi.fn())}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  /** The shared SummaryRail strip only — the page has other links below it. */
  function rail() {
    return screen.getByRole('region', { name: 'Chỉ số kế toán' });
  }

  function railRow(label: string) {
    return within(rail()).getByText(label).closest('.summary-rail__item') as HTMLElement;
  }

  it("makes 'Khách hàng' and 'Nhà cung cấp / nhà xe' real links", () => {
    renderOverviewWithState();

    const customers = within(rail()).getByRole('link', { name: /Khách hàng/ });
    const suppliers = within(rail()).getByRole('link', { name: /Nhà cung cấp \/ nhà xe/ });
    expect(customers.getAttribute('href')).toBe(`${routes.debt}?asOf=${OVERVIEW_DATE}`);
    expect(suppliers.getAttribute('href')).toBe(`${routes.payables}?asOf=${OVERVIEW_DATE}`);
    // The count still reads as the count, not just a label.
    expect(customers.querySelector('dd')?.textContent).toBe('8');
    expect(suppliers.querySelector('dd')?.textContent).toBe('30');
  });

  it('uses the due-group drill-down convention: the same list path, ?asOf= pinned, ?filter= omitted', () => {
    renderOverviewWithState();

    // Same base destinations the DueGroupCard links use…
    expect(railRow('Khách hàng').getAttribute('href'))
      .toMatch(new RegExp(`^${routes.debt}\\?`));
    expect(railRow('Nhà cung cấp / nhà xe').getAttribute('href'))
      .toMatch(new RegExp(`^${routes.payables}\\?`));
    // …and the same `?asOf=` param DueGroupCard builds.
    expect(railRow('Khách hàng').getAttribute('href')).toContain(`?asOf=${OVERVIEW_DATE}`);
    expect(railRow('Nhà cung cấp / nhà xe').getAttribute('href')).toContain(`?asOf=${OVERVIEW_DATE}`);
    // No narrowing value: both counts are the whole set, and neither list page
    // declares an "all" filter — omitting the param is the honest link.
    for (const label of ['Khách hàng', 'Nhà cung cấp / nhà xe']) {
      expect(railRow(label).getAttribute('href')).not.toContain('filter=');
    }
  });

  it('leaves the money rails (Phải thu / Quá hạn / Phải trả / Lợi nhuận kỳ) inert', () => {
    renderOverviewWithState();
    for (const label of ['Phải thu', 'Quá hạn', 'Phải trả', 'Lợi nhuận kỳ']) {
      expect(railRow(label).tagName).toBe('DIV');
    }
    expect(within(rail()).getAllByRole('link')).toHaveLength(2);
  });

  it('does not render a still-loading count as a working link', () => {
    renderOverviewWithState({ isLoading: true, data: undefined });
    expect(railRow('Khách hàng').textContent).toContain('—');
    expect(railRow('Khách hàng').tagName).toBe('DIV');
    expect(within(rail()).queryByRole('link', { name: /Khách hàng/ })).toBeNull();
    // The payable rail loaded fine, so its link is present.
    expect(railRow('Nhà cung cấp / nhà xe').tagName).toBe('A');
  });

  it('does not render a failed count as a working link either', () => {
    renderOverviewWithState({}, { isError: true, data: undefined });
    expect(railRow('Nhà cung cấp / nhà xe').textContent).toContain('—');
    expect(railRow('Nhà cung cấp / nhà xe').tagName).toBe('DIV');
    expect(within(rail()).queryByRole('link', { name: /Nhà cung cấp/ })).toBeNull();
    expect(railRow('Khách hàng').tagName).toBe('A');
  });

  it('lands on the FULL unfiltered list pinned to the workspace date, not a subset', async () => {
    getCustomerAging.mockReset().mockResolvedValue({
      customers: [], page: 1, limit: 25, total: 0, totalPages: 1,
      totals: {
        total: 0, current: 0, d30: 0, d60: 0, over90: 0,
        currentCusts: 0, d30Custs: 0, d60Custs: 0, over90Custs: 0,
        overdueCount: 0, highRiskCount: 0,
      },
    });
    getPayablesSummary.mockReset().mockResolvedValue({
      items: [], totalOutstanding: '0', totalSuppliers: 0, overdueSuppliers: 0,
      page: 1, limit: 25, total: 0, totalPages: 1,
      totals: { current: 0, d30: 0, d60: 0, over90: 0, currentCount: 0, d30Count: 0, d60Count: 0, over90Count: 0 },
    });
    listTrips.mockReset().mockResolvedValue({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 });

    // The exact href the overview renders…
    renderOverviewWithState();
    const href = railRow('Khách hàng').getAttribute('href') as string;
    expect(href).toBe(`${routes.debt}?asOf=${OVERVIEW_DATE}`);

    // …lands on /debt with NO bucket narrowing and the snapshot date pinned,
    // which is the row set `totalCustomers` was counted over.
    renderPage(<DebtListPage />, href);
    await waitFor(() => expect(getCustomerAging).toHaveBeenCalled());
    const debtCall = getCustomerAging.mock.calls.at(-1)?.[0];
    expect(debtCall).toMatchObject({ asOfDate: OVERVIEW_DATE });
    expect(debtCall?.bucket).toBeUndefined();
  });

  it('the suppliers href lands on /payables unfiltered and date-pinned', async () => {
    getCustomerAging.mockReset().mockResolvedValue({
      customers: [], page: 1, limit: 25, total: 0, totalPages: 1,
      totals: {
        total: 0, current: 0, d30: 0, d60: 0, over90: 0,
        currentCusts: 0, d30Custs: 0, d60Custs: 0, over90Custs: 0,
        overdueCount: 0, highRiskCount: 0,
      },
    });
    getPayablesSummary.mockReset().mockResolvedValue({
      items: [], totalOutstanding: '0', totalSuppliers: 0, overdueSuppliers: 0,
      page: 1, limit: 25, total: 0, totalPages: 1,
      totals: { current: 0, d30: 0, d60: 0, over90: 0, currentCount: 0, d30Count: 0, d60Count: 0, over90Count: 0 },
    });
    listTrips.mockReset().mockResolvedValue({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 });

    renderOverviewWithState();
    const href = railRow('Nhà cung cấp / nhà xe').getAttribute('href') as string;
    expect(href).toBe(`${routes.payables}?asOf=${OVERVIEW_DATE}`);

    renderPage(<PayableListPage />, href);
    await waitFor(() => expect(getPayablesSummary).toHaveBeenCalled());
    const payableCall = getPayablesSummary.mock.calls.at(-1)?.[0];
    expect(payableCall).toMatchObject({ asOfDate: OVERVIEW_DATE });
    expect(payableCall?.bucket).toBeUndefined();
  });
});
