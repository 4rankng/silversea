// FB-104 (card 141026230810) — báo cáo Tổng hợp xếp lệnh tháng theo mẫu Excel:
// cột STT/Loại xe/Biển kiểm soát/Hình thức lương/Lái xe, lưới ký hiệu theo ngày
// có màu theo spec REV 2 (SIL-781), 2 dòng chỉ số toàn đội xe PHÍA TRÊN dòng
// tiêu đề ngày ("Tổng lệnh kẹp/ngày" + "% Tỷ lệ kẹp ghép trong ngày"), 10 cột
// tổng hợp cuối dòng; "Q = quay đầu → tính 2 chuyến" (card 230790) nên cột
// "Số chuyến quay đầu" đếm 2 chuyến/ô Q; lái xe INACTIVE có cả chuỗi ngày
// nền đỏ đậm.

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

// SIL-781 — lái xe đã nghỉ việc: cả chuỗi ngày phải tô nền đỏ đậm.
const monthC: TimesheetMonth = {
  id: 3, driverId: 3, driverName: 'Tài xế C', year: 2026, month: 9,
  salaryMode: 'PER_TRIP', dailyBase: null, flatAmount: null,
  status: 'OPEN', reconciledBy: null, reconciledAt: null, reconcileNote: null, warnings: [],
  days: [day(1, 'Đ'), day(2, 'N', true)],
  salary: salary(1, 1),
};

const drivers: TimesheetDriverRow[] = [
  { id: 1, name: 'Tài xế A', status: 'ACTIVE', plateNumber: '29H-12345', vehicleClass: 'Đầu kéo', monthId: 1, salaryMode: 'PER_TRIP', monthStatus: 'OPEN', defaultSalaryMode: 'PER_TRIP' },
  { id: 2, name: 'Tài xế B', status: 'ACTIVE', plateNumber: '30K-67890', vehicleClass: 'Xe tải', monthId: 2, salaryMode: 'FLAT_MONTHLY', monthStatus: 'OPEN', defaultSalaryMode: 'FLAT_MONTHLY' },
  { id: 3, name: 'Tài xế C', status: 'INACTIVE', plateNumber: null, vehicleClass: null, monthId: 3, salaryMode: 'PER_TRIP', monthStatus: 'OPEN', defaultSalaryMode: 'PER_TRIP' },
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
  listMonths.mockReset().mockResolvedValue([monthA, monthB, monthC]);
});

