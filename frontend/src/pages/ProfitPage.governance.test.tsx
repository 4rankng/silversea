import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { userId: 1, role: 'ADMIN' } }) }));

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

// The settlement quarter follows the real clock (ProfitPage initializes
// selectedQuarter/distQuarterYear from `new Date()`), so a hard-pinned Q
// label in the assertions breaks on every quarter rollover (card
// 20261001_250: it broke exactly on Oct 1). Derive the expectations with
// the page's own formula instead — the test pins BEHAVIOUR, not the
// calendar. (Year note: the page's year options are a fixed 2024–2027
// list, so the derived year must land inside it; horizon is a product
// gap, recorded in the card.)
const clockNow = new Date();
const quarterNow = Math.ceil((clockNow.getMonth() + 1) / 3);
const yearNow = clockNow.getFullYear();

describe('ProfitPage governance request UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    apiPostMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/preview')) {
        return {
          quarter: quarterNow,
          year: yearNow,
          netProfit: 1_000_000,
          tripCount: 1,
          distributions: [],
          entity: [],
          perTruck: [
            { truckId: 41, licensePlate: '15H-021.39', profit: 2_000_000, partners: [] },
          ],
          undistributedProfit: 1_000_000,
        };
      }
      return {
        id: 71,
        actionKind: 'PROFIT_DISTRIBUTION',
        status: 'APPLIED',
        version: 1,
        afterSnapshot: {
          quarter: quarterNow,
          year: yearNow,
        },
      };
    });
  });

  it('finalizes directly and refreshes persisted allocation without claiming a cash transfer', async () => {
    render(
      <MemoryRouter>
        <ProfitPage />
      </MemoryRouter>,
    );

    const submit = await screen.findByRole('button', { name: 'Phân bổ lợi nhuận' });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith('/reports/distribute-profit', {
        quarter: quarterNow,
        year: yearNow,
      });
    });
    expect(confirmMock).toHaveBeenCalledWith(
      `Phân bổ lợi nhuận Quý ${quarterNow}/${yearNow} ngay?`,
    );
    expect(toastMock).toHaveBeenCalledWith({
      kind: 'success',
      message: 'Đã phân bổ lợi nhuận.',
    });
    expect(await screen.findByText(`Đã phân bổ Quý ${quarterNow} / ${yearNow}`)).toBeTruthy();
    expect(screen.getByText(/không ghi nhận chuyển tiền/)).toBeTruthy();
    expect(screen.queryByText(/đang chờ kiểm tra/)).toBeNull();
    expect(refetchHistoryMock).toHaveBeenCalledOnce();
  });

  it('renders its existing zero company-cost report without a subtraction sign or danger tone', () => {
    render(<MemoryRouter><ProfitPage /></MemoryRouter>);
    const row = screen.getByText('Chi phí chung công ty').closest('.calc-row')!;
    const amount = row.querySelector('.calc-row__value')!;
    expect(within(amount as HTMLElement).getByText('0')).toBeVisible();
    expect(amount.querySelector('.money__sign')).toBeNull();
    expect(amount).not.toHaveClass('calc-row__value--neg');
  });

  // Ownership-blocked warning (QA-069): the blocked truck's plate links
  // directly to its ownership editor for admins.
  it('links the blocked truck to its ownership editor', async () => {
    render(
      <MemoryRouter>
        <ProfitPage />
      </MemoryRouter>,
    );
    const previewBtn = await screen.findByRole('button', { name: /Xem trước|Đang tính/i });
    fireEvent.click(previewBtn);
    const link = await screen.findByRole('link', { name: '15H-021.39' });
    expect(link.getAttribute('href')).toBe('/config/trucks/41/owners');
  });

});
