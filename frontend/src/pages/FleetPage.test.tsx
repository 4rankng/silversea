// K6.52 — 'Báo cáo năng suất' ngay trên /fleet (mục mà QA mở trong các bước tái
// hiện): thẻ toàn đội theo ngày gồm 6 chỉ số tổng hợp + bảng chi tiết từng xe,
// thẻ từng xe theo tháng (Sản lượng · Số xe hoạt động · % năng suất bình quân)
// kèm nút xuất bảng tính ở thẻ tháng.
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FleetPage from './FleetPage';

const { getDaily, getMonthly, getDailyExportBlob, getMonthlyExportBlob } = vi.hoisted(() => ({
  getDaily: vi.fn(),
  getMonthly: vi.fn(),
  getDailyExportBlob: vi.fn(),
  getMonthlyExportBlob: vi.fn(),
}));

vi.mock('../api/fleetProductivityClient', () => ({
  fleetProductivityClient: { getDaily, getMonthly, getDailyExportBlob, getMonthlyExportBlob },
}));
vi.mock('../components/shared/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../hooks/useCatalogQueries', () => ({
  useTrucksAndDrivers: () => ({ data: { trucks: [], drivers: [] } }),
}));
vi.mock('../api/configClient', () => ({
  configClient: { getTrailers: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../hooks/useCRUD', () => ({ useCRUD: () => ({}) }));
vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));
vi.mock('../features/fleet/truck-card', () => ({ TruckCard: () => null }));
vi.mock('../features/fleet/trailer-card', () => ({ TrailerCard: () => null }));
vi.mock('../features/fleet/driver-card', () => ({ DriverCard: () => null }));

const emptyBreakdown = {
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
};

const reportWire = {
  trucks: [],
  activeInternalTrucks: 1,
  totalInternalTrucks: 4,
  fleetBreakdown: emptyBreakdown,
};

beforeEach(() => {
  getDaily.mockReset().mockResolvedValue(reportWire);
  getMonthly.mockReset().mockResolvedValue(reportWire);
});

describe('FleetPage — mục Báo cáo năng suất theo K6.52', () => {
  it('hiện thẻ toàn đội theo ngày (6 chỉ số) và thẻ từng xe theo tháng (Sản lượng · Số xe hoạt động · % năng suất bình quân)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <FleetPage />
      </QueryClientProvider>,
    );

    const section = await screen.findByRole('region', { name: 'Báo cáo năng suất' });
    expect(section).toBeTruthy();

    // Thẻ toàn đội trong một ngày — nhóm 6 chỉ số tổng hợp.
    expect(await screen.findByText('Tổng chuyến trong ngày')).toBeTruthy();
    expect(screen.getByText('% Năng suất cao')).toBeTruthy();
    expect(screen.getByText("% Kẹp ghép (2×20')")).toBeTruthy();
    expect(screen.getByText('% Kết hợp (2 chiều)')).toBeTruthy();
    expect(screen.getByText('% Lấy lẻ chuyển kho')).toBeTruthy();
    expect(screen.getByText('% Chuyến đơn')).toBeTruthy();

    // Thẻ từng xe trong một tháng — đúng ba trường của K6.52.
    expect(screen.getByText('Sản lượng')).toBeTruthy();
    expect(screen.getByText('Số xe hoạt động')).toBeTruthy();
    expect(screen.getByText('% năng suất bình quân')).toBeTruthy();

    // Nút xuất bảng tính ở cả thẻ ngày và thẻ tháng (trong mục báo cáo).
    expect(within(section).getAllByRole('button', { name: 'Xuất Excel' })).toHaveLength(2);
  });
});
