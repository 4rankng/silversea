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

// SIL-799 (KB Ch4 §4.2.9): the earnings tab must NAME the period's money
// state — tạm tính / đã chốt / đã trả are separate facts and a chốt is never
// presented as a payment. QA 10/11 (build dc930964): no surface on the tab
// carried any of the three states.
describe('SIL-799 — kỳ lương hiển thị trạng thái tạm tính / đã chốt', () => {
  it('reads Tạm tính while the period is still LIVE', () => {
    queries.useDriverEarnings.mockReturnValue({ data: { ...earnings, salarySnapshotState: 'LIVE' }, isLoading: false });
    render(<DriverEarningsPage />);
    const state = screen.getByTestId('period-state');
    expect(state.textContent).toBe('Tạm tính — kỳ đang mở');
    expect(state.getAttribute('data-state')).toBe('LIVE');
  });

  it('reads Đã chốt kế toán on a CONFIRMED period — never success-green, never "đã trả"', () => {
    queries.useDriverEarnings.mockReturnValue({ data: { ...earnings, salarySnapshotState: 'CONFIRMED' }, isLoading: false });
    const { container } = render(<DriverEarningsPage />);
    const state = screen.getByTestId('period-state');
    expect(state.textContent).toBe('Đã chốt kế toán — chưa đồng nghĩa đã thanh toán');
    expect(state.textContent).not.toContain('đã trả');
    // Color law §2: a chốt is not money received — the state line stays
    // neutral ink: no success modifier class may ride it (jsdom cannot resolve
    // var() colors, so the class is the enforceable layer).
    expect(container.querySelector('.earnings-equation-card__state.is-success')).toBeNull();
  });

  it('marks an UNAVAILABLE old period as reference-only', () => {
    queries.useDriverEarnings.mockReturnValue({ data: { ...earnings, salarySnapshotState: 'UNAVAILABLE' }, isLoading: false });
    render(<DriverEarningsPage />);
    expect(screen.getByTestId('period-state').textContent).toBe('Chưa có bản lương chốt — số liệu tham khảo');
  });

  it('keeps the đã-trả fact on its own line beside the state line', () => {
    queries.useDriverEarnings.mockReturnValue({ data: { ...earnings, salarySnapshotState: 'CONFIRMED' }, isLoading: false });
    render(<DriverEarningsPage />);
    // The label renders twice by design (summary equation + ledger row).
    expect(screen.getAllByText('Đã tạm ứng/đã thanh toán').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('period-state').textContent).not.toContain('Đã tạm ứng');
  });
});

// SIL-1206 (audit 2026-11-27 P2-17): the two ledger cards under "Tóm tắt kỳ
// này" stand side by side and must be equally tall — the right card carries
// the extra "Ghi chú" block, so a card that stopped at its own content height
// measured 155px against 207px. The equal height is a browser measurement;
// what jsdom can pin is the structure that produces it: both cards are the
// DIRECT children of the one-row grid, so the stretched track reaches the
// card itself instead of an inner wrapper.
describe('SIL-1206 — hai thẻ lương cạnh nhau cao bằng nhau', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queries.useSalaryPeriod.mockReturnValue({ data: { start: '2026-09-01', end: '2026-09-30' } });
    queries.useDriverEarnings.mockReturnValue({ data: earnings, isLoading: false });
    queries.useDriverPenalties.mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });
    queries.useDriverVehicleAlerts.mockReturnValue({ data: { items: [] } });
  });

  it('renders both ledger cards as direct children of the one-row ledger grid', () => {
    render(<DriverEarningsPage />);
    const grid = document.querySelector('.earnings-ledger-grid');
    expect(grid).toBeTruthy();
    const cards = Array.from(grid?.children ?? []);
    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.classList.contains('earnings-ledger-card'))).toBe(true);
    // The right card is the taller one — it owns the extra "Ghi chú" block.
    expect(cards[1].querySelector('.earnings-ledger-list__note')).toBeTruthy();
    expect(cards[0].querySelector('.earnings-ledger-list__note')).toBeNull();
  });
});

