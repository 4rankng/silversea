import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';

// vi.hoisted runs before vi.mock's factory is invoked, so the mock fn is
// accessible inside the factory. (Vitest hoists vi.mock above all top-level
// declarations — referencing a plain const from the factory throws
// ReferenceError.)
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

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

describe('ShipmentsPage — minimal Wave 0 list surface', () => {
  beforeEach(() => {
    apiGet.mockReset();
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
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
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
  });

  it('renders the error message when the API call fails', async () => {
    apiGet.mockRejectedValue(new Error('network down'));
    renderAt('/shipments');
    await waitFor(() => expect(screen.getByText(/Không thể tải danh sách lô hàng/)).toBeTruthy());
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

  it('client-side-filters rows by the q= search term across code/BL/booking', async () => {
    apiGet.mockResolvedValue({
      items: [
        { id: 1, shipmentCode: 'SHP-AAA', customerId: 1, customerName: 'KH Alpha', status: ShipmentStatus.DRAFT,
          bookingRef: 'BK-1', blNumber: 'BL-1', expectedDeliveryDate: null,
          pickupLocation: null, deliveryLocation: null, contactName: null,
          contactPhone: null, version: 1, createdAt: '', updatedAt: '' },
        { id: 2, shipmentCode: 'SHP-BBB', customerId: 1, customerName: 'KH Beta', status: ShipmentStatus.DRAFT,
          bookingRef: 'BK-2', blNumber: 'BL-XYZ', expectedDeliveryDate: null,
          pickupLocation: null, deliveryLocation: null, contactName: null,
          contactPhone: null, version: 1, createdAt: '', updatedAt: '' },
      ],
      total: 2, page: 1, limit: 20,
    });
    renderAt('/shipments?q=XYZ');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    // Only the row whose BL matches "XYZ" should render — on both surfaces.
    const desktop = desktopSurface();
    await waitFor(() => expect(desktop.getByText('SHP-BBB')).toBeTruthy());
    expect(desktop.queryByText('SHP-AAA')).toBeNull();
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
