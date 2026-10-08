import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyFleetProductivityResponse, MonthlyFleetProductivityResponse } from '@tingting/shared';

const getDailyMock = vi.hoisted(() => vi.fn());
const getMonthlyMock = vi.hoisted(() => vi.fn());
const exportMonthlyBlobMock = vi.hoisted(() => vi.fn());

vi.mock('../api/fleetProductivityClient', () => ({
  fleetProductivityClient: {
    getDaily: getDailyMock,
    getMonthly: getMonthlyMock,
    getMonthlyExportBlob: exportMonthlyBlobMock,
  },
}));

vi.mock('../components/shared/Breadcrumbs', () => ({
  Breadcrumbs: () => <nav data-testid="breadcrumbs">Breadcrumbs</nav>,
}));

import FleetProductivityPage from './FleetProductivityPage';

const mockDailyData: DailyFleetProductivityResponse = {
  date: '2026-10-03',
  totalInternalTrucks: 39,
  activeInternalTrucks: 2,
  fleetBreakdown: {
    totalTrips: 10,
    kepTrips: 4,
    pctKep: 40,
    ketHopTrips: 3,
    pctKetHop: 30,
    layLeTrips: 2,
    pctLayLe: 20,
    donTrips: 1,
    pctDon: 10,
    highEfficiencyPct: 90,
  },
  trucks: [
    {
      truckId: 1,
      licensePlate: '15C-12345',
      driverName: 'Nguyễn Văn A',
      breakdown: {
        totalTrips: 6,
        kepTrips: 2,
        pctKep: 33.33,
        ketHopTrips: 2,
        pctKetHop: 33.33,
        layLeTrips: 1,
        pctLayLe: 16.67,
        donTrips: 1,
        pctDon: 16.67,
        highEfficiencyPct: 83.33,
      },
      tripCodes: ['TRP-001', 'TRP-002'],
    },
    {
      truckId: 2,
      licensePlate: '15C-67890',
      driverName: 'Trần Văn B',
      breakdown: {
        totalTrips: 4,
        kepTrips: 2,
        pctKep: 50,
        ketHopTrips: 1,
        pctKetHop: 25,
        layLeTrips: 1,
        pctLayLe: 25,
        donTrips: 0,
        pctDon: 0,
        highEfficiencyPct: 100,
      },
      tripCodes: ['TRP-003'],
    },
  ],
};

const mockMonthlyData: MonthlyFleetProductivityResponse = {
  month: 10,
  year: 2026,
  totalInternalTrucks: 39,
  activeInternalTrucks: 2,
  fleetBreakdown: {
    totalTrips: 50,
    kepTrips: 20,
    pctKep: 40,
    ketHopTrips: 15,
    pctKetHop: 30,
    layLeTrips: 10,
    pctLayLe: 20,
    donTrips: 5,
    pctDon: 10,
    highEfficiencyPct: 90,
  },
  trucks: [
    {
      truckId: 1,
      licensePlate: '15C-12345',
      driverName: 'Nguyễn Văn A',
      breakdown: {
        totalTrips: 30,
        kepTrips: 12,
        pctKep: 40,
        ketHopTrips: 9,
        pctKetHop: 30,
        layLeTrips: 6,
        pctLayLe: 20,
        donTrips: 3,
        pctDon: 10,
        highEfficiencyPct: 90,
      },
    },
    {
      truckId: 2,
      licensePlate: '15C-67890',
      driverName: 'Trần Văn B',
      breakdown: {
        totalTrips: 20,
        kepTrips: 8,
        pctKep: 40,
        ketHopTrips: 6,
        pctKetHop: 30,
        layLeTrips: 4,
        pctLayLe: 20,
        donTrips: 2,
        pctDon: 10,
        highEfficiencyPct: 90,
      },
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FleetProductivityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FleetProductivityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDailyMock.mockResolvedValue(mockDailyData);
    getMonthlyMock.mockResolvedValue(mockMonthlyData);
    exportMonthlyBlobMock.mockResolvedValue(new Blob(['xlsx-bytes'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  });

  it('renders daily view by default with KPIs and active truck breakdown', async () => {
    renderPage();

    expect(await screen.findByText('Hiệu quả Năng suất Xe Nội Bộ')).toBeTruthy();
    expect(screen.getByText('Toàn đội trong 1 ngày')).toBeTruthy();
    expect(screen.getByText('Từng xe trong 1 tháng')).toBeTruthy();

    // Check active truck rows and summary footer
    await waitFor(() => {
      expect(screen.getByText('15C-12345')).toBeTruthy();
      expect(screen.getByText('15C-67890')).toBeTruthy();
    });

    expect(screen.getByText('Nguyễn Văn A')).toBeTruthy();
    expect(screen.getByText('Trần Văn B')).toBeTruthy();
    expect(screen.getByText('TỔNG CỘNG TOÀN ĐỘI')).toBeTruthy();
  });

  it('switches to monthly tab and displays monthly truck table and summary footer', async () => {
    renderPage();

    await screen.findByText('Hiệu quả Năng suất Xe Nội Bộ');

    const monthlyTabBtn = screen.getByText('Từng xe trong 1 tháng');
    fireEvent.click(monthlyTabBtn);

    await waitFor(() => {
      expect(getMonthlyMock).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), undefined);
    });

    expect(await screen.findByText('Biển số xe')).toBeTruthy();
    expect(screen.getByText('Lái xe chính')).toBeTruthy();
    expect(await screen.findByText('TỔNG CỘNG TOÀN ĐỘI')).toBeTruthy();
    expect(screen.getByText('Xuất Excel')).toBeTruthy();
  });

  it('handles monthly excel export click through the authenticated blob download (card 346)', async () => {
    // The old contract opened the bare /api URL in a new tab — a navigation
    // that carries NO Authorization header, so the export died with
    // {"error":"Token không hợp lệ"} (P1, user report 04/10). The contract is
    // the house export pattern: authenticated blob → anchor download.
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:export-346'),
      revokeObjectURL: vi.fn(),
    }));
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPage();

    const monthlyTabBtn = screen.getByText('Từng xe trong 1 tháng');
    fireEvent.click(monthlyTabBtn);

    // Wait for monthly table to load so the export button becomes enabled
    expect(await screen.findByText('Biển số xe')).toBeTruthy();

    const exportBtn = screen.getByText('Xuất Excel');
    fireEvent.click(exportBtn);

    await waitFor(() => expect(exportMonthlyBlobMock).toHaveBeenCalledWith(2026, 10));
    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(anchorClickSpy).toHaveBeenCalled();
    const anchor = anchorClickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('bao-cao-nang-suat-xe-noi-bo-10-2026.xlsx');

    anchorClickSpy.mockRestore();
    windowOpenSpy.mockRestore();
  });

  it('surfaces an error when the export download fails (no silent failure)', async () => {
    exportMonthlyBlobMock.mockRejectedValue(new Error('network'));
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPage();
    fireEvent.click(screen.getByText('Từng xe trong 1 tháng'));
    expect(await screen.findByText('Biển số xe')).toBeTruthy();
    fireEvent.click(screen.getByText('Xuất Excel'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Không xuất được báo cáo/);
    expect(anchorClickSpy).not.toHaveBeenCalled();
    anchorClickSpy.mockRestore();
  });
});
