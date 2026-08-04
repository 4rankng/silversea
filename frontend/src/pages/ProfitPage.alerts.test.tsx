import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn().mockResolvedValue({
    quarter: 3,
    year: 2026,
    netProfit: 1_000_000,
    tripCount: 1,
    distributions: [],
    entity: [],
    perTruck: [],
    undistributedProfit: 1_000_000,
  }) },
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
      maintenanceExpensesTotal: 120_000,
      fleetDepreciationTotal: 80_000,
      fleetMonthlyFixedCostTotal: 60_000,
      trucks: [
        { variableTripCosts: 1_140_000 },
      ],
    },
    isLoading: false,
    error: null,
  }),
  useDashboardWidgets: () => ({
    data: {
      fleetAttention: [
        {
          truckId: 1,
          licensePlate: '51H-12345',
          status: 'ACTIVE',
          daysSinceLastTrip: 2,
          reason: 'Đăng kiểm quá hạn 3 ngày',
        },
        {
          truckId: 2,
          licensePlate: '51H-54321',
          status: 'ACTIVE',
          daysSinceLastTrip: 1,
          reason: 'Đăng kiểm còn 7 ngày',
        },
      ],
    },
  }),
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
  useToast: () => ({ toast: vi.fn() }),
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

describe('ProfitPage inspection reminders', () => {
  it('shows the shared inspection reminder for management/accounting readers', async () => {
    render(
      <MemoryRouter>
        <ProfitPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Cần xử lý đăng kiểm đội xe trong tháng 8/2026')).toBeTruthy();
    expect(screen.getByText(/51H-12345: Đăng kiểm quá hạn 3 ngày/)).toBeTruthy();
    expect(screen.getByText(/51H-54321: Đăng kiểm còn 7 ngày/)).toBeTruthy();
  });
});
