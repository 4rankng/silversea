// Kế toán's reconciliation board: a NEGATIVE trip correction must be accepted
// (a trip the paperwork does not support has to be removable), and the month's
// salary must read from the shared authority rather than a page-local formula.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TimesheetReconciliationPage from './TimesheetReconciliationPage';
import {
  adjustTimesheetDay,
  getTimesheetRollup,
  listTimesheetMonths,
  updateTimesheetMode,
} from '../api/timesheetClient';
import { ToastProvider } from '../components/shared/Toast';
import type { TimesheetMonth } from '../api/timesheetClient';

vi.mock('../api/timesheetClient', async () => {
  const actual = await vi.importActual<typeof import('../api/timesheetClient')>('../api/timesheetClient');
  return {
    ...actual,
    listTimesheetMonths: vi.fn(),
    getTimesheetRollup: vi.fn(),
    adjustTimesheetDay: vi.fn(),
    reconcileTimesheetMonth: vi.fn(),
    reopenTimesheetMonth: vi.fn(),
    updateTimesheetMode: vi.fn(),
  };
});

const month: TimesheetMonth = {
  id: 7,
  driverId: 3,
  driverName: 'Nguyễn Văn A',
  year: 2026,
  month: 10,
  salaryMode: 'PER_TRIP',
  dailyBase: 200_000,
  flatAmount: null,
  status: 'OPEN',
  reconciledBy: null,
  reconciledAt: null,
  reconcileNote: null,
  warnings: [],
  days: [
    {
      id: 11, workDate: '2026-10-05', symbol: 'Q', trips: 2, isSunday: false,
      tripAdjustment: 0, note: null, source: 'MANUAL', enteredBy: 2, enteredAt: null, adjustedBy: null, adjustedAt: null,
    },
    {
      id: 12, workDate: '2026-10-11', symbol: 'Đ', trips: 1, isSunday: true,
      tripAdjustment: 0, note: null, source: 'MANUAL', enteredBy: 2, enteredAt: null, adjustedBy: null, adjustedAt: null,
    },
  ],
  salary: {
    mode: 'PER_TRIP', symbolCounts: { K: 0, Q: 2, 'Đ': 1, L: 0, N: 0, P: 0 },
    symbolDays: { K: 0, Q: 1, 'Đ': 1, L: 0, N: 0, P: 0 },
    trips: 3, workdays: 1, standardDays: 2, paidSalaryDays: 2,
    bonusTrips: 0, perTripPay: 300_000, extraTripBonus: 0,
    dailyBasePay: 400_000, salaryTotal: 700_000,
  },
};

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/timesheet/doi-chieu']}>
          <TimesheetReconciliationPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTimesheetMonths).mockResolvedValue([month]);
  vi.mocked(getTimesheetRollup).mockResolvedValue([]);
  vi.mocked(adjustTimesheetDay).mockResolvedValue({
    ...month,
    salary: { ...month.salary, trips: 2, salaryTotal: 800_000 },
  });
});

