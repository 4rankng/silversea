import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';

const shipmentsPageCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
// vi.hoisted runs before vi.mock's factory is invoked, so the mock fn is
// accessible inside the factory. (Vitest hoists vi.mock above all top-level
// declarations — referencing a plain const from the factory throws
// ReferenceError.)
const { apiGet, apiPut, authState } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  authState: { role: 'ACCOUNTANT' },
}));

vi.mock('../lib/api', () => ({
  api: { get: apiGet, put: apiPut },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, _body: unknown, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

// Mock usePageAnimations — it depends on browser animation APIs that aren't
// available in jsdom. We only need the rootRef passthrough.
vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: authState.role } }),
}));

import ShipmentsPage from './ShipmentsPage';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ShipmentsPage />
      <CurrentPath />
    </MemoryRouter>,
  );
}

function CurrentPath() {
  const location = useLocation();
  return <span hidden data-testid="current-path">{location.pathname}</span>;
}

// Page title appears in BOTH the breadcrumb trail AND the PageHeader <h1>.
// Query the <h1> specifically to disambiguate.
function pageTitleH1() {
  return document.querySelector('h1.page-title');
}

// The page renders two parallel surfaces — a desktop <table> and a mobile
// card list — that CSS shows/hides by viewport. jsdom doesn't compute CSS
// layout, so both stay in the DOM. Scope row-level queries to one surface to
// avoid "multiple elements" errors. The desktop surface is the canonical
// list view, so prefer it.
function desktopSurface() {
  const el = document.querySelector('.shipments-page__desktop');
  if (!el) throw new Error('desktop surface not rendered');
  return within(el as HTMLElement);
}

// The toolbar is the third shared surface. Lifecycle KPI labels collide with
// filter-pill text, so filter-pill
// assertions must scope to the toolbar.
function toolbar() {
  const el = document.querySelector('.shipments-page__toolbar');
  if (!el) throw new Error('toolbar not rendered');
  return within(el as HTMLElement);
}

function mobileSurface() {
  const el = document.querySelector('.shipments-page__mobile');
  if (!el) throw new Error('mobile surface not rendered');
  return within(el as HTMLElement);
}

