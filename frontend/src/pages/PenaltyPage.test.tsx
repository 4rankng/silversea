import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PenaltyStatus } from '@tingting/shared';
import type { PenaltyInsights, PenaltyListEnvelope, PenaltyRow } from '../hooks/usePenalties';

const apiGet = vi.fn();

vi.mock('../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...(args as [string])) },
}));

vi.mock('../api/configClient', () => ({
  configClient: {
    getSalaryPeriodResolve: vi.fn(() => Promise.resolve({ start: '2026-08-01', end: '2026-08-31' })),
    getDrivers: vi.fn().mockResolvedValue([]),
    getPenaltyReasons: vi.fn().mockResolvedValue([]),
    getTrucks: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'ADMIN' } }),
}));

vi.mock('../hooks/useMonth', () => ({
  useMonth: () => ({ month: 8, year: 2026, goPrev: vi.fn(), goNext: vi.fn(), setMonthYear: vi.fn() }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useListAnimations: () => {},
}));

import PenaltyPage from './PenaltyPage';

const row: PenaltyRow = {
  id: 1,
  driverId: 2,
  tripId: 7,
  reasonId: 3,
  customReason: null,
  amount: '500000',
  date: '2026-08-12',
  status: PenaltyStatus.ACTIVE,
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
  deletedAt: null,
  driverName: 'Nguyễn Văn A',
  reasonText: 'Đi muộn giờ nhận xe',
  tripCode: 'TR-0012',
};

const listEnvelope: PenaltyListEnvelope = {
  items: [row],
  total: 120,
  page: 1,
  pageSize: 50,
  statusCounts: { all: 7, ACTIVE: 5, CANCELED: 2 },
};

const insightsFixture: PenaltyInsights = {
  // incidentCount deliberately differs from statusCounts.all so assertions
  // prove chips read the list envelope and KPIs read the insights payload.
  month: { incidentCount: 9, totalAmount: 1_250_000, prevMonthCount: 4, comparisonLabel: 'Giảm 56% so với 07/26' },
  ytd: { count: 12, total: 3_400_000 },
  safeDriverCount: 1,
  driverTotal: 3,
  scoreboard: [
    { driverId: 1, name: 'Trần An Toàn', streakDays: 210, violations7d: 0, violations30d: 0, violations90d: 0, violationsYtd: 0, fineYtd: 0, grade: 'A+', truckPlate: '51H-999.88' },
    { driverId: 2, name: 'Nguyễn Văn A', streakDays: 9, violations7d: 1, violations30d: 2, violations90d: 3, violationsYtd: 6, fineYtd: 1_800_000, grade: 'B', truckPlate: '51H-123.45' },
  ],
  longestStreak: 210,
  streakLeader: 'Trần An Toàn',
  avgStreak: 110,
  driversOver90: 1,
  driversOver6m: 1,
};

const PERIOD_LIST_URL = '/penalties?page=1&limit=50&dateFrom=2026-08-01&dateTo=2026-08-31';
const INSIGHTS_URL = '/penalties/insights?month=8&year=2026';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PenaltyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/penalties/insights')) return Promise.resolve(insightsFixture);
    if (url.startsWith('/penalties?')) return Promise.resolve(listEnvelope);
    return Promise.resolve({ items: [], total: 0 });
  });
});

describe('PenaltyPage', () => {
  const chip = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('button.penalty-chip'))
      .find(b => b.textContent?.startsWith(label));

  /** Gate on the log's pagination — it only renders once the period-scoped
   *  list page has loaded (scoreboard rows alone don't satisfy it). */
  function findPager() {
    return screen.findByRole('navigation', { name: 'Phân trang' });
  }

  it('fetches the period-scoped list and insights; chips/KPIs come from their own payloads', async () => {
    renderPage();

    await findPager();
    // The list is server-paginated with backend-native params and stays
    // disabled until the salary period lands in the filter bag.
    expect(apiGet).toHaveBeenCalledWith(PERIOD_LIST_URL);
    expect(apiGet).toHaveBeenCalledWith(INSIGHTS_URL);

    // KPI strip comes from the insights payload (month figures, comparison).
    expect((await screen.findAllByText(/1\.250\.000/)).length).toBeGreaterThan(0);
    expect(screen.getByText('9 vụ')).toBeTruthy(); // insights.month.incidentCount in the rail
    // Status chips come from the list envelope's full-set statusCounts.
    expect(chip('Tất cả')?.textContent).toContain('7');
    expect(chip('Hiệu lực')?.textContent).toContain('5');
    expect(chip('Đã hủy')?.textContent).toContain('2');

    // Pagination summary carries the server total (120), not the loaded row count.
    expect(within(screen.getByRole('navigation', { name: 'Phân trang' })).getByText('120')).toBeTruthy();
  });

  it('requests page 2 server-side, then resets to page 1 when a status chip filter is applied', async () => {
    renderPage();
    const pager = await findPager();

    fireEvent.click(within(pager).getByRole('button', { name: '2' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/penalties?page=2&limit=50&dateFrom=2026-08-01&dateTo=2026-08-31');
    });

    const pendingChip = chip('Hiệu lực');
    expect(pendingChip).toBeDefined();
    fireEvent.click(pendingChip!);
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/penalties?page=1&limit=50&dateFrom=2026-08-01&dateTo=2026-08-31&status=ACTIVE');
    });
  });

  it('clears the status filter back to the salary-period scope on reset', async () => {
    renderPage();
    await findPager();

    const canceledChip = chip('Đã hủy');
    fireEvent.click(canceledChip!);
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/penalties?page=1&limit=50&dateFrom=2026-08-01&dateTo=2026-08-31&status=CANCELED');
    });

    fireEvent.click(screen.getByRole('button', { name: /Xóa bộ lọc/ }));
    // Reset restores the period scope (status cleared); the identical query
    // key is served from cache, so assert on the chip state, not a new call.
    await waitFor(() => {
      expect(chip('Tất cả')?.className).toContain('active');
    });
  });
});