describe('TimesheetReconciliationPage', () => {
  it('sends a NEGATIVE adjustment through to the API', async () => {
    renderBoard();
    const field = await screen.findByLabelText('Chỉnh lệch chuyến ngày 2026-10-05');
    fireEvent.blur(field, { target: { value: '-1' } });
    await waitFor(() => expect(adjustTimesheetDay).toHaveBeenCalledWith(7, 11, -1));
  });

  it('does not call the API when the correction is unchanged', async () => {
    renderBoard();
    const field = await screen.findByLabelText('Chỉnh lệch chuyến ngày 2026-10-05');
    fireEvent.blur(field, { target: { value: '0' } });
    await Promise.resolve();
    expect(adjustTimesheetDay).not.toHaveBeenCalled();
  });

  it('renders the month salary from the API figure, not a page-local formula', async () => {
    renderBoard();
    expect(await screen.findByText('Tổng lương')).toBeTruthy();
    // The rail localises the number; the API figure is what lands here.
    expect(screen.getByText('700.000')).toBeTruthy();
  });

  it('marks the Sunday row so the separate Sunday pay is visible', async () => {
    renderBoard();
    expect((await screen.findAllByText('Chủ nhật')).length).toBeGreaterThan(0);
  });

  it('tells the accountant a negative correction is allowed', async () => {
    renderBoard();
    expect(await screen.findByText(/Chỉnh lệch chuyến nhập số âm được/)).toBeTruthy();
  });

  it('FB-103 — đổi hình thức lương gửi PATCH mode kèm tham số của chế độ mới', async () => {
    vi.mocked(updateTimesheetMode).mockResolvedValue(month);
    renderBoard();
    await screen.findByText('Tổng lương');
    fireEvent.click(screen.getByRole('button', { name: /Hình thức lương/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lương theo tháng (trốn vé)' }));
    fireEvent.change(screen.getByLabelText('Lương tháng cố định (VND)'), { target: { value: '10000000' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu chế độ lương/ }));
    await waitFor(() => expect(updateTimesheetMode).toHaveBeenCalledWith(7, {
      salaryMode: 'FLAT_MONTHLY', dailyBase: null, flatAmount: 10000000,
    }));
  });

  it('SIL-841 — cột Chuyến của Tổng hợp tháng đọc Tổng số chuyến (Đ+K+2·Q) từ rollup', async () => {
    // 2 Đ + 1 K + 1 Q → Tổng số chuyến = 5 = 2+1+2·1 (SIL-841, 15/11); từ
    // 15/11 trọng số tổng TRÙNG trọng số lương (Q = 2 ở cả hai).
    vi.mocked(getTimesheetRollup).mockResolvedValue([{
      driverId: 9, driverName: 'Lái xe kiểm thử',
      donCount: 2, kepCount: 1, quayDauCount: 1, luuCaCount: 0, nghiCount: 0, nghiPhepCount: 0,
      totalTrips: 5, trips: 5, workdays: 4, standardDays: 25, paidSalaryDays: 24, bonusTrips: 0,
      salaryMode: 'PER_TRIP', salary: 1_500_000, perTripPay: 500_000, extraTripBonus: 0,
      dailyBasePay: 1_000_000, status: 'OPEN', sundayTrips: 0,
      revenue: null, cost: null, salaryRatio: null, tripsCompleted: 4,
    }]);
    renderBoard();
    const tourCell = await screen.findByText('5', { selector: 'td[data-label="Chuyến"]' });
    expect(screen.getByText('Tổng hợp tháng')).toBeTruthy();
    expect(tourCell).toBeTruthy();
    expect(screen.getByText('24', { selector: 'td[data-label="Ngày công lương"]' })).toBeTruthy();
    expect(screen.getByText('Tổng 5 chuyến · 4 ngày công ·')).toBeTruthy();
  });

  it('SIL-841 — ngày Q trên lưới Đối chiếu đếm CHUYẾN = 2 (luật 15/11)', async () => {
    // Fixture 05/10: symbol Q, payload trips = 2. Cột Chuyến của lưới là số
    // đếm hiển thị theo summaryTrips — SIL-841: mỗi ngày Q = 2 chuyến.
    renderBoard();
    const qRow = (await screen.findByText('2026-10-05')).closest('tr')!;
    expect(qRow.querySelector('td[data-label="Chuyến"]')?.textContent).toBe('2');
    const donRow = screen.getByText('2026-10-11').closest('tr')!;
    expect(donRow.querySelector('td[data-label="Chuyến"]')?.textContent).toBe('1');
  });

  it('SIL-841 — chỉnh lệch vẫn cộng vào số đếm hiển thị của ngày Q', async () => {
    vi.mocked(listTimesheetMonths).mockResolvedValue([{
      ...month,
      days: month.days.map(day => day.symbol === 'Q' ? { ...day, tripAdjustment: -1 } : day),
    }]);
    renderBoard();
    const qRow = (await screen.findByText('2026-10-05')).closest('tr')!;
    // 2 (summaryTrips) + (−1) = 1 — chỉnh lệch không biến mất khỏi cột hiển thị.
    expect(qRow.querySelector('td[data-label="Chuyến"]')?.textContent).toBe('1');
  });

  // SIL-841 round (QA FAIL 16/11 23:12, build dd198999): the Đối chiếu grid
  // had NO symbol legend and its Sunday column had drifted back to the
  // 'CHUYẾN CN' label. Pins keep the per-screen contract: the legend reads
  // the shared TIMESHEET_SYMBOL_RULES (Q = 2 chuyến, L/P +ngày công, N −1
  // ngày phép) + the Sunday rule line, and the Sunday column is 'Ngày làm CN'.
  it('SIL-841 round — Đối chiếu renders the symbol legend (Q/L/N/P workday notes + Chủ nhật)', async () => {
    renderBoard();
    expect(await screen.findByText('Tổng hợp tháng')).toBeTruthy();
    expect(screen.getByText(/Quay đầu \(2 chuyến\)/)).toBeTruthy();
    expect(screen.getByText(/Lưu ca \(0 chuyến · \+ngày công\)/)).toBeTruthy();
    expect(screen.getByText(/Nghỉ tai nạn \/ nghỉ việc gia đình có phép \(0 chuyến · −1 ngày phép \(sau ngày đầu\)\)/)).toBeTruthy();
    expect(screen.getByText(/Nghỉ sửa xe \/ bảo dưỡng định kỳ \(0 chuyến · \+ngày công\)/)).toBeTruthy();
    expect(screen.getByText('Chủ nhật — nền vàng, ghi chuyến, không tính ngày công')).toBeTruthy();
  });

  it('SIL-841 round — the Sunday aggregate column is labeled Ngày làm CN', async () => {
    renderBoard();
    expect(await screen.findByText('Tổng hợp tháng')).toBeTruthy();
    expect(screen.getByText('Ngày làm CN', { selector: 'th' })).toBeTruthy();
    // The Sunday day rows keep their marker (same law as the Sunday-pay pin).
    expect((await screen.findAllByText('Chủ nhật')).length).toBeGreaterThan(0);
  });
});