import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/shared/Toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PnlReport } from '@tingting/shared';

const { usePnlReportMock, useYearlyPnlMock, useMonthlyTripsMock, useCapTableMock } = vi.hoisted(() => ({
  usePnlReportMock: vi.fn(),
  useYearlyPnlMock: vi.fn(),
  useMonthlyTripsMock: vi.fn(),
  useCapTableMock: vi.fn(),
}));

vi.mock('../hooks/useQueries', () => ({
  usePnlReport: usePnlReportMock,
  useYearlyPnl: useYearlyPnlMock,
  useMonthlyTrips: useMonthlyTripsMock,
  useCapTable: useCapTableMock,
}));

vi.mock('../hooks/useMonth', () => ({
  useMonth: () => ({ month: 7, year: 2026 }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters: vi.fn() }),
}));

vi.mock('../hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => true,
}));

vi.mock('../components/charts/RevenueTrendChart', () => ({
  RevenueTrendChart: () => null,
}));

vi.mock('../components/shared/Breadcrumbs', () => ({
  Breadcrumbs: () => null,
}));

vi.mock('../components/AssetIcon', () => ({
  AssetIcon: () => null,
}));

import FinancePage from './FinancePage';

function pnlTruck(id: number, plate: string, profit: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    plate,
    revenue: profit + 1_000_000,
    costs: 1_000_000,
    profit,
    trips: 2,
    maintenanceExpenses: 0,
    variableTripCosts: 1_000_000,
    allocatedFleetFixedCost: 0,
    unallocatedFleetFixedCost: 0,
    monthlyDepreciation: 0,
    monthlyFixedCost: 0,
    eligibleRevenue: profit + 1_000_000,
    allocationReasonCodes: [],
    profileVersionId: null,
    profileEffectiveFrom: null,
    profileSource: 'POLICY',
    ...overrides,
  };
}

// Profit desc is the report's own default order; plates deliberately not
// alphabetical so a plate sort is observable.
const report = {
  tripCount: 6,
  trucks: [
    pnlTruck(1, '30H-999.99', 9_000_000),
    pnlTruck(2, '15C-111.11', 1_000_000),
    pnlTruck(3, '30H-555.55', 5_000_000),
  ],
  maintenanceByComponent: {},
  categoryBreakdown: [
    { categoryName: 'Nhiên liệu', total: '4000000' },
    { categoryName: 'Phí cầu đường', total: '1000000' },
  ],
  financialPolicy: null,
} as unknown as PnlReport;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <FinancePage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function plateOrderByButtons(container: HTMLElement): string[] {
  // The plate cell is the first span after the chevron inside the toggle button.
  return [...container.querySelectorAll('.truck-summary-row .truck-row-toggle')]
    .map(btn => (btn.querySelector('span:not(.truck-row-toggle__hint)')?.textContent ?? '').trim());
}

beforeEach(() => {
  usePnlReportMock.mockReset();
  useYearlyPnlMock.mockReset();
  useMonthlyTripsMock.mockReset();
  useCapTableMock.mockReset();
  usePnlReportMock.mockImplementation((_month: number, year: number) => (
    year === 2026
      ? { data: report, isLoading: false, error: null }
      : { data: undefined, isLoading: false, error: null }
  ));
  useYearlyPnlMock.mockReturnValue({ data: undefined, isLoading: false });
  useMonthlyTripsMock.mockReturnValue({ data: undefined });
  useCapTableMock.mockReturnValue({ data: [] });
});

describe('FinancePage top-trucks chart plate labels', () => {
  it('renders full plates untruncated and starts bars past the longest label gutter', () => {
    const longPlate = 'QA-C17-3-veuqu2'; // 15 chars — worst-case fixture plate
    const labeledReport = {
      ...report,
      trucks: [
        pnlTruck(21, longPlate, 4_000_000),
        pnlTruck(22, '30H-888.88', 2_000_000),
      ],
    };
    usePnlReportMock.mockImplementation((_month: number, year: number) => (
      year === 2026
        ? { data: labeledReport, isLoading: false, error: null }
        : { data: undefined, isLoading: false, error: null }
    ));

    const { container } = renderPage();
    const svg = container.querySelector('svg[aria-label^="Top xe theo lợi nhuận"]');
    expect(svg).not.toBeNull();
    const rows = [...svg!.querySelectorAll('g')];
    const rowFor = (plate: string) => rows.find(g => g.querySelector('text')?.textContent?.startsWith(plate));

    // Full plates, never truncated to '…'.
    for (const plate of [longPlate, '30H-888.88']) {
      const label = rowFor(plate)!.querySelector('text')!;
      expect(label.textContent!.startsWith(plate)).toBe(true);
      expect(label.textContent).not.toContain('…');
    }

    // The bar track starts after a gutter wide enough for the longest label:
    // every rect sits at zeroX = plateW + 5 ≥ longestLen × 7.8 (units/char at 12px).
    const longestLen = longPlate.length;
    for (const rect of [...svg!.querySelectorAll('rect')]) {
      expect(parseFloat(rect.getAttribute('x')!)).toBeGreaterThanOrEqual(longestLen * 7.8);
    }
  });
});

