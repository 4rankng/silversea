// SIL-789 (id 915, QA fail 26/11 build 99c711f2): on the lot review page
// (/shipments/:id) a locked lot disabled the per-container SỐ TỜ KHAI cell and
// the Sửa button WITHOUT naming the lock anywhere visible — the page read as
// broken. KB Ch3 §3.4.3: the cell carries the reason line
// "Lô hàng đã khóa kế toán; không thể sửa tờ khai."; the action cluster names
// the lot freeze too. Unlocked lots render neither.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, getShipmentDetail, listOperationalSites, listSharedWarehouseSites, checkShipmentReferenceDuplicate } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  getShipmentDetail: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
  checkShipmentReferenceDuplicate: vi.fn(),
}));

vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentDuplicateClient', () => ({ checkShipmentReferenceDuplicate }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal(),
  getShipmentDetail,
  listOperationalSites,
  listSharedWarehouseSites,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

const DECL_REASON = 'Lô hàng đã khóa kế toán; không thể sửa tờ khai.';
// SIL-1164 (KB Ch.10 §10.2.1) — the visible footer caption is the KB sentence
// verbatim: semicolon, no "thông tin lô" tail.
const LOT_REASON = 'Lô hàng đã khóa kế toán; không thể sửa.';

function lotDetail(locked: boolean) {
  return {
    accountingLock: null,
    costLock: locked ? { lockedAt: '2026-11-26T00:00:00.000Z', lockNote: 'QA' } : null,
    shipment: {
      id: 9,
      version: 3,
      customerId: 1,
      isAdHoc: false,
      rawCustomerName: null,
      rawRouteName: null,
      factoryName: null,
      routeId: null,
      cargoTypeId: null,
      bookingRef: '',
      blNumber: 'BL-789-LOCK',
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
      operationalNotes: null,
    },
    declarations: [],
    containers: [{
      id: 31,
      containerNumber: 'MSKU9000970',
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
      declarationNumber: 'QA789DEL01',
    }],
    documents: [],
    statusHistory: [],
  } as unknown as ShipmentClientModule.ShipmentDetail;
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/shipments/9']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <Routes>
            <Route
              path="/shipments/:id"
              element={
                <ShipmentCreateWorkspace
                  viewTarget={{ shipmentId: 9, canEditLot: true, canDeleteLot: true, canDeclareCost: true, canEditDeclaration: true }}
                />
              }
            />
            <Route path="/shipments/:id/edit" element={<div data-testid="edit-form" />} />
            <Route path="/shipments" element={<div data-testid="shipment-list" />} />
            <Route path="/shipments/new" element={<div data-testid="shipment-new" />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SIL-789 — the locked lot page names the lock it enforces', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getShipmentDetail.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    checkShipmentReferenceDuplicate.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('a cost-locked lot renders the KB reason under the SỐ TỜ KHAI cell and beside the disabled actions', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail(true));
    renderView();

    expect(await screen.findByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    // SIL-1144: the review band captions the same declaration reason — this
    // pin reads the SỐ TỜ KHAI cell's own subvalue line.
    expect(document.querySelector('.csc-container-cell__subvalue')?.textContent).toContain(DECL_REASON);
    expect(screen.getByText(LOT_REASON)).toBeTruthy();

    // The cluster stays disabled with its accessible lock name (HOT-02).
    const edit = screen.getByRole('button', { name: 'Sửa lô hàng — lô đã khóa kế toán' });
    expect(edit.getAttribute('data-disabled')).toBe('true');
  });

  it('an unlocked lot renders neither reason (the cell stays the inline editor)', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail(false));
    renderView();

    expect(await screen.findByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    expect(screen.queryByText(DECL_REASON)).toBeNull();
    expect(screen.queryByText(LOT_REASON)).toBeNull();
    // SIL-720 inline cell is live on the unlocked lot.
    expect(screen.getByRole('button', { name: /Sửa số tờ khai · MSKU9000970/ })).toBeTruthy();
  });
});
