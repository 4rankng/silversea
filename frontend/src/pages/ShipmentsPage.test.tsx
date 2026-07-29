import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';

const shipmentsPageCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
// vi.hoisted runs before vi.mock's factory is invoked, so the mock fn is
// accessible inside the factory. (Vitest hoists vi.mock above all top-level
// declarations — referencing a plain const from the factory throws
// ReferenceError.)
const { apiGet, authState } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  authState: { role: 'ACCOUNTANT' },
}));

vi.mock('../lib/api', () => ({
  api: { get: apiGet },
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
    </MemoryRouter>,
  );
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

// The toolbar is the third shared surface. KPI labels ("Bản nháp",
// "Đang xử lý", "Đã giao") collide with filter-pill text, so filter-pill
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
    authState.role = 'ACCOUNTANT';
  });

  it('renders the page header and toolbar', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    renderAt('/shipments');
    expect(pageTitleH1()?.textContent).toBe('Lô hàng');
    // Filter pills render the catalogue. Scope to the toolbar — KPI labels
    // ("Bản nháp", "Đang xử lý", "Đã giao") would otherwise collide.
    const tb = toolbar();
    expect(tb.getByText(/Tất cả/)).toBeTruthy();
    expect(tb.getByText('Bản nháp')).toBeTruthy();
    expect(tb.getByText('Đang xử lý')).toBeTruthy();
    expect(tb.getByRole('button', { name: /Tất cả/ }).getAttribute('aria-pressed')).toBe('true');
    expect(tb.getByRole('button', { name: 'Bản nháp' }).getAttribute('aria-pressed')).toBe('false');
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
          status: ShipmentStatus.DRAFT, bookingRef: 'BK-1', blNumber: 'BL-1',
          expectedDeliveryDate: '2026-08-01', pickupLocation: null,
          deliveryLocation: null, contactName: null, contactPhone: null,
          version: 1, createdAt: '2026-07-25T00:00:00Z', updatedAt: '2026-07-25T00:00:00Z',
        },
        {
          id: 2, shipmentCode: 'SHP-2607-00002', customerId: 9, customerName: 'Công ty TNHH XYZ Logistik',
          status: ShipmentStatus.IN_PROGRESS, bookingRef: null, blNumber: 'BL-2',
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
    expect(desktop.getAllByText('Bản nháp').length).toBeGreaterThanOrEqual(1);
    expect(desktop.getAllByText('Đang xử lý').length).toBeGreaterThanOrEqual(1);
    expect(desktop.getByText((_, element) => Boolean(
      element?.classList.contains('shipments-page__td--date')
      && element.textContent?.includes('1/8/2026'),
    ))).toBeTruthy();
  });

  it('keeps pagination available on the mobile list', async () => {
    apiGet.mockResolvedValue({
      items: [{
        id: 1, shipmentCode: 'SHP-2607-00001', customerId: 7, customerName: 'Công ty CP Vận tải ABC',
        status: ShipmentStatus.DRAFT, bookingRef: 'BK-1', blNumber: 'BL-1',
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
    renderAt('/shipments?status=DELIVERED');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const callArg = apiGet.mock.calls[0][0] as string;
    expect(callArg).toMatch(/status=DELIVERED/);
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
    fireEvent.click(toolbar().getByText('Đã giao'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveSecond({
        items: [{
          id: 2, shipmentCode: 'SHP-FRESH', customerId: 1, customerName: 'Khách hàng mới',
          status: ShipmentStatus.DELIVERED, bookingRef: null, blNumber: null,
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
          status: ShipmentStatus.DRAFT, bookingRef: null, blNumber: null,
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
        { id: 2, shipmentCode: 'SHP-BBB', customerId: 1, customerName: 'KH Beta', status: ShipmentStatus.DRAFT,
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
    // Clicking the "Đã giao" pill should drop page=3 and set status=DELIVERED.
    fireEvent.click(toolbar().getByText('Đã giao'));
    await waitFor(() => {
      const lastCall = apiGet.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toMatch(/status=DELIVERED/);
      expect(lastCall).not.toMatch(/page=3/);
    });
  });
});
