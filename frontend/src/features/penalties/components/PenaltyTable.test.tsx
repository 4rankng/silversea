import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PenaltyStatus } from '@tingting/shared';
import type { Driver } from '@tingting/shared';
import type { PenaltyInsights, PenaltyRow, PenaltyStatusCounts } from '../../../hooks/usePenalties';
import { PenaltyTable } from './PenaltyTable';
import type { PenaltyTableProps } from './penalty-table-types';

const row = (overrides: Partial<PenaltyRow> = {}): PenaltyRow => ({
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
  ...overrides,
});

const insights = (): PenaltyInsights => ({
  month: { incidentCount: 7, totalAmount: 1_250_000, prevMonthCount: 4, comparisonLabel: 'Giảm 43% so với 07/26' },
  ytd: { count: 12, total: 3_400_000 },
  safeDriverCount: 1,
  driverTotal: 3,
  scoreboard: [
    { driverId: 1, name: 'Trần An Toàn', streakDays: 210, violations7d: 0, violations30d: 0, violations90d: 0, violationsYtd: 0, fineYtd: 0, grade: 'A+', truckPlate: '51H-999.88' },
    { driverId: 2, name: 'Nguyễn Văn A', streakDays: 9, violations7d: 1, violations30d: 2, violations90d: 3, violationsYtd: 6, fineYtd: 1_800_000, grade: 'B', truckPlate: '51H-123.45' },
    { driverId: 3, name: 'Lê Cẩn Thận', streakDays: 90, violations7d: 0, violations30d: 0, violations90d: 0, violationsYtd: 1, fineYtd: 200_000, grade: 'A', truckPlate: null },
  ],
  longestStreak: 210,
  streakLeader: 'Trần An Toàn',
  avgStreak: 103,
  driversOver90: 2,
  driversOver6m: 1,
});

const statusCounts = (): PenaltyStatusCounts => ({ all: 7, PENDING: 3, ACTIVE: 3, CANCELED: 1 });

const catalogDriver = (overrides: Partial<Driver> = {}): Driver => ({
  id: 2,
  name: 'Nguyễn Văn A',
  status: 'ACTIVE',
  assignedTruckId: 11,
  createdAt: '2024-01-15T00:00:00.000Z',
  ...overrides,
} as Driver);

const baseProps: PenaltyTableProps = {
  rows: [],
  total: 0,
  page: 1,
  pageSize: 50,
  totalPages: 1,
  listLoading: false,
  onPageChange: vi.fn(),
  sort: null,
  onSortChange: vi.fn(),
  statusCounts: undefined,
  search: '',
  onSearchChange: vi.fn(),
  statusFilter: 'all',
  onStatusFilterChange: vi.fn(),
  driverFilter: undefined,
  onDriverFilterChange: vi.fn(),
  hasActiveFilters: false,
  onResetFilters: vi.fn(),
  drivers: [catalogDriver()],
  reasons: [],
  insights: undefined,
  insightsLoading: false,
  monthLabel: '08/26',
  canCancel: true,
  onOpenDrawer: vi.fn(),
  onCancelPenalty: vi.fn(),
  onApprovePenalty: vi.fn(),
};

function renderTable(props: Partial<PenaltyTableProps> = {}) {
  return render(
    <MemoryRouter>
      <PenaltyTable {...baseProps} {...props} />
    </MemoryRouter>,
  );
}

