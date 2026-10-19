import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../../lib/api';

const { apiMock, eventsMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn() },
  eventsMock: { listPortalShipmentEvents: vi.fn(), acknowledgePortalEvent: vi.fn() },
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
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

function fieldValue(label: string): string | null {
  const dt = screen.getByText(label);
  return dt.nextElementSibling?.textContent ?? null;
}

const emptyCollections = { documents: [], declarations: [], statusHistory: [] };

/**
 * FB-107 (card 171026115820) — the portal "Chi tiết lô hàng" names the lot's
 * two REAL operating points under Nâng / Hạ instead of the vague
 * 'Nơi nhận'/'Nơi giao' pair over the dormant pickup_location/delivery_location
 * columns (empty on every form-created lot). The direction swap itself is
 * pinned in `liftDropPoints.test.ts`; these cases pin the BINDING: the labels
 * and which payload fields feed the shared `resolveLiftDropPoints` rule.
 */
describe('PortalShipmentDetailPage Nâng / Hạ (FB-107)', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    eventsMock.listPortalShipmentEvents.mockReset();
    eventsMock.listPortalShipmentEvents.mockResolvedValue({ items: [] });
  });

  it("labels the two rows Nâng / Hạ — the card dropped 'Nơi nhận'/'Nơi giao'", async () => {
    apiMock.get.mockResolvedValue({
      shipment: {
        id: 77, status: 'IN_TRANSIT', bookingRef: 'BK-88', blNumber: 'BL-99',
        pickupLocation: null, deliveryLocation: null,
        cargoMode: 'LCL', tradeDirection: 'IMPORT',
        pickupWarehouseSiteName: null, effectiveFactoryName: null, factoryName: null,
      },
      containers: [],
      ...emptyCollections,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'BL-99' });
    expect(screen.getByText('Nâng').tagName).toBe('DT');
    expect(screen.getByText('Hạ').tagName).toBe('DT');
    expect(screen.queryByText('Nơi nhận')).toBeNull();
    expect(screen.queryByText('Nơi giao')).toBeNull();
  });

  it('LCL Xuất: the shared rule swaps the sides — Nâng = Nhà máy, Hạ = Kho', async () => {
    apiMock.get.mockResolvedValue({
      shipment: {
        id: 77, status: 'IN_TRANSIT', bookingRef: 'BK-88', blNumber: 'BL-99',
        pickupLocation: null, deliveryLocation: null,
        cargoMode: 'LCL', tradeDirection: 'EXPORT',
        pickupWarehouseSiteName: 'Kho ICD Hà Nội', effectiveFactoryName: 'Nhà máy Long Minh', factoryName: null,
      },
      containers: [],
      ...emptyCollections,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'BL-99' });
    expect(fieldValue('Nâng')).toBe('Nhà máy Long Minh');
    expect(fieldValue('Hạ')).toBe('Kho ICD Hà Nội');
  });

  it('FCL: names the container Cảng nâng / Cảng hạ', async () => {
    apiMock.get.mockResolvedValue({
      shipment: {
        id: 77, status: 'IN_TRANSIT', bookingRef: null, blNumber: 'BL-99',
        pickupLocation: null, deliveryLocation: null,
        cargoMode: 'FCL', tradeDirection: 'IMPORT',
        pickupWarehouseSiteName: null, effectiveFactoryName: null, factoryName: null,
      },
      containers: [
        {
          id: 1, containerNumber: 'MSKU1234567', sealNumber: null,
          cargoWeightKg: null, customerAppointmentAt: null,
          pickupPortName: 'Cảng nâng A', dropoffPortName: 'Cảng hạ B',
        },
      ],
      ...emptyCollections,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'BL-99' });
    expect(fieldValue('Nâng')).toBe('Cảng nâng A');
    expect(fieldValue('Hạ')).toBe('Cảng hạ B');
  });

  it('falls back to the stored free text when no catalog point was picked', async () => {
    apiMock.get.mockResolvedValue({
      shipment: {
        id: 77, status: 'IN_TRANSIT', bookingRef: 'BK-88', blNumber: 'BL-99',
        pickupLocation: 'Bãi tự nhập', deliveryLocation: 'Nhà máy không catalog',
        cargoMode: 'LCL', tradeDirection: 'IMPORT',
        pickupWarehouseSiteName: null, effectiveFactoryName: null, factoryName: null,
      },
      containers: [],
      ...emptyCollections,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'BL-99' });
    expect(fieldValue('Nâng')).toBe('Bãi tự nhập');
    expect(fieldValue('Hạ')).toBe('Nhà máy không catalog');
  });
});
