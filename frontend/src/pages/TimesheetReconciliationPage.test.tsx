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
      tripAdjustment: 0, note: null, enteredBy: 2, enteredAt: null, adjustedBy: null, adjustedAt: null,
    },
    {
      id: 12, workDate: '2026-10-11', symbol: 'Đ', trips: 1, isSunday: true,
      tripAdjustment: 0, note: null, enteredBy: 2, enteredAt: null, adjustedBy: null, adjustedAt: null,
    },
  ],
  salary: {
    mode: 'PER_TRIP', symbolCounts: { K: 0, Q: 2, 'Đ': 1, L: 0, N: 0, P: 0 },
    symbolDays: { K: 0, Q: 1, 'Đ': 1, L: 0, N: 0, P: 0 },
    trips: 3, workdays: 1, bonusTrips: 0, perTripPay: 900_000, extraTripBonus: 0,
    dailyBasePay: 200_000, salaryTotal: 1_100_000,
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
    expect(screen.getByText('1.100.000')).toBeTruthy();
  });

  it('marks the Sunday row so the separate Sunday pay is visible', async () => {
    renderBoard();
    expect((await screen.findAllByText('Chủ nhật')).length).toBeGreaterThan(0);
  });

  it('tells the accountant a negative correction is allowed', async () => {
    renderBoard();
    expect(await screen.findByText(/Chỉnh lệch chuyến nhập số âm được/)).toBeTruthy();
  });
});