describe('FinancePage top-trucks chart zero-value bars', () => {
  it('renders no bar tick for a zero-profit row and keeps non-zero bars', () => {
    const zeroReport = {
      ...report,
      trucks: [
        pnlTruck(11, '15H-061.14', 0),
        pnlTruck(12, '30H-888.88', 4_000_000),
      ],
    };
    usePnlReportMock.mockImplementation((_month: number, year: number) => (
      year === 2026
        ? { data: zeroReport, isLoading: false, error: null }
        : { data: undefined, isLoading: false, error: null }
    ));

    const { container } = renderPage();
    const svg = container.querySelector('svg[aria-label^="Top xe theo lợi nhuận"]');
    expect(svg).not.toBeNull();
    const rows = [...svg!.querySelectorAll('g')];
    const rowFor = (plate: string) => rows.find(g => g.querySelector('text')?.textContent?.startsWith(plate));

    // A zero-profit row renders label + 0₫ only — no bar tick glued to the plate.
    const zeroRow = rowFor('15H-061.14');
    expect(zeroRow).toBeDefined();
    expect(zeroRow!.querySelector('rect')).toBeNull();

    // Non-zero rows keep their bar.
    const barRow = rowFor('30H-888.88');
    expect(barRow).toBeDefined();
    expect(barRow!.querySelector('rect')).not.toBeNull();
  });
});

describe('FinancePage per-truck table column sorting', () => {
  it('keeps the report profit-desc default and sorts by profit and plate client-side', () => {
    const { container } = renderPage();

    // Default: the report's own profit-desc order, headers unsorted.
    expect(plateOrderByButtons(container)).toEqual(['30H-999.99', '30H-555.55', '15C-111.11']);
    expect(screen.getByRole('columnheader', { name: 'Lợi nhuận gộp' }).getAttribute('aria-sort')).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Lợi nhuận gộp' }));
    expect(plateOrderByButtons(container)).toEqual(['15C-111.11', '30H-555.55', '30H-999.99']);
    expect(screen.getByRole('columnheader', { name: 'Lợi nhuận gộp' }).getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'Lợi nhuận gộp' }));
    expect(plateOrderByButtons(container)).toEqual(['30H-999.99', '30H-555.55', '15C-111.11']);
    expect(screen.getByRole('columnheader', { name: 'Lợi nhuận gộp' }).getAttribute('aria-sort')).toBe('descending');

    // A fresh column starts ascending.
    fireEvent.click(screen.getByRole('button', { name: 'Biển số xe' }));
    expect(plateOrderByButtons(container)).toEqual(['15C-111.11', '30H-555.55', '30H-999.99']);
    expect(screen.getByRole('columnheader', { name: 'Biển số xe' }).getAttribute('aria-sort')).toBe('ascending');
  });

  it('sorts the expense category breakdown by total client-side', () => {
    const { container } = renderPage();

    // "Tổng chi phí" also exists as a truck-table header — scope to the
    // category panel so the roles resolve uniquely.
    const categoryPanel = container.querySelector('.finance-category-breakdown__scroll') as HTMLElement;
    const order = () =>
      [...categoryPanel.querySelectorAll('tbody tr')]
        .map(row => row.querySelector('td')?.textContent ?? '');

    expect(order()).toEqual(['Nhiên liệu', 'Phí cầu đường']);
    fireEvent.click(within(categoryPanel).getByRole('button', { name: 'Tổng chi phí' }));
    expect(order()).toEqual(['Phí cầu đường', 'Nhiên liệu']);
    expect(within(categoryPanel).getByRole('columnheader', { name: 'Tổng chi phí' }).getAttribute('aria-sort')).toBe('ascending');
  });
});

describe('UI75 recognized report tone', () => {
  it('uses cost direction at every compared expense row while retaining exact source amounts', () => {
    const current = { ...report, totalRevenue: 4_500_000, otherIncome: 0, externalMarginTotal: 0, serviceMarginTotal: 0,
      totalCosts: 1_650_000, grossProfit: 2_850_000, netProfit: 2_850_000, fleetDepreciationTotal: 100,
      fleetMonthlyFixedCostTotal: 50, companyExpenses: 5 };
    const prior = { ...current, totalCosts: 110_000, fleetDepreciationTotal: 50, fleetMonthlyFixedCostTotal: 100, companyExpenses: 10 };
    usePnlReportMock.mockImplementation((_month: number, year: number) => ({ data: year === 2026 ? current : prior, isLoading: false, error: null }));
    const { container } = renderPage();
    const row = (label: string) => [...container.querySelectorAll('.pnl-row')]
      .find(node => node.querySelector('.pnl-row__label')?.textContent?.trim().startsWith(label)) as HTMLElement;
    expect(row('Khấu hao đội xe').querySelector('.pnl-row__pct')).toHaveClass('pnl-row__pct--down');
    expect(row('Chi phí cố định đội xe').querySelector('.pnl-row__pct')).toHaveClass('pnl-row__pct--up');
    expect(row('Tổng chi phí vận hành').querySelector('.pnl-row__pct')).toHaveClass('pnl-row__pct--down');
    expect(row('Chi phí công ty').querySelector('.pnl-row__pct')).toHaveClass('pnl-row__pct--up');
    expect(row('Tổng chi phí hoạt động').querySelector('.pnl-row__pct')).toHaveClass('pnl-row__pct--up');
    expect(row('Tổng chi phí vận hành').querySelector('.pnl-row__amount')).toHaveTextContent('1.650.000');
    expect(row('Lợi nhuận gộp')).toHaveAttribute('data-profit-state', 'profit');
  });

  it.each([-50_000, 0])('renders current profit %s with truthful total state and exact amounts', (profit) => {
    usePnlReportMock.mockReturnValue({ data: { ...report, grossProfit: profit, netProfit: profit }, isLoading: false, error: null });
    const { container } = renderPage();
    const totals = container.querySelectorAll('.pnl-row--profit-total');
    expect(totals).toHaveLength(2);
    for (const total of totals) {
      expect(total).toHaveAttribute('data-profit-state', profit < 0 ? 'loss' : 'neutral');
      expect(total.querySelector('.pnl-row__amount')).toHaveTextContent(profit < 0 ? '-50.000' : '0');
    }
  });
});