// SIL-1346 (audit 28/11) — the hero "LƯƠNG CHƯA THANH TOÁN 0 đ" beside
// "Lương chuyến + đi đường: 920.000 đ" / "Đã tạm ứng/đã thanh toán: 0 đ"
// did not add up. Display repairs (the formula itself is a business rule,
// untouched): every summary line names its source (đã tính / đã trả /
// chưa trả), a fully-paid period states "Đã thanh toán đủ" with a tick
// instead of the grey "—" box, and a trip-based driver never sees 0 ₫
// day-wage rows.
describe('SIL-1346 — hero nguồn tiền, đã-thanh-toán-đủ, ẩn dòng 0 đ lương ngày', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queries.useSalaryPeriod.mockReturnValue({ data: { start: '2026-09-01', end: '2026-09-30' } });
    queries.useDriverPenalties.mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });
    queries.useDriverVehicleAlerts.mockReturnValue({ data: { items: [] } });
  });

  it('labels every summary line with its money source', () => {
    queries.useDriverEarnings.mockReturnValue({ data: earnings, isLoading: false });
    render(<DriverEarningsPage />);
    // Day-wage + trip lines are computed (đã tính), cash is paid (đã trả),
    // the balance is unpaid (chưa trả). The tag rides its own span inside
    // the bold label.
    expect(screen.getAllByText('(đã tính)')).toHaveLength(2);
    expect(screen.getByText('(đã trả)')).toBeTruthy();
    expect(screen.getByText('(chưa trả)')).toBeTruthy();
    // The hero itself keeps the ledger-balance answer for an open balance.
    expect(screen.getByText('Lương chưa thanh toán')).toBeTruthy();
  });

  it('states Đã thanh toán đủ with a tick when earned equals paid, not a grey dash', () => {
    // earned = netIncome + trip income = 5.950.000 = paid.
    queries.useDriverEarnings.mockReturnValue({
      data: { ...earnings, paidOrAdvanced: '5950000', payableBalance: '0' },
      isLoading: false,
    });
    render(<DriverEarningsPage />);
    expect(screen.getByText('Đã thanh toán đủ')).toBeTruthy();
    const icon = document.querySelector('.earnings-hero-bento__icon');
    expect(icon?.querySelector('svg')?.getAttribute('aria-label')).toBe('Đã thanh toán đủ');
  });

  it('hides the 0 đ day-wage rows for a trip-based driver, keeping the chuyến money', () => {
    queries.useDriverEarnings.mockReturnValue({
      data: {
        ...earnings,
        salaryMode: 'PER_TRIP',
        baseSalary: '0',
        netIncome: '0',
        adjustment: 0,
        penalties: '0',
        productionSalary: '820000',
        roadAllowance: '100000',
      },
      isLoading: false,
    });
    render(<DriverEarningsPage />);
    // Equation card: the day-wage line is gone, the chuyến line keeps its
    // (đã tính) tag.
    expect(screen.queryByText('Lương ngày công')).toBeNull();
    expect(screen.getAllByText('(đã tính)')).toHaveLength(1);
    // The day-wage ledger card carries nothing but zero rows — it steps aside
    // instead of showing an empty frame.
    expect(screen.queryByText('Lương cơ bản')).toBeNull();
    expect(screen.queryByText('Lương thực tế')).toBeNull();
    expect(screen.getByText('Lương sản xuất')).toBeTruthy();
    expect(screen.getByText('Tiền đi đường')).toBeTruthy();
  });

  it('keeps the day-wage card when a trip-based period still carries live facts', () => {
    queries.useDriverEarnings.mockReturnValue({
      data: {
        ...earnings,
        salaryMode: 'PER_TRIP',
        baseSalary: '0',
        netIncome: '0',
        adjustment: 0,
        penalties: '50000',
      },
      isLoading: false,
    });
    render(<DriverEarningsPage />);
    // The penalty deduction is real money — the card stays with it alone.
    expect(screen.getByText('Khấu trừ kỷ luật')).toBeTruthy();
    expect(screen.queryByText('Lương cơ bản')).toBeNull();
    expect(screen.queryByText('Lương thực tế')).toBeNull();
  });

  it('keeps the day-wage rows for a flat-monthly driver', () => {
    queries.useDriverEarnings.mockReturnValue({
      data: { ...earnings, salaryMode: 'FLAT_MONTHLY' },
      isLoading: false,
    });
    render(<DriverEarningsPage />);
    expect(screen.getAllByText('(đã tính)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Lương cơ bản')).toBeTruthy();
    expect(screen.getByText('Lương thực tế')).toBeTruthy();
  });

  it('keeps the day-wage rows when the wire predates salaryMode (older snapshots)', () => {
    queries.useDriverEarnings.mockReturnValue({ data: { ...earnings, salaryMode: null }, isLoading: false });
    render(<DriverEarningsPage />);
    expect(screen.getAllByText('(đã tính)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Lương cơ bản')).toBeTruthy();
  });
});
