import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { MonthlyProductivityView } from './MonthlyProductivityView';

const { getMonthly, getMonthlyExportBlob } = vi.hoisted(() => ({
  getMonthly: vi.fn(),
  getMonthlyExportBlob: vi.fn(),
}));

vi.mock('../../api/fleetProductivityClient', () => ({
  fleetProductivityClient: { getMonthly, getMonthlyExportBlob },
}));

const monthly = {
  trucks: [{
    truckId: 9,
    licensePlate: '15C-123.45',
    driverName: 'Nguyễn Văn An',
    breakdown: {
      totalTrips: 2,
      kepTrips: 0,
      pctKep: 0,
      ketHopTrips: 0,
      pctKetHop: 0,
      layLeTrips: 0,
      pctLayLe: 0,
      donTrips: 0,
      pctDon: 0,
      highEfficiencyPct: 50,
    },
  }],
  activeInternalTrucks: 1,
  totalInternalTrucks: 1,
  fleetBreakdown: {
    totalTrips: 2,
    highEfficiencyPct: 50,
    pctKep: 0,
    kepTrips: 0,
    pctKetHop: 0,
    ketHopTrips: 0,
    pctLayLe: 0,
    layLeTrips: 0,
    pctDon: 0,
    donTrips: 0,
  },
};

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MonthlyProductivityView />
    </QueryClientProvider>,
  );
}

// Card 367 law pin (docs/design-guidelines.md §2026-10-05): a 4xx business
// refusal renders the API's error message verbatim — never copy that hides it.
describe('MonthlyProductivityView export errors surface the API reason', () => {
  it('a 4xx export refusal shows the backend message, not the generic retry hint', async () => {
    getMonthly.mockResolvedValue(monthly);
    getMonthlyExportBlob.mockRejectedValueOnce(
      new ApiError(400, { error: 'Năm báo cáo không hợp lệ' }, 'Năm báo cáo không hợp lệ'),
    );
    renderView();

    // The export button renders disabled while the monthly query loads —
    // wait for the data KPIs before clicking, or the click is a no-op.
    await screen.findByText('Tổng chuyến trong tháng');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Năm báo cáo không hợp lệ');
    expect(screen.queryByText(/Không xuất được báo cáo năng suất/)).toBeNull();
  });

  it('a non-API failure keeps the generic fallback (no raw error leak)', async () => {
    getMonthly.mockResolvedValue(monthly);
    getMonthlyExportBlob.mockRejectedValueOnce(new Error('network unavailable'));
    renderView();

    await screen.findByText('Tổng chuyến trong tháng');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Không xuất được báo cáo năng suất. Vui lòng thử lại.');
  });
});
