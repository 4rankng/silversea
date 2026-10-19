// FB-101 (card 141026230780) — chấm công không bị ẩn với kế toán: mở lưới
// xem được cho ACCOUNTANT nhưng ô read-only và KHÔNG có nút "Lưu lưới" (backend
// chặn ghi lưới ngoài dispatcherOrAbove); Điều vận vẫn nhập bình thường.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';
import type { TimesheetDayCell, TimesheetDriverRow, TimesheetMonth } from '../api/timesheetClient';

const { listDrivers, listMonths, saveDays, createMonth, currentUser } = vi.hoisted(() => ({
  listDrivers: vi.fn(),
  listMonths: vi.fn(),
  saveDays: vi.fn(),
  createMonth: vi.fn(),
  currentUser: { userId: 1, role: 'DISPATCHER' as string },
}));

vi.mock('../api/timesheetClient', () => ({
  listTimesheetDrivers: (...args: unknown[]) => listDrivers(...args),
  listTimesheetMonths: (...args: unknown[]) => listMonths(...args),
  saveTimesheetDays: (...args: unknown[]) => saveDays(...args),
  createTimesheetMonth: (...args: unknown[]) => createMonth(...args),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: currentUser }) }));
vi.mock('../design-system/hooks/useMonthRoute', () => ({
  useMonthRoute: () => ({ month: 10, year: 2026, goPrev: vi.fn(), goNext: vi.fn() }),
}));
vi.mock('../components/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));

import TimesheetGridPage from './TimesheetGridPage';

const day = (workDate: string, overrides: Partial<TimesheetDayCell> = {}): TimesheetDayCell => ({
  id: 1, workDate, symbol: null, trips: 0, isSunday: false, tripAdjustment: 0,
  note: null, enteredBy: null, enteredAt: null, adjustedBy: null, adjustedAt: null,
  ...overrides,
});

const driver: TimesheetDriverRow = {
  id: 1, name: 'Tài xế A', status: 'ACTIVE', plateNumber: '29H-12345', vehicleClass: 'Đầu kéo',
  monthId: 5, salaryMode: 'PER_TRIP', monthStatus: 'OPEN', defaultSalaryMode: 'PER_TRIP',
};

const month: TimesheetMonth = {
  id: 5, driverId: 1, driverName: 'Tài xế A', year: 2026, month: 10,
  salaryMode: 'PER_TRIP', dailyBase: null, flatAmount: null,
  status: 'OPEN', reconciledBy: null, reconciledAt: null, reconcileNote: null,
  days: [day('2026-10-05'), day('2026-10-06', { symbol: 'K', trips: 1 })],
  salary: {
    trips: 1, workdays: 1, symbolCounts: { K: 1, Q: 0, 'Đ': 0, L: 0, N: 0, P: 0 },
    symbolDays: { K: 1, Q: 0, 'Đ': 0, L: 0, N: 0, P: 0 },
    bonusTrips: 0, perTripPay: 300000, extraTripBonus: 0, dailyBasePay: 0,
    salaryTotal: 300000, mode: 'PER_TRIP',
  },
  warnings: [],
};

function page() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TimesheetGridPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listDrivers.mockReset().mockResolvedValue([driver]);
  listMonths.mockReset().mockResolvedValue([month]);
  saveDays.mockReset();
  createMonth.mockReset().mockResolvedValue(month);
  currentUser.role = Role.DISPATCHER;
});

describe('TimesheetGridPage role surface (FB-101)', () => {
  it('Điều vận nhập được lưới và có nút Lưu lưới', async () => {
    page();
    expect(await screen.findByRole('button', { name: /Lưu lưới/ })).toBeVisible();
    const cells = await screen.findAllByRole('textbox');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell).not.toHaveAttribute('readonly');
  });

  it('kế toán xem được lưới (ô read-only) nhưng không có nút Lưu lưới', async () => {
    currentUser.role = Role.ACCOUNTANT;
    page();
    await screen.findAllByRole('textbox');
    expect(screen.queryByRole('button', { name: /Lưu lưới/ })).toBeNull();
    for (const cell of screen.getAllByRole('textbox')) expect(cell).toHaveAttribute('readonly');
  });
});

describe('mở bảng chấm công (FB-102/FB-103 — card 141026230790/230800)', () => {
  it('tháng chưa có bảng: kế toán mở bảng với hình thức lương mặc định Lương theo chuyến', async () => {
    currentUser.role = Role.ACCOUNTANT;
    listMonths.mockReset().mockResolvedValue([]);
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Mở bảng chấm công/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Mở bảng/ }));
    await waitFor(() => expect(createMonth).toHaveBeenCalledWith({
      driverId: 1, year: 2026, month: 10, salaryMode: 'PER_TRIP', dailyBase: null,
    }));
  });

  it('chọn Lương theo tháng (trốn vé) + lương tháng cố định khi mở bảng', async () => {
    currentUser.role = Role.ACCOUNTANT;
    listMonths.mockReset().mockResolvedValue([]);
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Mở bảng chấm công/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Hình thức lương/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lương theo tháng (trốn vé)' }));
    fireEvent.change(within(dialog).getByLabelText('Lương tháng cố định (VND)'), { target: { value: '10000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Mở bảng$/ }));
    await waitFor(() => expect(createMonth).toHaveBeenCalledWith({
      driverId: 1, year: 2026, month: 10, salaryMode: 'FLAT_MONTHLY', flatAmount: 10000000,
    }));
  });

  // FB-103 (ticket 171026215600) — modal mở với chế độ mặc định CỦA LÁI XE
  // (đặt trong dialog "Sửa lương cứng" / dialog sửa lái xe), không ép PER_TRIP.
  it('mở bảng với sẵn chế độ của lái xe khi lái xe đặt Lương theo tháng', async () => {
    currentUser.role = Role.ACCOUNTANT;
    listDrivers.mockReset().mockResolvedValue([{ ...driver, defaultSalaryMode: 'FLAT_MONTHLY' as const }]);
    listMonths.mockReset().mockResolvedValue([]);
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Mở bảng chấm công/ }));
    const dialog = await screen.findByRole('dialog');
    // Select hiển thị sẵn chế độ của lái xe — không cần chọn lại.
    const modeTrigger = within(dialog).getByRole('button', { name: /Hình thức lương/ });
    expect(modeTrigger.textContent).toContain('Lương theo tháng (trốn vé)');
    fireEvent.change(within(dialog).getByLabelText('Lương tháng cố định (VND)'), { target: { value: '9000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Mở bảng$/ }));
    await waitFor(() => expect(createMonth).toHaveBeenCalledWith({
      driverId: 1, year: 2026, month: 10, salaryMode: 'FLAT_MONTHLY', flatAmount: 9000000,
    }));
  });

  it('Điều vận không thấy nút mở bảng — việc đó của kế toán', async () => {
    listMonths.mockReset().mockResolvedValue([]);
    page();
    await screen.findByText(/chưa có bảng chấm công/);
    expect(screen.queryByRole('button', { name: /Mở bảng chấm công/ })).toBeNull();
  });
});
