// FB-104 (card 141026230810) — báo cáo Tổng hợp xếp lệnh tháng theo mẫu Excel:
// cột STT/Loại xe/Biển kiểm soát/Hình thức lương/Lái xe, lưới ký hiệu theo ngày
// có màu, dòng "Tổng lệnh kẹp/ngày" + tỷ lệ % theo ngày, cột tổng hợp; "Q =
// quay đầu → tính 2 chuyến" nên cột "Số chuyến quay đầu" đếm 2 chuyến/ô Q.

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimesheetDayCell, TimesheetDriverRow, TimesheetMonth } from '../api/timesheetClient';

const { listDrivers, listMonths } = vi.hoisted(() => ({ listDrivers: vi.fn(), listMonths: vi.fn() }));

vi.mock('../api/timesheetClient', () => ({
  listTimesheetDrivers: (...args: unknown[]) => listDrivers(...args),
  listTimesheetMonths: (...args: unknown[]) => listMonths(...args),
}));
vi.mock('../design-system/hooks/useMonthRoute', () => ({
  useMonthRoute: () => ({ month: 9, year: 2026, goPrev: vi.fn(), goNext: vi.fn() }),
}));

import TimesheetMonthlyReportPage from './TimesheetMonthlyReportPage';

const day = (dayNumber: number, symbol: TimesheetDayCell['symbol'], isSunday = false): TimesheetDayCell => ({
  id: dayNumber,
  workDate: `2026-09-${String(dayNumber).padStart(2, '0')}`,
  symbol,
  trips: symbol === 'Q' ? 2 : symbol ? 1 : 0,
  isSunday,
  tripAdjustment: 0,
  note: null, enteredBy: null, enteredAt: null, adjustedBy: null, adjustedAt: null,
});

const salary = (trips: number, workdays: number) => ({
  mode: 'PER_TRIP' as const,
  symbolCounts: { K: 0, Q: 0, 'Đ': 0, L: 0, N: 0, P: 0 },
  symbolDays: { K: 0, Q: 0, 'Đ': 0, L: 0, N: 0, P: 0 },
  trips, workdays, bonusTrips: 0, perTripPay: 0, extraTripBonus: 0, dailyBasePay: 0, salaryTotal: 0,
});

const monthA: TimesheetMonth = {
  id: 1, driverId: 1, driverName: 'Tài xế A', year: 2026, month: 9,
  salaryMode: 'PER_TRIP', dailyBase: 200000, flatAmount: null,
  status: 'OPEN', reconciledBy: null, reconciledAt: null, reconcileNote: null, warnings: [],
  days: [day(1, 'K'), day(2, 'Q', true), day(3, 'N')],
  salary: { ...salary(3, 2), symbolCounts: { K: 1, Q: 1, 'Đ': 0, L: 0, N: 1, P: 0 } },
};

const monthB: TimesheetMonth = {
  id: 2, driverId: 2, driverName: 'Tài xế B', year: 2026, month: 9,
  salaryMode: 'FLAT_MONTHLY', dailyBase: null, flatAmount: 10000000,
  status: 'OPEN', reconciledBy: null, reconciledAt: null, reconcileNote: null, warnings: [],
  days: [day(1, 'Đ'), day(2, 'Đ', true)],
  salary: { ...salary(2, 1), mode: 'FLAT_MONTHLY', symbolCounts: { K: 0, Q: 0, 'Đ': 2, L: 0, N: 0, P: 0 } },
};

const drivers: TimesheetDriverRow[] = [
  { id: 1, name: 'Tài xế A', status: 'ACTIVE', plateNumber: '29H-12345', vehicleClass: 'Đầu kéo', monthId: 1, salaryMode: 'PER_TRIP', monthStatus: 'OPEN' },
  { id: 2, name: 'Tài xế B', status: 'ACTIVE', plateNumber: '30K-67890', vehicleClass: 'Xe tải', monthId: 2, salaryMode: 'FLAT_MONTHLY', monthStatus: 'OPEN' },
];

