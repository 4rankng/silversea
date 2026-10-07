import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Card 061026174602 — the "Báo cáo lãi lỗ" export button downloaded the file
 * silently: no busy state on the button, no success toast, and a failed
 * export failed silently too. The button must show "Đang xuất…" while the
 * workbook builds, toast on success, and toast an error on failure.
 */

const downloadCSV = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock('../lib/csv', () => ({
  downloadCSV: (...args: unknown[]) => downloadCSV(...args),
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast }),
}));

vi.mock('../hooks/useQueries', () => ({
  usePnlReport: vi.fn(() => ({
    data: {
      externalMarginTotal: 0,
      allocatedFleetFixedCostTotal: 0,
      fleetDepreciationTotal: 0,
      fleetMonthlyFixedCostTotal: 0,
      unallocatedFleetFixedCostTotal: 0,
    },
    isLoading: false,
    error: null,
  })),
  useYearlyPnl: vi.fn(() => ({ data: [], isLoading: false })),
  useMonthlyTrips: vi.fn(() => ({ data: [], isLoading: false })),
  useCapTable: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock('../hooks/useMonth', () => ({
  useMonth: () => ({ month: 10, year: 2026 }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: undefined }),
}));

vi.mock('./finance-derived', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./finance-derived')>()),
  useFinanceDerived: () => ({
    fuelCost: 0, roadCost: 0, driverCost: 0, maintenanceCost: 0,
    fleetDepreciationCost: 0, fleetFixedCost: 0, companyExpenses: 0,
    totalRevenue: 0, otherRevenue: 0, transRevenue: 0, totalCosts: 0,
    grossProfit: 0, netProfit: 0, totalRevenueLY: 0, otherRevenueLY: 0,
    transRevenueLY: 0, totalCostsLY: 0, grossProfitLY: 0,
    companyExpensesLY: 0, netProfitLY: 0, activeCapTable: [],
    costPieData: [], topTrucks: [], categoryBreakdown: [],
    truckBreakdown: [], activeChartData: [], hasChartData: false,
    completedTripCount: 0,
  }),
}));

import FinancePage from './FinancePage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FinancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  downloadCSV.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
});

// Card 071026104800 reported finance strings rendered glued to their values —
// "5chuyến × giá cước chặng", ".Sau khi kết chuyển". Neither reproduces on this
// branch, and unlike the driver/penalty pairs these two had NO gate, so a real
// regression could have slipped through. This pins the contract so the glue
// fails a build instead of surviving to the next QA sweep.
describe('FinancePage label–value spacing (card 071026104800)', () => {
  it('keeps the trip-count line readable as "<n> chuyến × giá cước chặng"', async () => {
    renderPage();
    await screen.findByText(/chuyến × giá cước chặng/);
    expect(screen.getByText('0 chuyến × giá cước chặng')).toBeTruthy();
    // The reported signature: the count glued straight to the word.
    expect(screen.queryByText(/\dchuyến ×/)).toBeNull();
  });

  it('does not leave a bare period glued to the sentence that follows it', async () => {
    renderPage();
    // The prose line ends with a full stop and continues into the cap-table
    // sentence. With an empty cap table the reachable branch renders
    // "…0 ₫. Chưa cấu hình bảng cổ phần." — the reported ".Sau khi kết chuyển"
    // shape would show up here as a period followed immediately by a letter.
    await waitFor(() => expect(document.body.textContent).toContain('bảng cổ phần'));
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/\.\sChưa cấu hình bảng cổ phần/);
    expect(text).not.toMatch(/\.Chưa cấu hình/);
  });

});

describe('FinancePage Excel export feedback (card 061026174602)', () => {
  it('shows a busy label while exporting and toasts success when the file is ready', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Xuất Excel' });
    let resolveExport: () => void = () => {};
    downloadCSV.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveExport = resolve; }));

    fireEvent.click(btn);
    // Busy state rides the pending export.
    expect(screen.getByRole('button', { name: 'Đang xuất…' })).toBeTruthy();

    resolveExport();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy());
    expect(toast).toHaveBeenCalledWith({ kind: 'success', message: 'Đã xuất Báo cáo lãi lỗ ra tệp Excel.' });
  });

  it('toasts an error when the export fails instead of failing silently', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Xuất Excel' });
    downloadCSV.mockRejectedValueOnce(new Error('boom'));

    fireEvent.click(btn);
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ kind: 'error', message: 'Chưa xuất được tệp Excel — vui lòng thử lại.' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy());
  });
});
