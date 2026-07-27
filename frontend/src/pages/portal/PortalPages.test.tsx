import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';

const { apiGet, apiPost, apiGetBlob, apiGetForText } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiGetBlob: vi.fn(),
  apiGetForText: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: { get: apiGet, post: apiPost, getBlob: apiGetBlob, getForText: apiGetForText },
}));

import PortalShipmentsPage from './PortalShipmentsPage';
import PortalShipmentDetailPage from './PortalShipmentDetailPage';
import PortalDebitNotesPage from './PortalDebitNotesPage';
import PortalStatementPage from './PortalStatementPage';

describe('customer portal pages', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGetBlob.mockReset();
    apiGetForText.mockReset();
  });

  it('PortalShipmentsPage calls the row-scoped portal shipments endpoint', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          id: 42,
          shipmentCode: 'SHP-2607-00042',
          status: ShipmentStatus.IN_PROGRESS,
          bookingRef: 'BK-42',
          blNumber: 'BL-42',
          expectedDeliveryDate: '2026-07-31',
        },
      ],
      total: 1,
    });

    render(
      <MemoryRouter>
        <PortalShipmentsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/portal/shipments?page=1&limit=10'));
    expect(screen.getByText('SHP-2607-00042')).toBeTruthy();
  });

  it('PortalShipmentDetailPage calls the row-scoped portal shipment detail endpoint', async () => {
    apiGet.mockResolvedValue({
      shipment: {
        id: 42,
        shipmentCode: 'SHP-2607-00042',
        status: ShipmentStatus.DELIVERED,
        bookingRef: 'BK-42',
        blNumber: 'BL-42',
        expectedDeliveryDate: '2026-07-31',
        pickupLocation: 'Hải Phòng',
        deliveryLocation: 'Hà Nội',
      },
      containers: [],
      documents: [],
      declarations: [],
      statusHistory: [],
    });

    render(
      <MemoryRouter initialEntries={['/portal/shipments/42']}>
        <Routes>
          <Route path="/portal/shipments/:id" element={<PortalShipmentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/portal/shipments/42'));
    expect(screen.getByText('SHP-2607-00042')).toBeTruthy();
  });

  it('PortalDebitNotesPage calls the row-scoped portal debit-note endpoint', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          id: 9,
          entityName: 'Công ty CP Vận tải Biển Bạc',
          rangeFrom: '2026-07-01',
          rangeTo: '2026-07-31',
          totalInclVat: '1500000',
          debitNoteStatus: 'SENT',
        },
      ],
    });

    render(
      <MemoryRouter>
        <PortalDebitNotesPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/portal/debit-notes?page=1&limit=20'));
    expect(screen.getByText(/Kỳ 1\/7\/2026/)).toBeTruthy();
  });

  it('confirms only through the row-scoped portal action', async () => {
    apiGet.mockResolvedValue({
      items: [{
        id: 9,
        entityName: 'Khách hàng A',
        rangeFrom: '2026-07-01',
        rangeTo: '2026-07-31',
        totalInclVat: 1500000,
        debitNoteStatus: 'PENDING_CONFIRM',
      }],
    });
    apiPost.mockResolvedValue({
      id: 9,
      rangeFrom: '2026-07-01',
      rangeTo: '2026-07-31',
      totalInclVat: 1500000,
      debitNoteStatus: 'CONFIRMED',
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<MemoryRouter><PortalDebitNotesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Xác nhận/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/portal/debit-notes/9/confirm', {}));
    expect(await screen.findByText('Đã xác nhận')).toBeTruthy();
  });

  it('loads the customer statement without accepting a customer id from the browser', async () => {
    apiGet.mockResolvedValue({
      customer: { id: 3, name: 'Khách hàng A', contactInfo: null },
      ledgerRows: [],
      agingBuckets: [],
      totalOutstanding: 1250000,
      unpaidTrips: [],
    });

    render(<MemoryRouter><PortalStatementPage /></MemoryRouter>);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/portal/statement'));
    expect(screen.getAllByText('1.250.000 ₫')).toHaveLength(2);
  });

  it('downloads statement PDF bytes and shows a visible export error on failure', async () => {
    apiGet.mockResolvedValue({
      customer: { id: 3, name: 'Khách hàng A', contactInfo: null },
      ledgerRows: [],
      agingBuckets: [],
      totalOutstanding: 0,
      unpaidTrips: [],
    });
    apiGetBlob.mockRejectedValue(new Error('network'));

    render(<MemoryRouter><PortalStatementPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(apiGetBlob).toHaveBeenCalledWith('/portal/statement/export?format=pdf'));
    expect(await screen.findByText('Không thể xuất sao kê. Vui lòng thử lại.')).toBeTruthy();
  });
});
