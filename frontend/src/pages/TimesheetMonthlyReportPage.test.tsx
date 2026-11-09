// FB-104 (card 141026230810) — báo cáo Tổng hợp xếp lệnh tháng theo mẫu Excel:
// cột STT/Loại xe/Biển kiểm soát/Hình thức lương/Lái xe, lưới ký hiệu theo ngày
// có màu, dòng "Tổng lệnh kẹp/ngày" + tỷ lệ % theo ngày, cột tổng hợp.
// SIL-775 (khách chốt 09/11/2026): mỗi ngày Q tính 1 chuyến — "Tổng số chuyến"
// = Đ + K + Q, và cột 10 "Tỷ lệ kẹp ghép / ngày (%)" = kẹp / tổng × 100%.
// SIL-774: N = nghỉ tai nạn / nghỉ việc gia đình có phép (nền đỏ chữ trắng),
// P = nghỉ sửa xe / bảo dưỡng định kỳ (nền trắng chữ đen); cột 6 đếm P,
// cột 7 đếm N.

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
  note: null, source: 'MANUAL', enteredBy: null, enteredAt: null, adjustedBy: null, adjustedAt: null,
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
  days: [day(1, 'K'), day(2, 'Q', true), day(3, 'N'), day(4, 'P')],
  salary: { ...salary(3, 2), symbolCounts: { K: 1, Q: 1, 'Đ': 0, L: 0, N: 1, P: 0 } },
};

const monthB: TimesheetMonth = {
  id: 2, driverId: 2, driverName: 'Tài xế B', year: 2026, month: 9,
  salaryMode: 'FLAT_MONTHLY', dailyBase: null, flatAmount: 10000000,
  status: 'OPEN', reconciledBy: null, reconciledAt: null, reconcileNote: null, warnings: [],
  days: [day(1, 'Đ'), day(2, 'Đ', true)],
  salary: { ...salary(2, 1), mode: 'FLAT_MONTHLY', symbolCounts: { K: 0, Q: 0, 'Đ': 2, L: 0, N: 0, P: 0 } },
};

// SIL-775 — ví dụ chấp nhận của khách: 2 ngày Đ, 1 ngày K, 1 ngày Q →
// Số chuyến quay đầu = 1, Tổng số chuyến = 4, Tỷ lệ kẹp ghép = 25%.
const monthAc: TimesheetMonth = {
  id: 3, driverId: 3, driverName: 'Tài xế C', year: 2026, month: 9,
  salaryMode: 'PER_TRIP', dailyBase: 200000, flatAmount: null,
  status: 'OPEN', reconciledBy: null, reconciledAt: null, reconcileNote: null, warnings: [],
  days: [day(1, 'Đ'), day(2, 'Đ'), day(3, 'K'), day(4, 'Q')],
  salary: { ...salary(5, 4), symbolCounts: { K: 1, Q: 1, 'Đ': 2, L: 0, N: 0, P: 0 } },
};

const drivers: TimesheetDriverRow[] = [
  { id: 3, name: 'Tài xế C', status: 'ACTIVE', plateNumber: '31L-11111', vehicleClass: 'Đầu kéo', monthId: 3, salaryMode: 'PER_TRIP', monthStatus: 'OPEN', defaultSalaryMode: 'PER_TRIP' },
  { id: 1, name: 'Tài xế A', status: 'ACTIVE', plateNumber: '29H-12345', vehicleClass: 'Đầu kéo', monthId: 1, salaryMode: 'PER_TRIP', monthStatus: 'OPEN', defaultSalaryMode: 'PER_TRIP' },
  { id: 2, name: 'Tài xế B', status: 'ACTIVE', plateNumber: '30K-67890', vehicleClass: 'Xe tải', monthId: 2, salaryMode: 'FLAT_MONTHLY', monthStatus: 'OPEN', defaultSalaryMode: 'FLAT_MONTHLY' },
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
  listMonths.mockReset().mockResolvedValue([monthA, monthB, monthAc]);
});

