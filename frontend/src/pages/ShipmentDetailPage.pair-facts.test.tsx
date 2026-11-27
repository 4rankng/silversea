/**
 * SIL-1020 (KB Ch.3 §3.5 K3.40) — the chi tiết lô review page renders the
 * lot's PHÂN LOẠI + tên lô ghép cùng, the same one relation every other
 * screen reads. A lot riding an ACTIVE pair shows the pair label ('Kẹp') and
 * the partner member's lot name; a single lot shows 'Đơn' with no partner row
 * (absence is not data).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('../features/shipments/detail/ShipmentExternalPlateSection', () => ({
  ShipmentExternalPlateSection: () => null,
}));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  getShipmentDetail,
  listOperationalSites,
  listSharedWarehouseSites,
}));

import { ToastProvider } from '../components/shared/Toast';
import ShipmentDetailPage from './ShipmentDetailPage';

/** The persisted lot the review must render — the SIL-593 harness shape plus
 *  SIL-1020's per-leg pair facts on the container row. */
function lotDetail(leg: {
  classification?: ShipmentClientModule.ShipmentContainer['classification'];
  pairKind?: ShipmentClientModule.ShipmentContainer['pairKind'];
  pairPartnerName?: ShipmentClientModule.ShipmentContainer['pairPartnerName'];
}): ShipmentClientModule.ShipmentDetail {
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
      blNumber: 'R3P-KR1',
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
      notes: null,
      ...leg,
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

describe('ShipmentDetailPage — SIL-1020 PHÂN LOẠI + tên lô ghép cùng (K3.40)', { timeout: 20000 }, () => {
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
  });

  it('lô thuộc cặp (pair tồn tại) → PHÂN LOẠI "Kẹp" + tên lô ghép cùng', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail({
      classification: 'DOUBLE',
      pairKind: 'KEP',
      pairPartnerName: 'R3P-KR2',
    }));
    renderAt('/shipments/802');

    expect(await screen.findByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    const block = await screen.findByRole('region', { name: 'Phân loại ghép' });
    await waitFor(() => {
      expect(within(block).getByText('PHÂN LOẠI')).toBeTruthy();
    });
    expect(within(block).getByText('Kẹp')).toBeTruthy();
    expect(within(block).getByText('Ghép cùng')).toBeTruthy();
    expect(within(block).getByText('R3P-KR2')).toBeTruthy();
  });

  it('lô đơn → PHÂN LOẠI "Đơn", không có tên lô ghép', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail({ classification: 'SINGLE' }));
    renderAt('/shipments/717');

    expect(await screen.findByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    const block = await screen.findByRole('region', { name: 'Phân loại ghép' });
    await waitFor(() => {
      expect(within(block).getByText('PHÂN LOẠI')).toBeTruthy();
    });
    expect(within(block).getByText('Đơn')).toBeTruthy();
    expect(within(block).queryByText('Ghép cùng')).toBeNull();
    expect(within(block).queryByText(/R3P-KR2/)).toBeNull();
  });
});
