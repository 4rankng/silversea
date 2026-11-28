import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OpsFleetTrackingPage from './OpsFleetTrackingPage';
import { MonthProvider, useMonth } from '../hooks/useMonth';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: { get: apiGet },
}));

/** A probe button inside the same MonthProvider the page reads, so a test can
 *  turn the global month picker exactly like the Topbar does. */
function MonthSwitchProbe({ month, year }: { month: number; year: number }) {
  const { setMonthYear } = useMonth();
  return (
    <button type="button" onClick={() => setMonthYear(month, year)}>
      Chọn tháng {month}/{year}
    </button>
  );
}

function renderPage(probe?: { month: number; year: number }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MonthProvider>
          {probe ? <MonthSwitchProbe {...probe} /> : null}
          <OpsFleetTrackingPage />
        </MonthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Ghi lại pathname hiện tại — đọc được sau mỗi lần điều hướng (pattern
 *  SIL-1222 của OpsOrdersPage.row-detail-navigation.test). */
function LocationProbe({ log }: { log: string[] }) {
  const location = useLocation();
  log[0] = location.pathname;
  return null;
}

function renderPageWithRoutes() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const log: string[] = [];
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/ops/fleet-tracking']}>
        <LocationProbe log={log} />
        <Routes>
          <Route path="/ops/fleet-tracking" element={<MonthProvider><OpsFleetTrackingPage /></MonthProvider>} />
          <Route path="/shipments/:id" element={<div data-testid="shipment-detail" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return log;
}

describe('OpsFleetTrackingPage (OpsVanHanh §4)', () => {
  beforeEach(() => apiGet.mockReset());

  it('renders assigned trucks with live trip state and the latest driver milestone', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          truckId: 1, licensePlate: '29A-123.45', trailerPlate: '29R-678.90',
          tripId: 10, tripCode: 'T-0010', shipmentCode: 'SS-100', billRef: 'BL-100', driverName: 'Tài A',
          status: 'IN_TRANSIT', lastEventType: 'LOADING_OR_RETURNING', updatedAt: '2026-09-07T01:02:03.000Z',
        },
        {
          truckId: 2, licensePlate: '30B-999.99', trailerPlate: null,
          tripId: null, tripCode: null, shipmentCode: null, billRef: null, driverName: null,
          status: null, lastEventType: null, updatedAt: null,
        },
      ],
    });
    renderPage();

    expect(await screen.findByText('29A-123.45')).toBeInTheDocument();
    expect(screen.getByText(/BL-100/)).toBeInTheDocument();
    expect(screen.getByText('Đang vận chuyển (đang đóng/trả hàng)')).toBeInTheDocument();
    expect(screen.getByText('Đang rảnh')).toBeInTheDocument();
    expect(screen.getByText('07/09/2026 08:02')).toBeInTheDocument();
  });

  // SIL-1088 (K2.85) — the board lists trucks at every level, never just the
  // one truck with an active command: mức 0 (Đang rảnh), mức 1 (Chờ nhận
  // lệnh), mức 2 (Đang vận chuyển + tiến độ), mức 3 (Đã hoàn thành), mức 4
  // (Dữ liệu chưa cập nhật) — five trucks, five rows, all observable.
  it('renders a multi-truck fleet across all five levels', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          truckId: 1, licensePlate: '15H-176.51', trailerPlate: 'RM-066.51',
          tripId: null, tripCode: null, shipmentCode: null, billRef: null, driverName: null,
          status: null, lastEventType: null, updatedAt: null,
        },
        {
          truckId: 2, licensePlate: '15H-176.93', trailerPlate: 'RM-066.65',
          tripId: 613, tripCode: 'W4A1-T3', shipmentCode: 'SS-613', billRef: 'W4A1', driverName: 'Phùng Đắc Phụng',
          status: 'CREATED', lastEventType: null, updatedAt: '2026-11-26T10:00:00.000Z',
        },
        {
          truckId: 3, licensePlate: '29A-123.45', trailerPlate: '29R-678.90',
          tripId: 620, tripCode: 'T-0620', shipmentCode: 'SS-620', billRef: 'BL-620', driverName: 'Tài B',
          status: 'IN_TRANSIT', lastEventType: 'ORDER_RECEIVED', updatedAt: '2026-11-26T12:30:00.000Z',
        },
        {
          truckId: 4, licensePlate: '30B-456.78', trailerPlate: null,
          tripId: 601, tripCode: 'T-0601', shipmentCode: 'SS-601', billRef: 'BL-601', driverName: 'Tài C',
          status: 'COMPLETED', lastEventType: null, updatedAt: '2026-11-20T15:45:00.000Z',
        },
        {
          truckId: 5, licensePlate: '51C-789.12', trailerPlate: null,
          tripId: null, tripCode: null, shipmentCode: null, billRef: null, driverName: null,
          status: null, lastEventType: null, updatedAt: null,
        },
      ],
    });
    renderPage();

    expect(await screen.findByText('15H-176.51')).toBeInTheDocument();
    expect(screen.getByText('15H-176.93')).toBeInTheDocument();
    expect(screen.getByText('29A-123.45')).toBeInTheDocument();
    expect(screen.getByText('30B-456.78')).toBeInTheDocument();
    expect(screen.getByText('51C-789.12')).toBeInTheDocument();
    // Mức 0 — idle truck, plain row (two of them).
    expect(screen.getAllByText('Đang rảnh')).toHaveLength(2);
    // Mức 1 — released, driver has not accepted yet.
    expect(screen.getByText('Chờ nhận lệnh')).toBeInTheDocument();
    // Mức 2 — accepted with recorded progress.
    expect(screen.getByText('Đang vận chuyển (đã nhận lệnh)')).toBeInTheDocument();
    // Mức 3 — ended work stays lookupable on its row.
    expect(screen.getByText('Đã hoàn thành')).toBeInTheDocument();
    // Mức 4 — stale data names its readout time, never a bare dash.
    expect(screen.getAllByText(/Dữ liệu chưa cập nhật/)).toHaveLength(2);
    expect(document.querySelectorAll('.ops-fleet__row')).toHaveLength(5);
  });

  // SIL-1088 — the month picker drives the lookup: the query carries the
  // selected VN month, and turning the picker refetches with the new month
  // ("tham số tháng bị bỏ qua" is the defect this pins shut).
  it('passes the selected month to the API and refetches when the month changes', async () => {
    apiGet.mockResolvedValue({ items: [] });
    renderPage({ month: 7, year: 2026 });

    await screen.findByText(/tra cứu hoàn thành tháng/);
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(1);
    });
    // The lookup month always rides the query (the picker's current month).
    expect(String(apiGet.mock.calls[0]?.[0])).toMatch(/month=\d{1,2}/);
    expect(String(apiGet.mock.calls[0]?.[0])).toMatch(/year=\d{4}/);

    fireEvent.click(screen.getByRole('button', { name: 'Chọn tháng 7/2026' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
    expect(String(apiGet.mock.calls[1]?.[0])).toContain('month=7');
    expect(String(apiGet.mock.calls[1]?.[0])).toContain('year=2026');
  });

  // SIL-1088 (K2.85) — mặc định mở 'Tất cả xe' (mức 0/3 quan sát được ngay,
  // không phụ thuộc cấu hình 'Ops phụ trách' thưa thớt); tab 'Xe phụ trách'
  // thu hẹp về đúng phạm vi PRD §4.
  it('opens on the whole fleet and narrows to the assigned scope on demand', async () => {
    apiGet.mockResolvedValue({ items: [] });
    renderPage();

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(1);
    });
    expect(String(apiGet.mock.calls[0]?.[0])).toContain('scope=all');

    fireEvent.click(screen.getByRole('tab', { name: 'Xe phụ trách' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
    expect(String(apiGet.mock.calls[1]?.[0])).toContain('scope=assigned');
  });

  it('renders a placeholder for an invalid update timestamp', async () => {
    apiGet.mockResolvedValue({ items: [{ truckId: 1, licensePlate: 'QA-INVALID', updatedAt: 'invalid' }] });
    renderPage();
    const row = (await screen.findByText('QA-INVALID')).closest('tr')!;
    expect(row.querySelector('[data-label="Cập nhật"]')).toHaveTextContent('—');
  });

  // SIL-975 (K10.54 §10.8.5) — chưa có bản ghi: nhãn "Dữ liệu chưa cập nhật"
  // kèm thời điểm kiểm, không bao giờ là '—' trần.
  it('names the missing data with its readout time instead of a bare dash', async () => {
    apiGet.mockResolvedValue({
      items: [{
        truckId: 2, licensePlate: '15H-176.93', trailerPlate: null,
        tripId: null, tripCode: null, shipmentCode: null, billRef: null, driverName: null,
        status: null, lastEventType: null, updatedAt: null,
      }],
    });
    renderPage();
    const row = (await screen.findByText('15H-176.93')).closest('tr')!;
    const cell = row.querySelector('[data-label="Cập nhật"]')!;
    expect(cell).toHaveTextContent('Dữ liệu chưa cập nhật');
    expect(cell).toHaveTextContent(/kiểm lúc \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    expect(cell.textContent).not.toBe('—');
  });

  it('is read-only: no write affordances, and shows the empty state', async () => {
    apiGet.mockResolvedValue({ items: [] });
    renderPage();

    // Mặc định 'Tất cả xe': bảng trống nói thẳng đội xe chưa có xe nào.
    expect(await screen.findByText(/Đội xe chưa có xe nào trong danh mục/)).toBeInTheDocument();
    // Controls on the page: the [Làm mới] button + the two scope tabs (role
    // "tab") — all read-side, no write affordance anywhere.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Làm mới' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Xe phụ trách' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tất cả xe' })).toBeInTheDocument();
    expect(screen.queryByText(/Xác nhận|Cập nhật tiến độ|Sửa/)).not.toBeInTheDocument();
    // PRD §4 — chưa có xe được giao: giải thích + hướng tới người quản lý
    // phân công, thay vì bảng trống khó hiểu (tab 'Xe phụ trách').
    fireEvent.click(screen.getByRole('tab', { name: 'Xe phụ trách' }));
    expect(await screen.findByText(/Chưa có xe nào được giao cho bạn quản lý/)).toBeInTheDocument();
  });

  it('distinguishes failed fleet requests from an empty board and retries', async () => {
    apiGet.mockRejectedValueOnce(new Error('Unavailable'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được phương tiện');
    expect(screen.queryByText(/Đội xe chưa có xe nào/)).not.toBeInTheDocument();
    apiGet.mockResolvedValue({ items: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText(/Đội xe chưa có xe nào/)).toBeInTheDocument();
  });

  // SIL-1311 (id 1617) — trạng thái là chip màu + dot dùng chung Pill.css
  // (như cột Trạng thái /users), không còn chữ thường không phân biệt được.
  it('renders each status as a colored pill with a house dot', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          truckId: 1, licensePlate: '29A-123.45', trailerPlate: null,
          tripId: 10, tripCode: 'T-0010', shipmentId: 501, shipmentCode: 'SS-100', billRef: 'BL-100', driverName: 'Tài A',
          status: 'IN_TRANSIT', lastEventType: 'ORDER_RECEIVED', updatedAt: '2026-09-07T01:02:03.000Z',
        },
        {
          truckId: 2, licensePlate: '30B-999.99', trailerPlate: null,
          tripId: null, tripCode: null, shipmentId: null, shipmentCode: null, billRef: null, driverName: null,
          status: null, lastEventType: null, updatedAt: null,
        },
      ],
    });
    renderPage();

    const liveRow = (await screen.findByText('29A-123.45')).closest('tr')!;
    const statusCell = liveRow.querySelector('[data-label="Trạng thái"]')!;
    // Đang vận chuyển = pill--info + dot, giữ nguyên cụm "(tiến độ)" trên pill.
    expect(statusCell.querySelector('.pill.pill--info .dot')).toBeTruthy();
    expect(statusCell).toHaveTextContent('Đang vận chuyển (đã nhận lệnh)');
    const idleRow = screen.getByText('30B-999.99').closest('tr')!;
    expect(idleRow.querySelector('[data-label="Trạng thái"] .pill.pill--neutral .dot')).toBeTruthy();
  });

  // SIL-1311 — ô tìm biển số / tài xế: fold dấu, khớp từng từ, đếm số xe
  // đang thấy, và nói thẳng khi không có xe nào khớp.
  it('filters rows by plate or driver (diacritic-folded) and names the no-match state', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          truckId: 1, licensePlate: '15C-167.31', trailerPlate: null,
          tripId: null, tripCode: null, shipmentId: null, shipmentCode: null, billRef: null,
          driverName: 'Lương Văn Long', status: null, lastEventType: null, updatedAt: null,
        },
        {
          truckId: 2, licensePlate: '30B-999.99', trailerPlate: null,
          tripId: null, tripCode: null, shipmentId: null, shipmentCode: null, billRef: null,
          driverName: 'Nguyễn Văn Thọ', status: null, lastEventType: null, updatedAt: null,
        },
      ],
    });
    renderPage();
    await screen.findByText('15C-167.31');

    const search = screen.getByRole('searchbox', { name: 'Tìm theo biển số hoặc tài xế' });
    // Fold dấu: "luong" khớp "Lương Văn Long".
    fireEvent.change(search, { target: { value: 'luong' } });
    expect(screen.getByText('15C-167.31')).toBeInTheDocument();
    expect(screen.queryByText('30B-999.99')).toBeNull();
    expect(screen.getByText(/1\/2 xe/)).toBeInTheDocument();

    // Biển số: khớp cả khi gõ thường, không dấu.
    fireEvent.change(search, { target: { value: '15c' } });
    expect(screen.getByText('15C-167.31')).toBeInTheDocument();
    expect(screen.queryByText('30B-999.99')).toBeNull();

    // Không khớp: nói rõ thay vì bảng trống khó hiểu.
    fireEvent.change(search, { target: { value: 'khong-co' } });
    expect(screen.getByText(/Không tìm thấy xe nào khớp/)).toBeInTheDocument();
    expect(screen.queryByText('15C-167.31')).toBeNull();
  });

  // SIL-1311 — bấm dòng mở chi tiết lô của chuyến đang gán (pattern SIL-1222);
  // dòng chưa có việc thì không có gì để mở, giữ nguyên trạng thái bất động.
  it('opens the assigned shipment detail on row click; idle rows stay inert', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          truckId: 1, licensePlate: '29A-123.45', trailerPlate: null,
          tripId: 10, tripCode: 'T-0010', shipmentId: 501, shipmentCode: 'SS-100', billRef: 'BL-100', driverName: 'Tài A',
          status: 'IN_TRANSIT', lastEventType: null, updatedAt: '2026-09-07T01:02:03.000Z',
        },
        {
          truckId: 2, licensePlate: '30B-999.99', trailerPlate: null,
          tripId: null, tripCode: null, shipmentId: null, shipmentCode: null, billRef: null, driverName: null,
          status: null, lastEventType: null, updatedAt: null,
        },
      ],
    });
    const log = renderPageWithRoutes();
    const linked = (await screen.findByText('29A-123.45')).closest('tr')!;
    const idle = screen.getByText('30B-999.99').closest('tr')!;

    expect(linked.classList.contains('ops-fleet__row--detail-link')).toBe(true);
    expect(idle.classList.contains('ops-fleet__row--detail-link')).toBe(false);
    expect(idle.hasAttribute('tabindex')).toBe(false);

    fireEvent.click(linked);
    expect(log[0]).toBe('/shipments/501');
  });

  it('opens the shipment detail on Enter over the focused row', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          truckId: 1, licensePlate: '29A-123.45', trailerPlate: null,
          tripId: 10, tripCode: 'T-0010', shipmentId: 501, shipmentCode: 'SS-100', billRef: 'BL-100', driverName: 'Tài A',
          status: 'IN_TRANSIT', lastEventType: null, updatedAt: '2026-09-07T01:02:03.000Z',
        },
      ],
    });
    const log = renderPageWithRoutes();
    const linked = (await screen.findByText('29A-123.45')).closest('tr')!;
    expect(linked.getAttribute('tabindex')).toBe('0');

    fireEvent.keyDown(linked, { key: 'Enter' });
    expect(log[0]).toBe('/shipments/501');
  });

});
