import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  apiPostMock,
  confirmMock,
  toastMock,
  refetchHistoryMock,
} = vi.hoisted(() => ({
  apiPostMock: vi.fn(),
  confirmMock: vi.fn(),
  toastMock: vi.fn(),
  refetchHistoryMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: { post: apiPostMock },
}));

vi.mock('../hooks/useQueries', () => ({
  usePnlReport: () => ({
    data: {
      netProfit: 1_000_000,
      tripCount: 1,
      totalRevenue: 1_500_000,
      totalCosts: 500_000,
      grossProfit: 1_000_000,
      companyExpenses: 0,
      otherIncome: 0,
    },
    isLoading: false,
    error: null,
  }),
  useDashboardWidgets: () => ({ data: { fleetAttention: [] } }),
  useCapTable: () => ({ data: [], error: null }),
  useDistributionHistory: () => ({ data: [], refetch: refetchHistoryMock }),
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
    confirm: confirmMock,
    dialog: null,
  }),
}));

vi.mock('../components/shared/Breadcrumbs', () => ({
  Breadcrumbs: () => null,
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('../hooks/useMonth', () => ({
  useMonth: () => ({ month: 7, year: 2026 }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters: vi.fn() }),
}));

import ProfitPage from './ProfitPage';

describe('ProfitPage governance request UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    apiPostMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/preview')) {
        return {
          quarter: 3,
          year: 2026,
          netProfit: 1_000_000,
          tripCount: 1,
          distributions: [],
          entity: [],
          perTruck: [],
          undistributedProfit: 1_000_000,
        };
      }
      return {
        id: 71,
        actionKind: 'PROFIT_DISTRIBUTION',
        status: 'PENDING_CHECK',
        version: 1,
        afterSnapshot: {
          quarter: 3,
          year: 2026,
        },
      };
    });
  });

  it('shows a pending-review result and never claims profit was distributed', async () => {
    render(
      <MemoryRouter>
        <ProfitPage />
      </MemoryRouter>,
    );

    const submit = await screen.findByRole('button', { name: 'Gửi duyệt phân bổ' });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith('/reports/distribute-profit', {
        quarter: 3,
        year: 2026,
      });
    });
    expect(confirmMock).toHaveBeenCalledWith(
      'Gửi yêu cầu phân chia lợi nhuận Quý 3/2026 để kiểm tra và phê duyệt?',
    );
    expect(toastMock).toHaveBeenCalledWith({
      kind: 'success',
      message: 'Đã gửi yêu cầu phân chia lợi nhuận để kiểm tra và phê duyệt.',
    });
    expect(await screen.findByText('Đã gửi yêu cầu phân chia Quý 3 / 2026')).toBeTruthy();
    expect(screen.getByText(/đang chờ kiểm tra/)).toBeTruthy();
    expect(screen.getByText(/Chưa có khoản lợi nhuận nào được phân phối/)).toBeTruthy();
    expect(screen.queryByText(/Đã phân chia lợi nhuận Quý/)).toBeNull();
    expect(refetchHistoryMock).not.toHaveBeenCalled();
  });
});