describe('Tổng hợp xếp lệnh tháng (FB-104)', () => {
  it('mang đủ cột của mẫu Excel và tên bảng theo kỳ', async () => {
    page();
    expect(await screen.findByText('TỔNG HỢP XẾP LỆNH THÁNG 09/2026')).toBeTruthy();
    await screen.findByText('29H-12345');
    for (const header of ['STT', 'Loại xe', 'Biển kiểm soát', 'Hình thức lương', 'Lái xe', 'Tổng lệnh đơn', 'Tổng lệnh kẹp', 'Số chuyến quay đầu', 'Tổng số chuyến', 'Số ngày công', 'Số ngày nghỉ được hưởng lương', 'Số ngày nghỉ phép', 'Tỷ lệ kẹp ghép / ngày (%)']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy();
    }
    expect(screen.getByText('29H-12345')).toBeTruthy();
    expect(screen.getByText('30K-67890')).toBeTruthy();
    expect(screen.getAllByText('Lương theo chuyến (không trốn vé)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lương theo tháng (trốn vé)').length).toBeGreaterThan(0);
  });

  it('tổng hợp theo dòng: đơn/kẹp/quay đầu (SIL-775: mỗi ngày Q = 1)/tổng chuyến/ngày công', async () => {
    page();
    const rowA = (await screen.findByText('Tài xế A')).closest('tr') as HTMLElement;
    expect(rowA.querySelector('[data-label="Tổng lệnh đơn"]')?.textContent).toBe('0');
    expect(rowA.querySelector('[data-label="Tổng lệnh kẹp"]')?.textContent).toBe('1');
    // SIL-775 — mỗi ngày Q tính 1 chuyến quay đầu (thay luật cũ Q = 2).
    expect(rowA.querySelector('[data-label="Số chuyến quay đầu"]')?.textContent).toBe('1');
    // Tổng số chuyến = Đ + K + Q = 0 + 1 + 1 = 2 (không còn salary.trips).
    expect(rowA.querySelector('[data-label="Tổng số chuyến"]')?.textContent).toBe('2');
    expect(rowA.querySelector('[data-label="Số ngày công"]')?.textContent).toBe('2');
    // SIL-774 — cột 6 đếm ngày P, cột 7 đếm ngày N.
    expect(rowA.querySelector('[data-label="Số ngày nghỉ được hưởng lương"]')?.textContent).toBe('1');
    expect(rowA.querySelector('[data-label="Số ngày nghỉ phép"]')?.textContent).toBe('1');
    // Cột 10 — kẹp / tổng số chuyến = 1/2 = 50%.
    expect(rowA.querySelector('[data-label="Tỷ lệ kẹp ghép / ngày (%)"]')?.textContent).toBe('50%');
    const rowB = (await screen.findByText('Tài xế B')).closest('tr') as HTMLElement;
    expect(rowB.querySelector('[data-label="Tổng số chuyến"]')?.textContent).toBe('2');
    expect(rowB.querySelector('[data-label="Tỷ lệ kẹp ghép / ngày (%)"]')?.textContent).toBe('0%');
  });

  it('dòng Tổng lệnh kẹp/ngày + Tỷ lệ % theo ngày', async () => {
    page();
    await screen.findByText('Tài xế A');
    const kepRow = screen.getByText('Tổng lệnh kẹp/ngày').closest('tr') as HTMLElement;
    const pctRow = screen.getByText('Tỷ lệ %').closest('tr') as HTMLElement;
    // ngày 1: A=K, B=Đ, C=Đ → 1 kẹp / 3 lệnh = 33.3%; ngày 2: Q + Đ + Đ → 0 kẹp = 0%
    expect(kepRow.querySelector('[class*="ts-report__cell"]')?.textContent).toBe('1');
    expect(pctRow.querySelector('[class*="ts-report__cell"]')?.textContent).toBe('33.3%');
  });

  it('SIL-775 AC — tháng có 2 Đ, 1 K, 1 Q → quay đầu 1, tổng 4, tỷ lệ kẹp 25%', async () => {
    page();
    const rowC = (await screen.findByText('Tài xế C')).closest('tr') as HTMLElement;
    expect(rowC.querySelector('[data-label="Số chuyến quay đầu"]')?.textContent).toBe('1');
    expect(rowC.querySelector('[data-label="Tổng số chuyến"]')?.textContent).toBe('4');
    expect(rowC.querySelector('[data-label="Tỷ lệ kẹp ghép / ngày (%)"]')?.textContent).toBe('25%');
  });

  it('màu ô theo quy ước: nghỉ = đỏ, Chủ nhật = vàng, ô tạo chuyến = xanh', async () => {
    page();
    const rowA = (await screen.findByText('Tài xế A')).closest('tr') as HTMLElement;
    expect(rowA.querySelector('[data-label="Ngày 1"]')?.className).toContain('ts-report__cell--trip');
    expect(rowA.querySelector('[data-label="Ngày 2"]')?.className).toContain('ts-report__cell--sunday');
    // SIL-774 — N ngày 3: nền đỏ chữ trắng; P ngày 4: nền trắng chữ đen.
    expect(rowA.querySelector('[data-label="Ngày 3"]')?.className).toContain('ts-report__cell--n');
    expect(rowA.querySelector('[data-label="Ngày 4"]')?.className).toContain('ts-report__cell--p');
    // quy ước ký hiệu in đầu báo cáo mang đúng nghĩa mới
    expect(screen.getByText(/Nghỉ tai nạn \/ nghỉ việc gia đình có phép/)).toBeTruthy();
    expect(screen.getByText(/Nghỉ sửa xe \/ bảo dưỡng định kỳ/)).toBeTruthy();
    // quy ước ký hiệu in đầu báo cáo
    for (const symbol of ['K', 'Q', 'Đ', 'L', 'N', 'P']) {
      expect(screen.getAllByText(new RegExp(`^${symbol}`)).length).toBeGreaterThan(0);
    }
  });
});
