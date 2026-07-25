import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

describe('ShipmentsPage — minimal Wave 0 list surface', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('renders the page header and toolbar', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    renderAt('/shipments');
    expect(pageTitleH1()?.textContent).toBe('Lô hàng');
    // Filter pills render the catalogue.
    expect(screen.getByText('Tất cả')).toBeTruthy();
    expect(screen.getByText('Bản nháp')).toBeTruthy();
    expect(screen.getByText('Đang xử lý')).toBeTruthy();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
  });

  it('renders the empty state when the API returns no shipments', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    renderAt('/shipments');
    await waitFor(() => expect(screen.getByText(/Chưa có lô hàng nào/)).toBeTruthy());
    expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/shipments\?/));
  });

  it('renders the list rows when the API returns shipments', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          id: 1, shipmentCode: 'SHP-2607-00001', customerId: 7,
          status: ShipmentStatus.DRAFT, bookingRef: 'BK-1', blNumber: 'BL-1',
          expectedDeliveryDate: '2026-08-01', pickupLocation: null,
          deliveryLocation: null, contactName: null, contactPhone: null,
          version: 1, createdAt: '2026-07-25T00:00:00Z', updatedAt: '2026-07-25T00:00:00Z',
        },
        {
          id: 2, shipmentCode: 'SHP-2607-00002', customerId: 9,
          status: ShipmentStatus.IN_PROGRESS, bookingRef: null, blNumber: 'BL-2',
          expectedDeliveryDate: null, pickupLocation: null, deliveryLocation: null,
          contactName: null, contactPhone: null,
          version: 3, createdAt: '2026-07-25T00:00:00Z', updatedAt: '2026-07-25T00:00:00Z',
        },
      ],
      total: 2, page: 1, limit: 20,
    });
    renderAt('/shipments');
    await waitFor(() => expect(screen.getByText('SHP-2607-00001')).toBeTruthy());
    expect(screen.getByText('SHP-2607-00002')).toBeTruthy();
    // Status labels render in the row pills. (Bản nháp / Đang xử lý also
    // appear as filter pills — use getAllByText to tolerate the duplicates.)
    expect(screen.getAllByText('Bản nháp').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Đang xử lý').length).toBeGreaterThanOrEqual(1);
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
        { id: 1, shipmentCode: 'SHP-AAA', customerId: 1, status: ShipmentStatus.DRAFT,
          bookingRef: 'BK-1', blNumber: 'BL-1', expectedDeliveryDate: null,
          pickupLocation: null, deliveryLocation: null, contactName: null,
          contactPhone: null, version: 1, createdAt: '', updatedAt: '' },
        { id: 2, shipmentCode: 'SHP-BBB', customerId: 1, status: ShipmentStatus.DRAFT,
          bookingRef: 'BK-2', blNumber: 'BL-XYZ', expectedDeliveryDate: null,
          pickupLocation: null, deliveryLocation: null, contactName: null,
          contactPhone: null, version: 1, createdAt: '', updatedAt: '' },
      ],
      total: 2, page: 1, limit: 20,
    });
    renderAt('/shipments?q=XYZ');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    // Only the row whose BL matches "XYZ" should render.
    await waitFor(() => expect(screen.getByText('SHP-BBB')).toBeTruthy());
    expect(screen.queryByText('SHP-AAA')).toBeNull();
  });

  it('resets the page when a status filter is clicked', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    renderAt('/shipments?page=3');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    // Clicking the "Đã giao" pill should drop page=3 and set status=DELIVERED.
    fireEvent.click(screen.getByText('Đã giao'));
    await waitFor(() => {
      const lastCall = apiGet.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toMatch(/status=DELIVERED/);
      expect(lastCall).not.toMatch(/page=3/);
    });
  });
});