describe('PenaltyTable', () => {
  it('marks every violation-log header sortable and reports the active sort', () => {
    const onSortChange = vi.fn();
    const { rerender } = renderTable({ rows: [row()], total: 1, sort: null, onSortChange });

    const headers = [...document.querySelectorAll('.penalty-log-table thead th')];
    const sortable = headers.filter((th) => th.querySelector('button.table-sort-button'));
    // Lái xe / Lý do / Ngày / Chuyến / Số tiền — the cancel column stays decorative.
    expect(sortable).toHaveLength(5);
    expect(sortable.every((th) => th.getAttribute('aria-sort') === 'none')).toBe(true);

    fireEvent.click(within(sortable[4] as HTMLElement).getByRole('button'));
    expect(onSortChange).toHaveBeenCalledWith('amount');

    rerender(
      <MemoryRouter>
        <PenaltyTable {...baseProps} rows={[row()]} total={1} sort={{ by: 'amount', dir: 'asc' }} onSortChange={onSortChange} />
      </MemoryRouter>,
    );
    const amountHeader = [...document.querySelectorAll('.penalty-log-table thead th')]
      .find((th) => th.textContent?.includes('Số tiền'));
    expect(amountHeader?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('renders the violation log as a record table with data-labels and Money cells', () => {
    renderTable({ rows: [row()], total: 1 });

    const logTable = document.querySelector('.penalty-log-table') as HTMLElement;
    expect(logTable).not.toBeNull();
    for (const header of ['Lái xe', 'Lý do', 'Ngày', 'Chuyến', 'Số tiền']) {
      expect(within(logTable).getByRole('columnheader', { name: header })).toBeTruthy();
    }
    const amountCell = document.querySelector('td[data-label="Số tiền"]');
    expect(amountCell).not.toBeNull();
    expect(amountCell?.textContent).toContain('500.000');
    expect(document.querySelector('td[data-label="Lái xe"]')?.textContent).toContain('Nguyễn Văn A');
    expect(document.querySelector('td[data-label="Chuyến"]')?.textContent).toContain('TR-0012');
    // Cancel affordance is a labelled action cell, not a labelled fact.
    expect(document.querySelector('td.record-table__action button[aria-label="Hủy kỷ luật"]')).not.toBeNull();
  });

  it('renders KPIs from the insights payload and chip counts from the list envelope', () => {
    // Only one row is loaded; the server payload claims full-set figures —
    // the strip and chips must show the server numbers.
    renderTable({ rows: [row()], total: 1, insights: insights(), statusCounts: statusCounts() });

    expect(screen.getAllByText(/1\.250\.000/).length).toBeGreaterThan(0); // insights.month.totalAmount
    expect(screen.getByText(/YTD 3\.400\.000/, { selector: '.summary-rail dt' })).toBeTruthy(); // ytd total folded into the rail label
    expect(screen.getByText('1/3')).toBeTruthy(); // safeDriverCount / driverTotal from insights
    const chip = (label: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button.penalty-chip'))
        .find(b => b.textContent?.startsWith(label));
    expect(chip('Tất cả')?.textContent).toContain('7');
    expect(chip('Chờ duyệt')?.textContent).toContain('3');
    expect(chip('Hiệu lực')?.textContent).toContain('3');
    expect(chip('Đã hủy')?.textContent).toContain('1');
  });

  it('collapses the phone scoreboard by default; the toggle expands the ranking cards', () => {
    renderTable({ rows: [row()], total: 1, insights: insights(), statusCounts: statusCounts() });

    // Default-collapsed: no phone ranking cards until the toggle is pressed.
    expect(document.querySelectorAll('.penalty-m-card')).toHaveLength(0);
    const toggle = screen.getByRole('button', { name: /Bảng xếp hạng lái xe/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(document.querySelectorAll('.penalty-m-card')).toHaveLength(3);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });


  it('gates pending-record actions by submitter: submitter cancels, others approve', () => {
    const onApprovePenalty = vi.fn();
    const pending = row({ id: 9, status: PenaltyStatus.PENDING, createdBy: 42 });
    const first = renderTable({ rows: [pending], total: 1, currentUserId: 7, currentUserRole: 'MANAGER', onApprovePenalty });

    // Not the submitter: approve is available, cancel is not.
    expect(document.querySelector('button[aria-label="Duyệt kỷ luật"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Hủy kỷ luật"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt kỷ luật' }));
    expect(onApprovePenalty).toHaveBeenCalledWith(pending);

    // The submitter's own view: cancel available, approve hidden.
    first.unmount();
    renderTable({ rows: [pending], total: 1, currentUserId: 42, currentUserRole: 'MANAGER', onApprovePenalty });
    expect(document.querySelector('button[aria-label="Duyệt kỷ luật"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Hủy kỷ luật"]')).not.toBeNull();
  });

  it('renders the scoreboard from insights with server streaks and plates', () => {
    renderTable({ insights: insights() });

    const desktopTable = document.querySelector('.penalty-scoreboard-table') as HTMLElement;
    expect(desktopTable).not.toBeNull();
    expect(within(desktopTable).getByText('Trần An Toàn')).toBeTruthy();
    expect(within(desktopTable).getByText(/210/)).toBeTruthy();
    expect(within(desktopTable).getByText('51H-999.88')).toBeTruthy(); // server-provided plate
    expect(within(desktopTable).getByRole('columnheader', { name: /Vi phạm 90N/ })).toBeTruthy();
    // Default window: violations90d (3 for Nguyễn Văn A), server grade B.
    expect(within(desktopTable).getAllByText('3 vụ').length).toBeGreaterThan(0);
    expect(within(desktopTable).getAllByText('B').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Trần An Toàn').length).toBeGreaterThan(0); // insights.streakLeader leads the scoreboard
  });

  it('switches scoreboard windows client-side from the same insights payload', () => {
    renderTable({ insights: insights() });
    const desktopTable = () => document.querySelector('.penalty-scoreboard-table') as HTMLElement;

    fireEvent.click(screen.getByRole('button', { name: '7 ngày' }));

    expect(within(desktopTable()).getByRole('columnheader', { name: /Vi phạm 7D/ })).toBeTruthy();
    // Nguyễn Văn A: violations7d = 1 (was 3 under 90d) → grade recomputed A.
    expect(within(desktopTable()).getAllByText('1 vụ').length).toBeGreaterThan(0);
    expect(within(desktopTable()).getAllByText('A').length).toBeGreaterThan(0);
    expect(within(desktopTable()).queryByText('B')).toBeNull();
  });

  it('derives the safe-streak KPI from insights and shows the cancel state', () => {
    renderTable({
      rows: [row({ id: 9, status: PenaltyStatus.CANCELED })],
      total: 1,
      insights: insights(),
    });
    expect(document.querySelector('tr.penalty-log-row--canceled')).not.toBeNull();
    expect(screen.getAllByText('210 ngày').length).toBeGreaterThan(0); // insights.longestStreak
  });

  it('forwards chip and pagination interactions', () => {
    const onStatusFilterChange = vi.fn();
    const onPageChange = vi.fn();
    renderTable({
      rows: [row()],
      total: 120,
      page: 2,
      pageSize: 50,
      totalPages: 3,
      statusCounts: statusCounts(),
      onStatusFilterChange,
      onPageChange,
    });

    fireEvent.click(screen.getByRole('button', { name: /Hiệu lực/ }));
    expect(onStatusFilterChange).toHaveBeenCalledWith(PenaltyStatus.ACTIVE);

    // Pagination summary carries the server total, not the loaded row count.
    const pager = screen.getByRole('navigation', { name: 'Phân trang' });
    expect(within(pager).getByText('120')).toBeTruthy();
    fireEvent.click(within(pager).getByRole('button', { name: '3' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('shows the empty state with server YTD figures when the page has no rows', () => {
    renderTable({ rows: [], total: 0, insights: insights() });

    expect(screen.getByText('Toàn đội đang giữ chuẩn nghiệp vụ')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy(); // insights.ytd.count
    expect(screen.getAllByText(/3\.400\.000/).length).toBeGreaterThan(0); // insights.ytd.total
  });
});