describe('ShipmentsPage — shipment manifest workspace', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
    authState.role = 'ACCOUNTANT';
    const stored: Record<string, string> = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => stored[key] ?? null,
        setItem: (key: string, value: string) => { stored[key] = value; },
        removeItem: (key: string) => { delete stored[key]; },
        clear: () => { Object.keys(stored).forEach((key) => delete stored[key]); },
      },
    });
  });

  it('renders the page header and toolbar', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    renderAt('/shipments');
    expect(pageTitleH1()?.textContent).toBe('Lô hàng');
    // Filter pills render the catalogue. Scope to the toolbar — KPI labels
    // lifecycle labels would otherwise collide.
    const tb = toolbar();
    expect(tb.getByText(/Tất cả/)).toBeTruthy();
    expect(tb.getByText('Chờ chốt lịch')).toBeTruthy();
    expect(tb.getByText('Sẵn sàng điều xe')).toBeTruthy();
    expect(tb.getByText('Đã điều xe')).toBeTruthy();
    expect(tb.getByText('Đang chạy')).toBeTruthy();
    expect(tb.getByText('Chờ duyệt phí')).toBeTruthy();
    expect(tb.getByText('Hoàn thành')).toBeTruthy();
    expect(tb.queryByText('Đã hủy')).toBeNull();
    expect(tb.getByRole('button', { name: /Tất cả/ }).getAttribute('aria-pressed')).toBe('true');
    expect(tb.getByRole('button', { name: /^Chờ chốt lịch/ }).getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
  });

  it('shows create only to shipment operators', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    authState.role = 'ADMIN';
    const { unmount } = renderAt('/shipments');
    expect(screen.getByRole('link', { name: /Tạo lô hàng/i }).getAttribute('href')).toBe('/shipments/new');
    unmount();

    authState.role = 'ACCOUNTANT';
    renderAt('/shipments');
    expect(screen.queryByRole('link', { name: /Tạo lô hàng/i })).toBeNull();
  });

  it('removes the redundant breadcrumb from the phone layout', () => {
    expect(shipmentsPageCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.shipments-page__crumbs\s*\{\s*display:\s*none;/,
    );
  });

  it('keeps narrow-screen controls reachable and touch friendly', () => {
    expect(shipmentsPageCss).toMatch(
      /\.shipments-page__mobile \.ds-pagination__controls\s*\{[\s\S]*?overflow-x:\s*auto;/,
    );
    expect(shipmentsPageCss).toMatch(
      /\.shipments-page__filters \.filter-pill\s*\{[\s\S]*?min-height:\s*44px;/,
    );
  });

  it('renders the actual expected delivery date instead of an earlier milestone', async () => {
    apiGet.mockResolvedValue({
      items: [{
        id: 1,
        shipmentCode: 'SHP-2608-00001',
        customerId: 7,
        customerName: 'Công ty TNHH Long Minh',
        status: ShipmentStatus.PENDING_EXPENSE_APPROVAL,
        bookingRef: 'BK-1',
        blNumber: 'BL-1',
        expectedDeliveryDate: '2026-08-15',
        closingAt: '2026-08-05T08:00:00Z',
        pickupLocation: null,
        deliveryLocation: null,
        contactName: null,
        contactPhone: null,
        version: 1,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
      }],
      total: 1,
      page: 1,
      limit: 20,
    });

    renderAt('/shipments');
    const desktop = desktopSurface();
    await waitFor(() => expect(desktop.getByText('15/8/2026')).toBeTruthy());
    expect(desktop.queryByText('5/8/2026')).toBeNull();
  });

  it('renders the empty state when the API returns no shipments', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    renderAt('/shipments');
    // Both surfaces show an empty state; assert against the desktop one.
    await waitFor(() => expect(desktopSurface().getByText(/Chưa có lô hàng nào/)).toBeTruthy());
    // The api client prepends API_BASE ('/api') at fetch time, so the
    // call-site path must be '/shipments' (NOT '/api/shipments') — otherwise
    // the request goes to /api/api/shipments and 404s in production.
    expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/shipments\?/));
  });

  it('renders the list rows when the API returns shipments', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          id: 1, shipmentCode: 'SHP-2607-00001', customerId: 7, customerName: 'Công ty CP Vận tải ABC',
          status: ShipmentStatus.NEW, bookingRef: 'BK-1', blNumber: 'BL-1',
          expectedDeliveryDate: '2026-08-01', pickupLocation: null,
          deliveryLocation: null, contactName: null, contactPhone: null,
          version: 1, createdAt: '2026-07-25T00:00:00Z', updatedAt: '2026-07-25T00:00:00Z',
        },
        {
          id: 2, shipmentCode: 'SHP-2607-00002', customerId: 9, customerName: 'Công ty TNHH XYZ Logistik',
          status: ShipmentStatus.DISPATCHED, bookingRef: null, blNumber: 'BL-2',
          expectedDeliveryDate: null, pickupLocation: null, deliveryLocation: null,
          contactName: null, contactPhone: null,
          version: 3, createdAt: '2026-07-25T00:00:00Z', updatedAt: '2026-07-25T00:00:00Z',
        },
      ],
      total: 2, page: 1, limit: 20,
    });
    renderAt('/shipments');
    const desktop = desktopSurface();
    await waitFor(() => expect(desktop.getByText('SHP-2607-00001')).toBeTruthy());
    expect(desktop.getByText('SHP-2607-00002')).toBeTruthy();
    // Customer name renders (joined from customers.name by the backend).
    // Guards against regressing to the meaningless "KH #id" label.
    expect(desktop.getByText('Công ty CP Vận tải ABC')).toBeTruthy();
    // Status labels render in the row pills. Scoped to the desktop table to
    // avoid colliding with the mobile card pills.
    expect(desktop.getAllByText('Chờ chốt lịch').length).toBeGreaterThanOrEqual(1);
    expect(desktop.getAllByText('Đã điều xe').length).toBeGreaterThanOrEqual(1);
    expect(desktop.getByText((_, element) => Boolean(
      element?.classList.contains('shipments-page__td--date')
      && element.textContent?.includes('1/8/2026'),
    ))).toBeTruthy();
  });

  it('uses neutral business labels when shipment and customer names are unavailable', async () => {
    apiGet.mockResolvedValue({
      items: [{
        id: 801,
        shipmentCode: null,
        customerId: 7,
        customerName: null,
        status: ShipmentStatus.NEW,
        bookingRef: null,
        blNumber: null,
        expectedDeliveryDate: null,
        pickupLocation: null,
        deliveryLocation: null,
        contactName: null,
        contactPhone: null,
        version: 1,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
      }],
      total: 1,
      page: 1,
      limit: 20,
    });

    renderAt('/shipments');
    const desktop = desktopSurface();
    await waitFor(() => expect(desktop.getByText('Chưa có mã lô hàng')).toBeTruthy());
    expect(desktop.getByText('Chưa có tên khách hàng')).toBeTruthy();
    expect(desktop.queryByText('#801')).toBeNull();
    expect(desktop.queryByText('#7')).toBeNull();
  });

  it('keeps pagination available on the mobile list', async () => {
    apiGet.mockResolvedValue({
      items: [{
        id: 1, shipmentCode: 'SHP-2607-00001', customerId: 7, customerName: 'Công ty CP Vận tải ABC',
        status: ShipmentStatus.NEW, bookingRef: 'BK-1', blNumber: 'BL-1',
        expectedDeliveryDate: null, pickupLocation: 'Cảng Cát Lái',
        deliveryLocation: 'Kho Bình Dương', contactName: null, contactPhone: null,
        version: 1, createdAt: '', updatedAt: '',
      }],
      total: 21, page: 1, limit: 20,
    });

    renderAt('/shipments');
    const mobile = mobileSurface();
    await waitFor(() => expect(mobile.getByText('SHP-2607-00001')).toBeTruthy());
    expect(mobile.getByRole('button', { name: /Trang sau/i })).toBeTruthy();
  });

  it('renders the error message when the API call fails', async () => {
    apiGet.mockRejectedValue(new Error('network down'));
    renderAt('/shipments');
    await waitFor(() => expect(screen.getByText(/Không thể tải danh sách lô hàng/)).toBeTruthy());
    expect(desktopSurface().queryByText('Chưa có lô hàng nào')).toBeNull();
  });

  it('passes the status filter through to the API as a query param', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    renderAt('/shipments?status=PENDING_EXPENSE_APPROVAL');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const callArg = apiGet.mock.calls[0][0] as string;
    expect(callArg).toMatch(/status=PENDING_EXPENSE_APPROVAL/);
  });

  it('passes the page number through to the API', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 3, limit: 20 });
    renderAt('/shipments?page=3');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const callArg = apiGet.mock.calls[0][0] as string;
    expect(callArg).toMatch(/page=3/);
  });

  it('falls back safely for invalid status and page URL values', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    renderAt('/shipments?status=UNKNOWN&page=2abc');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const callArg = apiGet.mock.calls[0][0] as string;
    expect(callArg).toMatch(/page=1/);
    expect(callArg).not.toMatch(/status=/);
  });

  it('ignores a stale response after the status filter changes', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const second = new Promise((resolve) => { resolveSecond = resolve; });
    apiGet
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);

    renderAt('/shipments');
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    fireEvent.click(toolbar().getByText('Chờ duyệt phí'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveSecond({
        items: [{
          id: 2, shipmentCode: 'SHP-FRESH', customerId: 1, customerName: 'Khách hàng mới',
          status: ShipmentStatus.PENDING_EXPENSE_APPROVAL, bookingRef: null, blNumber: null,
          expectedDeliveryDate: null, pickupLocation: null, deliveryLocation: null,
          contactName: null, contactPhone: null, version: 1, createdAt: '', updatedAt: '',
        }],
        total: 1, page: 1, limit: 20,
      });
      await second;
    });
    await waitFor(() => expect(desktopSurface().getByText('SHP-FRESH')).toBeTruthy());

    await act(async () => {
      resolveFirst({
        items: [{
          id: 1, shipmentCode: 'SHP-STALE', customerId: 1, customerName: 'Khách hàng cũ',
          status: ShipmentStatus.NEW, bookingRef: null, blNumber: null,
          expectedDeliveryDate: null, pickupLocation: null, deliveryLocation: null,
          contactName: null, contactPhone: null, version: 1, createdAt: '', updatedAt: '',
        }],
        total: 1, page: 1, limit: 20,
      });
      await first;
    });

    expect(desktopSurface().getByText('SHP-FRESH')).toBeTruthy();
    expect(desktopSurface().queryByText('SHP-STALE')).toBeNull();
  });

  it('passes q to the server and renders the returned matches', async () => {
    apiGet.mockResolvedValue({
      items: [
        { id: 2, shipmentCode: 'SHP-BBB', customerId: 1, customerName: 'KH Beta', status: ShipmentStatus.NEW,
          bookingRef: 'BK-2', blNumber: 'BL-XYZ', expectedDeliveryDate: null,
          pickupLocation: null, deliveryLocation: null, contactName: null,
          contactPhone: null, version: 1, createdAt: '', updatedAt: '' },
      ],
      total: 1, page: 1, limit: 20,
    });
    renderAt('/shipments?q=XYZ');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls[0][0]).toMatch(/q=XYZ/);
    const desktop = desktopSurface();
    await waitFor(() => expect(desktop.getByText('SHP-BBB')).toBeTruthy());
  });

  it('resets the page when a status filter is clicked', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    renderAt('/shipments?page=3');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    // Clicking the pending-expense pill should drop page=3 and set the canonical status.
    fireEvent.click(toolbar().getByText('Chờ duyệt phí'));
    await waitFor(() => {
      const lastCall = apiGet.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toMatch(/status=PENDING_EXPENSE_APPROVAL/);
      expect(lastCall).not.toMatch(/page=3/);
    });
  });

  it('shows the required operational columns by default and persists optional visibility', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    renderAt('/shipments');
    const desktop = desktopSurface();
    // W4 20260805_03: 17 columns render by default (Nâng / Hạ / Kết hợp /
    // Note thu khách are tracked separately — see QA_REPORT follow-ups).
    for (const heading of [
      'Lô hàng', 'Khách hàng', 'Nhà máy', 'Số B/L', 'Số Bill/Book', 'Số tờ khai',
      'Hãng tàu', 'Tuyến đường', 'Loại hàng (Xuất/Nhập)', 'Số Cont/Số lượng',
      'Nhà xe', 'Biển số xe', 'Ngày vận chuyển', 'Giờ đóng/trả', 'Ngày đóng/trả',
      'Trạng thái', 'Ghi chú',
    ]) {
      expect(desktop.getByRole('columnheader', { name: heading })).toBeTruthy();
    }

    // The column menu is a <details>/<summary>. The summary's text also
    // appears in the ancestor <details>'s aggregate textContent, so a text
    // query matches twice — toggle the trigger by its class instead.
    const columnsTrigger = document.querySelector('.shipments-page__columns-trigger') as HTMLElement;
    expect(columnsTrigger).toBeTruthy();
    fireEvent.click(columnsTrigger);
    // Toggle a currently-visible column off and verify it disappears.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Số B/L' }));
    expect(desktop.queryByRole('columnheader', { name: 'Số B/L' })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('silversea:shipments:columns:v1') ?? '[]')).not.toContain('blNumber');
  });

  it('marks pending shipments without a delivery date with an explicit warning', async () => {
    apiGet.mockResolvedValue({
      items: [{
        id: 81, shipmentCode: 'SHP-MISSING', customerId: 7, customerName: 'Khách hàng A',
        status: ShipmentStatus.PENDING_DATE, bookingRef: null, blNumber: null,
        expectedDeliveryDate: null, pickupLocation: null, deliveryLocation: null,
        contactName: null, contactPhone: null, version: 1, createdAt: '', updatedAt: '',
      }],
      total: 1, page: 1, limit: 20,
    });
    renderAt('/shipments');
    const desktop = desktopSurface();
    await waitFor(() => expect(desktop.getByText('SHP-MISSING')).toBeTruthy());
    expect(desktop.getByText('Thiếu ngày vận chuyển')).toBeTruthy();
    expect(desktop.getByText('SHP-MISSING').closest('tr')?.classList.contains('is-missing-date')).toBe(true);
  });

  it('lets a clerk select and save the transport date inline with one click', async () => {
    authState.role = 'CLERK';
    const row = {
      id: 91, shipmentCode: 'SHP-EDIT', customerId: 7, customerName: 'Khách hàng B',
      status: ShipmentStatus.PENDING_DATE, bookingRef: null, blNumber: null,
      expectedDeliveryDate: null, pickupLocation: null, deliveryLocation: null,
      contactName: null, contactPhone: null, version: 4, createdAt: '', updatedAt: '',
    };
    apiGet.mockResolvedValue({ items: [row], total: 1, page: 1, limit: 20 });
    apiPut.mockResolvedValue({ ...row, expectedDeliveryDate: '2026-08-18', version: 5, changeMode: 'DIRECT', changeRequestId: null });
    renderAt('/shipments');
    const desktop = desktopSurface();
    const dateButton = await desktop.findByRole('button', { name: /Thiếu ngày vận chuyển/ });
    fireEvent.click(dateButton);
    const input = desktop.getByLabelText('Ngày vận chuyển của SHP-EDIT');
    fireEvent.change(input, { target: { value: '2026-08-18' } });
    fireEvent.click(desktop.getByRole('button', { name: 'Lưu ngày vận chuyển' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/91', {
      expectedVersion: 4,
      expectedDeliveryDate: '2026-08-18',
    }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã cập nhật ngày vận chuyển'));
    expect(screen.getByTestId('current-path').textContent).toBe('/shipments');
  });

  it('keeps date actions on the list for mouse and keyboard interaction', async () => {
    authState.role = 'CLERK';
    apiGet.mockResolvedValue({
      items: [{
        id: 92, shipmentCode: 'SHP-CANCEL', customerId: 7, customerName: 'Khách hàng B',
        status: ShipmentStatus.PENDING_DATE, bookingRef: null, blNumber: null,
        expectedDeliveryDate: '2026-08-04', pickupLocation: null, deliveryLocation: null,
        contactName: null, contactPhone: null, version: 1, createdAt: '', updatedAt: '',
      }],
      total: 1, page: 1, limit: 20,
    });

    renderAt('/shipments');
    const desktop = desktopSurface();
    const desktopDate = await desktop.findByRole('button', { name: '4/8/2026' });

    fireEvent.keyDown(desktopDate, { key: ' ' });
    expect(screen.getByTestId('current-path').textContent).toBe('/shipments');

    fireEvent.keyDown(desktopDate, { key: 'Enter' });
    expect(desktop.getByLabelText('Ngày vận chuyển của SHP-CANCEL')).toBeTruthy();
    fireEvent.click(desktop.getByRole('button', { name: 'Hủy chỉnh sửa ngày vận chuyển' }));
    expect(screen.getByTestId('current-path').textContent).toBe('/shipments');
    expect(desktop.queryByLabelText('Ngày vận chuyển của SHP-CANCEL')).toBeNull();

    const mobile = mobileSurface();
    const mobileAction = mobile.getByRole('button', { name: 'Đổi ngày vận chuyển' });
    fireEvent.keyDown(mobileAction, { key: 'Enter' });
    fireEvent.click(mobileAction);
    expect(mobile.getByLabelText('Ngày vận chuyển')).toBeTruthy();
    expect(screen.getByTestId('current-path').textContent).toBe('/shipments');
  });

  it('retains the inline editor and entered date when the update fails', async () => {
    authState.role = 'CLERK';
    apiGet.mockResolvedValue({
      items: [{
        id: 93, shipmentCode: 'SHP-CONFLICT', customerId: 7, customerName: 'Khách hàng C',
        status: ShipmentStatus.PENDING_DATE, bookingRef: null, blNumber: null,
        expectedDeliveryDate: null, pickupLocation: null, deliveryLocation: null,
        contactName: null, contactPhone: null, version: 4, createdAt: '', updatedAt: '',
      }],
      total: 1, page: 1, limit: 20,
    });
    apiPut.mockRejectedValue(new Error('Dữ liệu đã thay đổi, vui lòng tải lại'));

    renderAt('/shipments');
    const desktop = desktopSurface();
    fireEvent.click(await desktop.findByRole('button', { name: /Thiếu ngày vận chuyển/ }));
    const input = desktop.getByLabelText('Ngày vận chuyển của SHP-CONFLICT') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-08-18' } });
    fireEvent.click(desktop.getByRole('button', { name: 'Lưu ngày vận chuyển' }));

    await waitFor(() => expect(desktop.getByRole('alert').textContent).toContain('Dữ liệu đã thay đổi'));
    expect(input.value).toBe('2026-08-18');
    expect(screen.getByTestId('current-path').textContent).toBe('/shipments');
  });

  it('announces a requested change without implying a direct update', async () => {
    authState.role = 'CLERK';
    const row = {
      id: 94, shipmentCode: 'SHP-REQUESTED', customerId: 7, customerName: 'Khách hàng D',
      status: ShipmentStatus.DISPATCHED, bookingRef: null, blNumber: null,
      expectedDeliveryDate: '2026-08-04', pickupLocation: null, deliveryLocation: null,
      contactName: null, contactPhone: null, version: 2, createdAt: '', updatedAt: '',
    };
    apiGet.mockResolvedValue({ items: [row], total: 1, page: 1, limit: 20 });
    apiPut.mockResolvedValue({ ...row, changeMode: 'REQUESTED', changeRequestId: 15 });

    renderAt('/shipments');
    const desktop = desktopSurface();
    fireEvent.click(await desktop.findByRole('button', { name: '4/8/2026' }));
    const input = desktop.getByLabelText('Ngày vận chuyển của SHP-REQUESTED');
    fireEvent.change(input, { target: { value: '2026-08-19' } });
    fireEvent.click(desktop.getByRole('button', { name: 'Lưu ngày vận chuyển' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã gửi yêu cầu đổi ngày vận chuyển'));
  });

  it('falls back to default columns when browser storage is unavailable', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => { throw new Error('storage disabled'); },
        setItem: () => { throw new Error('storage disabled'); },
        removeItem: () => undefined,
        clear: () => undefined,
      },
    });
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });

    renderAt('/shipments');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(desktopSurface().getByRole('columnheader', { name: 'Nhà xe' })).toBeTruthy();
    // W4 20260805_03: Số B/L is now default-visible.
    expect(desktopSurface().getByRole('columnheader', { name: 'Số B/L' })).toBeTruthy();
  });

  it('keeps the inline date control read-only for accountants', async () => {
    apiGet.mockResolvedValue({
      items: [{
        id: 101, shipmentCode: 'SHP-READONLY', customerId: 7, customerName: 'Khách hàng C',
        status: ShipmentStatus.PENDING_DATE, bookingRef: null, blNumber: null,
        expectedDeliveryDate: null, pickupLocation: null, deliveryLocation: null,
        contactName: null, contactPhone: null, version: 1, createdAt: '', updatedAt: '',
      }],
      total: 1, page: 1, limit: 20,
    });
    renderAt('/shipments');
    await waitFor(() => expect(desktopSurface().getByText('SHP-READONLY')).toBeTruthy());
    expect(desktopSurface().queryByTitle('Chọn hoặc cập nhật ngày vận chuyển')).toBeNull();
  });
});
