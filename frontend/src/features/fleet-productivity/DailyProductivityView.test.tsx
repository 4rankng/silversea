import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { DailyProductivityView } from './DailyProductivityView';

const { getDaily, getDailyExportBlob } = vi.hoisted(() => ({
  getDaily: vi.fn(),
  getDailyExportBlob: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('../../api/fleetProductivityClient', () => ({
  fleetProductivityClient: { getDaily, getDailyExportBlob },
}));
vi.mock('../../components/shared/Toast', () => ({ useToast: () => ({ toast }) }));

const daily = {
  date: '2026-11-24',
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
    tripReferences: ['BILL-001'],
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
      <DailyProductivityView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getDaily.mockReset();
  getDailyExportBlob.mockReset();
  toast.mockReset();
  // jsdom does not implement the blob URL lifecycle — stub the two statics.
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

// Card 367 law pin (docs/design-guidelines.md §2026-10-05): a 4xx business
// refusal renders the API's error message verbatim — never copy that hides it.
describe('DailyProductivityView export errors surface the API reason', () => {
  it('a 4xx export refusal shows the backend message, not the generic retry hint', async () => {
    getDaily.mockResolvedValue(daily);
    getDailyExportBlob.mockRejectedValueOnce(
      new ApiError(400, { error: 'Ngày báo cáo không hợp lệ (YYYY-MM-DD)' }, 'Ngày báo cáo không hợp lệ (YYYY-MM-DD)'),
    );
    renderView();

    // The export button renders disabled while the daily query loads —
    // wait for the data KPIs before clicking, or the click is a no-op.
    await screen.findByText('Tổng chuyến trong ngày');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ngày báo cáo không hợp lệ (YYYY-MM-DD)');
    expect(screen.queryByText(/Không xuất được báo cáo năng suất/)).toBeNull();
  });

  it('a non-API failure keeps the generic fallback (no raw error leak)', async () => {
    getDaily.mockResolvedValue(daily);
    getDailyExportBlob.mockRejectedValueOnce(new Error('network unavailable'));
    renderView();

    await screen.findByText('Tổng chuyến trong ngày');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Không xuất được báo cáo năng suất. Vui lòng thử lại.');
  });
});

// Card 20261006_391 — the export feedback contract (FinancePage pattern): the
// happy path must not stay silent after the failure surface already exists.
describe('DailyProductivityView export success feedback', () => {
  it('shows a busy label while building the xlsx and toasts success when the download starts', async () => {
    getDaily.mockResolvedValue(daily);
    let resolveBlob: (b: Blob) => void = () => {};
    getDailyExportBlob.mockImplementationOnce(
      () => new Promise<Blob>((resolve) => { resolveBlob = resolve; }),
    );
    renderView();

    await screen.findByText('Tổng chuyến trong ngày');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));
    expect(screen.getByRole('button', { name: 'Đang xuất…' })).toBeTruthy();

    resolveBlob(new Blob(['bc']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy());
    expect(toast).toHaveBeenCalledWith({ kind: 'success', message: 'Đã xuất báo cáo năng suất xe ra tệp Excel.' });
  });

  it('requests the export for the selected report date', async () => {
    getDaily.mockResolvedValue(daily);
    getDailyExportBlob.mockResolvedValueOnce(new Blob(['bc']));
    renderView();

    await screen.findByText('Tổng chuyến trong ngày');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));

    await waitFor(() => expect(getDailyExportBlob).toHaveBeenCalledTimes(1));
    expect(getDailyExportBlob).toHaveBeenCalledWith(daily.date);
  });
});