function page() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TimesheetMonthlyReportPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listDrivers.mockReset().mockResolvedValue(drivers);
  listMonths.mockReset().mockResolvedValue([monthA, monthB]);
});

describe('Tổng hợp xếp lệnh tháng (FB-104)', () => {
  it('mang đủ cột của mẫu Excel và tên bảng theo kỳ', async () => {
    page();
    expect(await screen.findByText('TỔNG HỢP XẾP LỆNH THÁNG 09/2026')).toBeTruthy();
    await screen.findByText('29H-12345');
    for (const header of ['STT', 'Loại xe', 'Biển kiểm soát', 'Hình thức lương', 'Lái xe', 'Tổng lệnh đơn', 'Tổng lệnh kẹp', 'Số chuyến quay đầu', 'Tổng số chuyến', 'Số ngày công']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(header) })).toBeTruthy();
    }
    expect(screen.getByText('29H-12345')).toBeTruthy();
    expect(screen.getByText('30K-67890')).toBeTruthy();
    expect(screen.getAllByText('Lương theo chuyến (không trốn vé)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lương theo tháng (trốn vé)').length).toBeGreaterThan(0);
  });

  it('tổng hợp theo dòng: đơn/kẹp/quay đầu (Q = 2 chuyến)/tổng chuyến/ngày công', async () => {
    page();
    const rowA = (await screen.findByText('Tài xế A')).closest('tr') as HTMLElement;
    expect(rowA.querySelector('[data-label="Tổng lệnh đơn"]')?.textContent).toBe('0');
    expect(rowA.querySelector('[data-label="Tổng lệnh kẹp"]')?.textContent).toBe('1');
    // Q tính 2 chuyến (card 230790) — cột đếm CHUYẾN quay đầu.
    expect(rowA.querySelector('[data-label="Số chuyến quay đầu"]')?.textContent).toBe('2');
    expect(rowA.querySelector('[data-label="Tổng số chuyến"]')?.textContent).toBe('3');
    expect(rowA.querySelector('[data-label="Số ngày công"]')?.textContent).toBe('2');
  });

  it('dòng Tổng lệnh kẹp/ngày + Tỷ lệ % theo ngày', async () => {
    page();
    await screen.findByText('Tài xế A');
    const kepRow = screen.getByText('Tổng lệnh kẹp/ngày').closest('tr') as HTMLElement;
    const pctRow = screen.getByText('Tỷ lệ %').closest('tr') as HTMLElement;
    // ngày 1: A=K, B=Đ → 1 kẹp / 2 lệnh = 50%; ngày 2: Q + Đ → 0 kẹp / 2 lệnh = 0%
    expect(kepRow.querySelector('[class*="ts-report__cell"]')?.textContent).toBe('1');
    expect(pctRow.querySelector('[class*="ts-report__cell"]')?.textContent).toBe('50%');
  });

  it('màu ô theo quy ước: nghỉ = đỏ, Chủ nhật = vàng, ô tạo chuyến = xanh', async () => {
    page();
    const rowA = (await screen.findByText('Tài xế A')).closest('tr') as HTMLElement;
    expect(rowA.querySelector('[data-label="Ngày 1"]')?.className).toContain('ts-report__cell--trip');
    expect(rowA.querySelector('[data-label="Ngày 2"]')?.className).toContain('ts-report__cell--sunday');
    // N ngày 3 là nghỉ — đỏ thắng cả ô Chủ nhật
    expect(rowA.querySelector('[data-label="Ngày 3"]')?.className).toContain('ts-report__cell--off');
    // quy ước ký hiệu in đầu báo cáo
    for (const symbol of ['K', 'Q', 'Đ', 'L', 'N', 'P']) {
      expect(screen.getAllByText(new RegExp(`^${symbol}`)).length).toBeGreaterThan(0);
    }
  });
});