describe('Tổng hợp xếp lệnh tháng (FB-104 + SIL-781)', () => {
  it('mang đủ 10 cột tổng hợp và tên bảng theo kỳ', async () => {
    page();
    expect(await screen.findByText('TỔNG HỢP XẾP LỆNH THÁNG 09/2026')).toBeTruthy();
    await screen.findByText('29H-12345');
    const headers = [
      'STT', 'Loại xe', 'Biển kiểm soát', 'Hình thức lương', 'Lái xe',
      'Tổng lệnh đơn', 'Tổng lệnh kẹp', 'Số chuyến quay đầu', 'Tổng số chuyến',
      'Ngày công thực tế', 'Nghỉ hưởng lương (P)', 'Nghỉ phép (N)', 'Ngày làm CN',
      'Tổng ngày công', 'Tỷ lệ kẹp ghép',
    ];
    for (const header of headers) {
      // String name = exact match after whitespace normalization — regex would
      // treat the literal "(P)"/"(N)" as capture groups and never match.
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy();
    }
    expect(screen.getAllByText('Lương theo chuyến (không trốn vé)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lương theo tháng (trốn vé)').length).toBeGreaterThan(0);
  });

  it('tổng hợp 10 cột theo dòng: đơn/kẹp/quay đầu (Q = 2 chuyến)/thực tế/P/N/CN', async () => {
    page();
    const rowA = (await screen.findByText('Tài xế A')).closest('tr') as HTMLElement;
    expect(rowA.querySelector('[data-label="Tổng lệnh đơn"]')?.textContent).toBe('0');
    expect(rowA.querySelector('[data-label="Tổng lệnh kẹp"]')?.textContent).toBe('1');
    // Q tính 2 chuyến (card 230790) — cột đếm CHUYẾN quay đầu.
    expect(rowA.querySelector('[data-label="Số chuyến quay đầu"]')?.textContent).toBe('2');
    expect(rowA.querySelector('[data-label="Tổng số chuyến"]')?.textContent).toBe('3');
    // K ngày 1 (không CN) — Q ngày 2 rơi vào Chủ nhật nên không tính ngày công.
    expect(rowA.querySelector('[data-label="Ngày công thực tế"]')?.textContent).toBe('1');
    expect(rowA.querySelector('[data-label="Nghỉ hưởng lương (P)"]')?.textContent).toBe('0');
    expect(rowA.querySelector('[data-label="Nghỉ phép (N)"]')?.textContent).toBe('1');
    // Q chạy ngày Chủ nhật → đếm vào "Ngày làm CN".
    expect(rowA.querySelector('[data-label="Ngày làm CN"]')?.textContent).toBe('1');
    expect(rowA.querySelector('[data-label="Tổng ngày công"]')?.textContent).toBe('2');
    // 1 ô K / 2 lệnh (K+Q) = 50%.
    expect(rowA.querySelector('[data-label="Tỷ lệ kẹp ghép"]')?.textContent).toBe('50%');

    const rowB = (await screen.findByText('Tài xế B')).closest('tr') as HTMLElement;
    expect(rowB.querySelector('[data-label="Tổng lệnh đơn"]')?.textContent).toBe('2');
    expect(rowB.querySelector('[data-label="Tổng lệnh kẹp"]')?.textContent).toBe('0');
    expect(rowB.querySelector('[data-label="Ngày công thực tế"]')?.textContent).toBe('1');
    expect(rowB.querySelector('[data-label="Ngày làm CN"]')?.textContent).toBe('1');
    // Không có ô K nào → tỷ lệ 0%.
    expect(rowB.querySelector('[data-label="Tỷ lệ kẹp ghép"]')?.textContent).toBe('0%');
  });

  it('2 dòng chỉ số toàn đội xe nằm TRÊN dòng tiêu đề ngày', async () => {
    page();
    await screen.findByText('Tài xế A');
    const kepRow = screen.getByText('Tổng lệnh kẹp/ngày').closest('tr') as HTMLElement;
    const pctRow = screen.getByText('% Tỷ lệ kẹp ghép trong ngày').closest('tr') as HTMLElement;
    // Cả hai dòng chỉ số phải nằm trong thead, phía trên dòng tiêu đề ngày.
    expect(kepRow.tagName).toBe('TR');
    expect(kepRow.parentElement?.tagName).toBe('THEAD');
    expect(pctRow.parentElement?.tagName).toBe('THEAD');
    // Dòng tiêu đề ngày nằm NGAY DƯỚI hai dòng chỉ số (th trong thead nhận
    // accessible name ghép không khoảng cách — "1T3" — nên kiểm tra cấu trúc).
    const dayHeaderRow = pctRow.nextElementSibling as HTMLElement;
    expect(dayHeaderRow?.tagName).toBe('TR');
    expect(dayHeaderRow?.parentElement?.tagName).toBe('THEAD');
    expect([...dayHeaderRow.querySelectorAll('th')].some(th => (th.textContent ?? '').startsWith('1'))).toBe(true);
    // ngày 1: A=K, B=Đ, C=Đ → 1 kẹp / 3 lệnh = 33.3%
    expect(kepRow.querySelector('[class*="ts-report__cell"]')?.textContent).toBe('1');
    expect(pctRow.querySelector('[class*="ts-report__cell"]')?.textContent).toBe('33.3%');
  });

  it('màu ô theo spec REV 2: K đậm, Chủ nhật vàng, N nền đỏ chữ trắng', async () => {
    page();
    const rowA = (await screen.findByText('Tài xế A')).closest('tr') as HTMLElement;
    // K ngày 1 — chữ đậm trên nền trắng.
    expect(rowA.querySelector('[data-label="Ngày 1"]')?.className).toContain('ts-report__sym--k');
    // Chủ nhật ngày 2 — nền vàng.
    expect(rowA.querySelector('[data-label="Ngày 2"]')?.className).toContain('ts-report__cell--sunday');
    // N ngày 3 — nền đỏ.
    expect(rowA.querySelector('[data-label="Ngày 3"]')?.className).toContain('ts-report__cell--n');
    // quy ước ký hiệu in đầu báo cáo
    for (const symbol of ['K', 'Q', 'Đ', 'L', 'N', 'P']) {
      expect(screen.getAllByText(new RegExp(`^${symbol}`)).length).toBeGreaterThan(0);
    }
  });

  it('lái xe INACTIVE: cả chuỗi ngày tô nền đỏ đậm (nghỉ hẳn)', async () => {
    page();
    const rowC = (await screen.findByText('Tài xế C')).closest('tr') as HTMLElement;
    expect(rowC.querySelector('[data-label="Ngày 1"]')?.className).toContain('ts-report__cell--quit');
    expect(rowC.querySelector('[data-label="Ngày 2"]')?.className).toContain('ts-report__cell--quit');
    // Chuỗi đỏ đè cả ký hiệu trên dòng nghỉ hẳn.
    expect(rowC.querySelector('[data-label="Ngày 1"]')?.textContent).toBe('Đ');
    // Lái xe ACTIVE không dính class chuỗi đỏ.
    const rowA = (await screen.findByText('Tài xế A')).closest('tr') as HTMLElement;
    expect(rowA.querySelector('[data-label="Ngày 1"]')?.className).not.toContain('ts-report__cell--quit');
  });
});
