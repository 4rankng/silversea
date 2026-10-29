import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ShipmentClientModule from '../api/shipmentClient';

const { getBootstrap, getShipmentDetail, listOperationalSites, listSharedWarehouseSites, checkShipmentReferenceDuplicate, userRole } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  getShipmentDetail: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
  checkShipmentReferenceDuplicate: vi.fn(),
  userRole: { current: 'DISPATCHER' as string | undefined },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: userRole.current == null ? null : { role: userRole.current } }),
}));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../features/shipments/create/FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../api/shipmentDuplicateClient', () => ({ checkShipmentReferenceDuplicate }));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  getShipmentDetail,
  listOperationalSites,
  listSharedWarehouseSites,
}));

import { ApiError } from '../lib/api';
import { ToastProvider } from '../components/shared/Toast';
import ShipmentDetailPage from './ShipmentDetailPage';

/** The persisted lot the review must render — only the fields the workspace
 *  and the SIL-171 prefill mapping read. */
function lotDetail(): ShipmentClientModule.ShipmentDetail {
  const detail = {
    accountingLock: null,
    shipment: {
      id: 382,
      version: 3,
      customerId: 1,
      isAdHoc: false,
      rawCustomerName: null,
      rawRouteName: null,
      factoryName: null,
      routeId: null,
      cargoTypeId: null,
      bookingRef: '',
      blNumber: 'BL-593-382',
      shippingLineName: 'MAERSK',
      declarationNumber: null,
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      isCombined: false,
      operationalSiteId: null,
      pickupWarehouseSiteId: null,
      pickupLocation: null,
      deliveryLocation: null,
      customsCutoffAt: '2026-10-20T09:00:00.000Z',
      closingAt: null,
      plannedReturnAt: null,
      expectedDeliveryDate: null,
      cargoWeightKg: null,
      cargoVolumeCbm: null,
      packageCount: null,
      packageType: null,
      operationalNotes: '',
    },
    declarations: [],
    containers: [{
      id: 31,
      containerNumber: 'CSQU3054383',
      containerTypeId: null,
      routeId: null,
      rawRouteName: null,
      pickupPortId: null,
      dropoffPortId: null,
      rawPickupPortName: null,
      rawDropoffPortName: null,
      cargoWeightKg: null,
      cargoVolumeCbm: null,
      customerAppointmentAt: null,
      operationalSiteId: null,
      rawFactoryName: null,
      declarationNumber: null,
    }],
    documents: [],
    statusHistory: [],
  };
  return detail as unknown as ShipmentClientModule.ShipmentDetail;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            <Route path="/shipments" element={<div data-testid="shipment-list" />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ShipmentDetailPage — SIL-593 regression (detail loads for dispatch + admin)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getShipmentDetail.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    checkShipmentReferenceDuplicate.mockReset();
    userRole.current = 'DISPATCHER';
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
    getShipmentDetail.mockResolvedValue(lotDetail());
  });

  it('SIL-593-C1: DISPATCHER opens /shipments/:id and the lot renders (Chi tiết lô hàng + Số Bill)', async () => {
    renderAt('/shipments/382');

    expect(await screen.findByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    const bill = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(bill.value).toBe('BL-593-382');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('SIL-593-C2: ADMIN opens /shipments/:id and the lot renders the same way', async () => {
    userRole.current = 'ADMIN';
    renderAt('/shipments/631');

    expect(await screen.findByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
      expect(el?.value).toBe('BL-593-382');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('SIL-593-C3: a 404 says "Không tìm thấy lô hàng." — never the retry wording', async () => {
    getShipmentDetail.mockRejectedValue(new ApiError(404, { error: 'Không tìm thấy lô hàng' }, 'Không tìm thấy lô hàng'));
    renderAt('/shipments/382');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Không tìm thấy lô hàng.');
    expect(alert.textContent).not.toContain('Vui lòng thử lại');
  });

  it('SIL-593-C4: a transient failure keeps the retry wording', async () => {
    getShipmentDetail.mockRejectedValue(new Error('network down'));
    renderAt('/shipments/382');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Không thể tải thông tin lô hàng. Vui lòng thử lại.');
  });
});
