import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queries, animateCounters } = vi.hoisted(() => ({
  queries: {
    useSalaryPeriod: vi.fn(), useDriverEarnings: vi.fn(),
    useDriverPenalties: vi.fn(), useDriverVehicleAlerts: vi.fn(),
  },
  animateCounters: vi.fn((targets: Array<{ el: HTMLElement }>) => {
    // Model a mid-animation frame: accounting amounts must never be passed here.
    for (const target of targets) target.el.textContent = '123 đ';
  }),
}));
vi.mock('../hooks/useQueries', () => queries);
vi.mock('../hooks/useDriverEarningsPeriod', () => ({ useDriverEarningsPeriod: () => ({ month: 9, year: 2026 }) }));
vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters }),
}));
vi.mock('../components/UI', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));

import DriverEarningsPage from './DriverEarningsPage';

const earnings = {
  baseSalary: '5000000', netIncome: '4950000', penalties: '50000', adjustment: 0,
  productionSalary: '200000', roadAllowance: '800000', paidOrAdvanced: '100000',
  payableBalance: '5850000',
};

function amount(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
}

describe('driver earnings trustworthy amounts and read failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queries.useSalaryPeriod.mockReturnValue({ data: { start: '2026-09-01', end: '2026-09-30' } });
    queries.useDriverEarnings.mockReturnValue({ data: earnings, isLoading: false });
    queries.useDriverPenalties.mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });
    queries.useDriverVehicleAlerts.mockReturnValue({ data: { items: [] } });
  });

  it('shows authoritative monetary details immediately and after earnings update, without counting through invented amounts', () => {
    const view = render(<DriverEarningsPage />);
    expect(amount('Lương cơ bản')).toBe('5.000.000 đ');
    expect(amount('Khấu trừ kỷ luật')).toBe('-50.000 đ');
    expect(amount('Lương sản xuất')).toBe('200.000 đ');
    expect(amount('Tiền đi đường')).toBe('800.000 đ');
    expect(amount('Đã tạm ứng/đã thanh toán')).toBe('100.000 đ');
    expect(animateCounters).not.toHaveBeenCalled();

    queries.useDriverEarnings.mockReturnValue({ data: { ...earnings, roadAllowance: '850000' }, isLoading: false });
    view.rerender(<DriverEarningsPage />);
    expect(amount('Tiền đi đường')).toBe('850.000 đ');
    expect(screen.queryByText('123 đ')).toBeNull();
  });

  it('retains earnings when deduction history fails and retries that read instead of claiming no deductions', () => {
    const refetch = vi.fn();
    queries.useDriverPenalties.mockReturnValue({ data: undefined, error: new Error('Unavailable'), isLoading: false, refetch, isFetching: false });
    const view = render(<DriverEarningsPage />);
    expect(amount('Lương cơ bản')).toBe('5.000.000 đ');
    expect(screen.getByRole('alert').textContent).toContain('Không thể tải lịch sử khấu trừ');
    expect(screen.queryByText('Chưa có khoản khấu trừ nào')).toBeNull();
    expect(screen.queryByText('0 khoản khấu trừ')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại lịch sử khấu trừ' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    queries.useDriverPenalties.mockReturnValue({ data: [{ id: 12, amount: '50000', date: '2026-09-10', reasonText: 'Phạt chậm giờ' }], isLoading: false, refetch });
    view.rerender(<DriverEarningsPage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Phạt chậm giờ')).toBeTruthy();
  });
});
