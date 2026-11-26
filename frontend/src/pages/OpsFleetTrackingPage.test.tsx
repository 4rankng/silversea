import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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

  // SIL-1088 — the missing "bộ lọc 'tất cả xe'": 'Tất cả xe' opens the whole
  // fleet (mức 0 observable); the default view is the explicit PRD §4 scope.
  it('switches the truck scope and refetches with scope=all', async () => {
    apiGet.mockResolvedValue({ items: [] });
    renderPage();

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(1);
    });
    expect(String(apiGet.mock.calls[0]?.[0])).toContain('scope=assigned');

    fireEvent.click(screen.getByRole('tab', { name: 'Tất cả xe' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
    expect(String(apiGet.mock.calls[1]?.[0])).toContain('scope=all');
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

    expect(await screen.findByText(/Chưa có xe nào được giao cho bạn quản lý/)).toBeInTheDocument();
    // Controls on the page: the [Làm mới] button + the two scope tabs (role
    // "tab") — all read-side, no write affordance anywhere.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Làm mới' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Xe phụ trách' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tất cả xe' })).toBeInTheDocument();
    expect(screen.queryByText(/Xác nhận|Cập nhật tiến độ|Sửa/)).not.toBeInTheDocument();
  });

  it('distinguishes failed fleet requests from an empty assignment and retries', async () => {
    apiGet.mockRejectedValueOnce(new Error('Unavailable'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được phương tiện');
    expect(screen.queryByText(/Chưa có xe nào được giao/)).not.toBeInTheDocument();
    apiGet.mockResolvedValue({ items: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText(/Chưa có xe nào được giao/)).toBeInTheDocument();
  });

});
