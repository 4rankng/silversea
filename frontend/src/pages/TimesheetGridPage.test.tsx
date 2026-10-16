// FB-101 (card 141026230780) — chấm công không bị ẩn với kế toán: mở lưới
// xem được cho ACCOUNTANT nhưng ô read-only và KHÔNG có nút "Lưu lưới" (backend
// chặn ghi lưới ngoài dispatcherOrAbove); Điều vận vẫn nhập bình thường.

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';
import type { TimesheetDayCell, TimesheetDriverRow, TimesheetMonth } from '../api/timesheetClient';

const { listDrivers, listMonths, saveDays, currentUser } = vi.hoisted(() => ({
  listDrivers: vi.fn(),
  listMonths: vi.fn(),
  saveDays: vi.fn(),
  currentUser: { userId: 1, role: 'DISPATCHER' as string },
}));

vi.mock('../api/timesheetClient', () => ({
  listTimesheetDrivers: (...args: unknown[]) => listDrivers(...args),
  listTimesheetMonths: (...args: unknown[]) => listMonths(...args),
  saveTimesheetDays: (...args: unknown[]) => saveDays(...args),
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
  id: 1, name: 'Tài xế A', status: 'ACTIVE', monthId: 5, salaryMode: 'PER_TRIP', monthStatus: 'OPEN',
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
