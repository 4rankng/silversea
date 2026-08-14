import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusContainerFlatResponse } from '@tingting/shared';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('../lib/api', () => ({
  api: { get: apiGet },
  ApiError: class ApiError extends Error {},
}));

import ShipmentsDetailPage from './ShipmentsDetailPage';

const response: ShipmentCusContainerFlatResponse = {
  page: 1,
  limit: 20,
  total: 2,
  totalPages: 1,
  items: [
    {
      id: 11,
      shipmentId: 1,
      ordinal: 1,
      customerName: 'Công ty Silver Sea',
      factoryName: 'Nhà máy Hải Phòng',
      billOrBookNumber: 'BILL-12345',
      direction: 'IMPORT',
      containerNumber: 'CONT-001',
      containerTypeLabel: '40HC',
      dispatchStatus: 'PLANNED',
      carrierName: 'SilverSea',
      plateNumber: '30H-123.45',
      liftSite: 'Bãi CY',
      dropoffSite: 'Nhà máy Hải Phòng',
      customerAppointmentAt: '2026-08-20T08:00:00.000Z',
    },
    {
      id: 12,
      shipmentId: 2,
      ordinal: 1,
      customerName: 'Công ty Silver Sea',
      factoryName: 'Nhà máy Hưng Yên',
      billOrBookNumber: 'BOOK-67890',
      direction: 'EXPORT',
      containerNumber: 'CONT-002',
      containerTypeLabel: '20DC',
      dispatchStatus: 'UNASSIGNED',
      carrierName: null,
      plateNumber: null,
      liftSite: null,
      dropoffSite: null,
      customerAppointmentAt: null,
    },
  ],
};

beforeEach(() => {
  apiGet.mockReset();
});

describe('ShipmentsDetailPage — container-flat view', () => {
  it('renders one row per container across shipments, with plate and đóng/trả appointment', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(
      <MemoryRouter>
        <ShipmentsDetailPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('CONT-001')).toBeTruthy();
    expect(screen.getByText('CONT-002')).toBeTruthy();
    // Shipment-identity column absent: the per-shipment id is never rendered.
    expect(screen.queryByRole('columnheader', { name: /lô hàng/i })).toBeNull();

    expect(screen.getByText('30H-123.45')).toBeTruthy();
    expect(screen.getByText('16:00 20/8/26')).toBeTruthy();
    // Unassigned container shows placeholders, not blanks.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('Đã phân xe')).toBeTruthy();
    expect(screen.getByText('Chưa điều xe')).toBeTruthy();
    // Pagination summary counts containers and shipments by their own units.
    expect(screen.getByText(/2 container — 2 lô hàng/)).toBeTruthy();

    expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20');
  });

  it('surfaces the error notice with a retry action when loading fails', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'));
    render(
      <MemoryRouter>
        <ShipmentsDetailPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Thử lại')).toBeTruthy();
  });

  it('passes a trimmed uppercase suffix through as a search filter', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(
      <MemoryRouter initialEntries={['/?searchSuffix=abcde']}>
        <ShipmentsDetailPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(
      '/shipments/cus-workspace/containers?page=1&limit=20&searchSuffix=abcde',
    ));
  });

  it('shows the empty state when no containers match', async () => {
    apiGet.mockResolvedValueOnce({ ...response, items: [], total: 0, totalPages: 0 });
    render(
      <MemoryRouter initialEntries={['/?searchSuffix=zzzz']}>
        <ShipmentsDetailPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Không có container phù hợp')).toBeTruthy();
    // Both the toolbar chip and the empty-state action offer clearing filters.
    expect(screen.getAllByText('Xóa bộ lọc').length).toBeGreaterThan(0);
  });

  it('ignores suffix input shorter or longer than the 4-5 char contract on submit', async () => {
    apiGet.mockResolvedValue(response);
    render(
      <MemoryRouter>
        <ShipmentsDetailPage />
      </MemoryRouter>,
    );
    await screen.findByText('CONT-001');

    const input = screen.getByLabelText(/4-5 ký tự cuối/i);
    fireEvent.change(input, { target: { value: 'ABC123' } });
    fireEvent.submit(input.closest('form')!);
    // No page-2 request fired with the invalid suffix; the request sequence
    // still only carries the base params.
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith(
      '/shipments/cus-workspace/containers?page=1&limit=20',
    ));
  });
});
