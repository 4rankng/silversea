import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock, eventsMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn() },
  eventsMock: { listPortalShipmentEvents: vi.fn(), acknowledgePortalEvent: vi.fn() },
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/api')>();
  return { ...original, api: apiMock };
});

vi.mock('../../api/customerServiceFinanceClient', () => ({
  customerServiceFinanceClient: eventsMock,
}));

vi.mock('./CustomerPortalScope', () => ({
  useCustomerPortalScope: () => ({ selectedCustomerId: null, ready: true }),
  withCustomerScope: (path: string) => path,
}));

import PortalShipmentDetailPage from './PortalShipmentDetailPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/portal/shipments/77']}>
      <Routes>
        <Route path="/portal/shipments/:id" element={<PortalShipmentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The portal containers table uses plain <td>s (no data-label contract), so
 * columns are read positionally: 0=Số container, 1=Seal, 3=Trọng lượng. */
function columnIndex(index: number): string[] {
  return screen.getAllByRole('row').slice(1).map((row) =>
    (row.querySelectorAll('td')[index]?.textContent ?? '').trim());
}

describe('PortalShipmentDetailPage containers sort headers', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    eventsMock.listPortalShipmentEvents.mockReset();
    eventsMock.listPortalShipmentEvents.mockResolvedValue({ items: [] });
    apiMock.get.mockResolvedValue({
      shipment: {
        id: 77, status: 'IN_TRANSIT', bookingRef: 'BK-88', blNumber: 'BL-99',
        pickupLocation: 'Cát Lái', deliveryLocation: 'Bình Dương',
      },
      containers: [
        { id: 3, containerNumber: 'TCLU-300', sealNumber: 'SL-3', cargoWeightKg: '3000', customerAppointmentAt: '2026-08-23T03:00:00.000Z' },
        { id: 1, containerNumber: 'ABCU-100', sealNumber: null, cargoWeightKg: '1000', customerAppointmentAt: '2026-08-21T03:00:00.000Z' },
        { id: 2, containerNumber: 'MSKU-200', sealNumber: 'SL-2', cargoWeightKg: null, customerAppointmentAt: '2026-08-22T03:00:00.000Z' },
      ],
      documents: [],
      declarations: [],
      statusHistory: [],
    });
  });

  it('keeps the server order first, then sorts container number asc → desc', async () => {
    renderPage();
    expect(await screen.findAllByText('TCLU-300')).toBeTruthy();
    expect(columnIndex(0)).toEqual(['TCLU-300', 'ABCU-100', 'MSKU-200']);

    fireEvent.click(screen.getByRole('button', { name: 'Số container' }));
    expect(columnIndex(0)).toEqual(['ABCU-100', 'MSKU-200', 'TCLU-300']);

    fireEvent.click(screen.getByRole('button', { name: 'Số container' }));
    expect(columnIndex(0)).toEqual(['TCLU-300', 'MSKU-200', 'ABCU-100']);
  });

  it('sorts seal and weight numerically where applicable, empties last', async () => {
    renderPage();
    expect(await screen.findAllByText('TCLU-300')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Seal' }));
    expect(columnIndex(1)).toEqual(['SL-2', 'SL-3', '—']);

    fireEvent.click(screen.getByRole('button', { name: 'Trọng lượng (kg)' }));
    expect(columnIndex(3)).toEqual(['1000', '3000', '—']);
  });
});
