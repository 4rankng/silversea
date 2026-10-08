/**
 * Card 20261008_6 — toast echo class sweep. QUERY ERROR CATCH + BACKGROUND/
 * ABORT CATCH class pins.
 *
 * ProfitPage's auto-preview effect (loadQuarterPreview) runs on mount — not a
 * user gesture — and its catch echoed `err.message` verbatim into a toast. Per
 * the lead ruling (2026-10-08) a permission toast may fire only for a genuine
 * user-initiated denied action, so a background denial must never render the
 * bare "Không có quyền truy cập"; the degrade fallback stands instead. Aborted/
 * raced background requests must toast NOTHING. A non-403 server reason is a
 * genuine validation passthrough and stays verbatim (the policy's describe /
 * verbatim path).
 *
 * Tests 1 and 3 are honest reds: they fail against the pre-fix mapping.
 * Test 2 pins the verbatim passthrough that must survive the migration.
 */
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api/errors';

const { toastSpy, apiPostMock } = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  apiPostMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: { post: apiPostMock },
}));

vi.mock('../hooks/useQueries', () => ({
  usePnlReport: () => ({
    data: {
      netProfit: 1_000_000,
      tripCount: 3,
      totalRevenue: 2_500_000,
      totalCosts: 1_400_000,
      grossProfit: 1_100_000,
      companyExpenses: 100_000,
      otherIncome: 0,
      maintenanceExpensesTotal: 100_000,
      fleetDepreciationTotal: 80_000,
      fleetMonthlyFixedCostTotal: 60_000,
      trucks: [{ variableTripCosts: 1_140_000 }],
    },
    isLoading: false,
    error: null,
  }),
  useDashboardWidgets: () => ({ data: { fleetAttention: [] } }),
  useCapTable: () => ({ data: [], error: null }),
  useDistributionHistory: () => ({ data: [] }),
}));

vi.mock('../components/UI', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  Card: ({ title, children }: { title?: React.ReactNode; children: React.ReactNode }) => (
    <section>
      {title}
      {children}
    </section>
  ),
  FormGroup: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  useConfirm: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    dialog: null,
  }),
}));

vi.mock('../components/shared/Breadcrumbs', () => ({
  Breadcrumbs: () => null,
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('../hooks/useMonth', () => ({
  useMonth: () => ({ month: 8, year: 2026 }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters: vi.fn() }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { capabilities: [] } }),
}));

import ProfitPage from './ProfitPage';

/** Toast messages fired so far — narrowed reads, no shape assumptions. */
function toastMessages(): string[] {
  return toastSpy.mock.calls.flatMap((call: unknown[]): string[] => {
    const arg: unknown = call[0];
    if (arg && typeof arg === 'object' && 'message' in arg && typeof arg.message === 'string') {
      return [arg.message];
    }
    return [];
  });
}

beforeEach(() => {
  toastSpy.mockReset();
  apiPostMock.mockReset();
});

describe('query error catch class — ProfitPage background auto-preview (card 20261008_6)', () => {
  it('a background denial never toasts the bare permission body — the degrade fallback stands', async () => {
    apiPostMock.mockRejectedValue(new ApiError(403, { error: 'Không có quyền truy cập' }, 'Không có quyền truy cập'));
    render(<MemoryRouter><ProfitPage /></MemoryRouter>);

    await waitFor(() => {
      expect(toastMessages()).toContain('Lỗi khi xem trước phân phối.');
    });
    expect(toastMessages()).not.toContain('Không có quyền truy cập');
  });

  it('a non-403 server reason on the query path passes through verbatim', async () => {
    apiPostMock.mockRejectedValue(new ApiError(422, { error: 'Dữ liệu quý đã bị thay đổi bởi người khác.' }, 'Dữ liệu quý đã bị thay đổi bởi người khác.'));
    render(<MemoryRouter><ProfitPage /></MemoryRouter>);

    await waitFor(() => {
      expect(toastMessages()).toContain('Dữ liệu quý đã bị thay đổi bởi người khác.');
    });
    expect(toastMessages()).not.toContain('Không có quyền truy cập');
  });
});

describe('background/abort catch class — ProfitPage auto-preview teardown (card 20261008_6)', () => {
  it('an aborted/raced background request toasts nothing at all', async () => {
    apiPostMock.mockRejectedValue(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }));
    render(<MemoryRouter><ProfitPage /></MemoryRouter>);

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalled();
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });
});
