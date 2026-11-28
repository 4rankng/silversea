// SIL-1160 (K10.16): the Sửa lô form renders per-row Xóa container. A
// container already riding a live trip — or carrying a số tờ khai — opens
// the blocked-reasons dialog (the save's reconcile refuses exactly these
// rows, so the click must never die silently at save time); a trip-free
// container deletes through the standing confirm.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  getShipmentDetail,
  listOperationalSites,
  listSharedWarehouseSites,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

const TRIP_REASON = 'Container đã gắn chuyến xe — hủy hoặc thay thế lệnh điều xe trước khi xóa';

/** Three persisted containers: 901 rides a live trip AND carries a tờ khai
 *  (both reasons), 902 carries only a tờ khai, 903 is clean. */
function editLotDetail() {
  const container = (id: number, containerNumber: string, declarationNumber: string | null) => ({
    id,
    containerNumber,
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
    declarationNumber,
  });
  return {
    accountingLock: null,
    hasLiveTrips: true,
    carrierAssignments: [
      { fulfillmentId: 501, fulfillmentVersion: 1, shipmentContainerId: 901, containerTypeCode: null, containerTypeName: null, carrierType: 'OWN', externalCarrierId: null, externalCarrierName: null, hasLiveTrip: true },
      { fulfillmentId: 502, fulfillmentVersion: 1, shipmentContainerId: 902, containerTypeCode: null, containerTypeName: null, carrierType: null, externalCarrierId: null, externalCarrierName: null, hasLiveTrip: false },
    ],
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
      blNumber: 'BL-SIL1160',
      shippingLineName: null,
      declarationNumber: null,
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      isCombined: false,
      operationalSiteId: null,
      pickupWarehouseSiteId: null,
      pickupLocation: null,
      deliveryLocation: null,
      customsCutoffAt: null,
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
    containers: [
      container(901, 'MSCU1160001', 'TK-1160-A'),
      container(902, 'MSCU1160002', 'TK-1160-B'),
      container(903, 'MSCU1160003', null),
    ],
    documents: [],
    statusHistory: [],
  } as unknown as ShipmentClientModule.ShipmentDetail;
}

function singleCleanLotDetail(): ShipmentClientModule.ShipmentDetail {
  const detail = editLotDetail() as unknown as Record<string, unknown>;
  detail.hasLiveTrips = false;
  detail.carrierAssignments = [];
  detail.containers = [{
    id: 903,
    containerNumber: 'MSCU1160003',
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
  }];
  return detail as unknown as ShipmentClientModule.ShipmentDetail;
}

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={['/shipments/9/edit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentCreateWorkspace editTarget={{ shipmentId: 9 }} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ShipmentCreateWorkspace — SIL-1160 the Sửa lô per-row Xóa container', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getShipmentDetail.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    checkShipmentReferenceDuplicate.mockReset();
    // The mount debounce fires with the prefill Bill — an unresolved mock
    // crashes the guard's .then after teardown.
    checkShipmentReferenceDuplicate.mockResolvedValue([]);
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
    getShipmentDetail.mockResolvedValue(editLotDetail());
  });

  it('offers per-row Xóa container on every row of the edit form, single row included', async () => {
    getShipmentDetail.mockResolvedValue(singleCleanLotDetail());
    renderEdit();
    await screen.findAllByText('MSCU1160003');
    // The create form hides the affordance on its single seed row; the Sửa
    // lô form must not — a persisted container may leave the lot.
    expect(screen.getByRole('button', { name: 'Xóa container 1' })).toBeTruthy();
  });

  it('blocks a trip-bearing container with both reasons in the dialog, no doomed confirm', async () => {
    renderEdit();
    await screen.findAllByText('MSCU1160001');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container 1' }));

    expect(await screen.findByText('Không thể xóa container')).toBeTruthy();
    expect(screen.getByText(TRIP_REASON)).toBeTruthy();
    expect(screen.getByText('Cont có tờ khai TK-1160-A — gỡ tờ khai trước khi xóa')).toBeTruthy();
    // The standing confirm must NOT arm for a blocked row…
    expect(screen.queryByText('Xóa container?')).toBeNull();
    // …and acknowledging the dialog keeps every row on the sheet. The modal
    // carries its own X close with the same accessible name — the footer
    // acknowledge is the last one in the dialog.
    const blockedDialog = screen.getByRole('dialog', { name: 'Không thể xóa container' });
    const acknowledgeButtons = within(blockedDialog).getAllByRole('button', { name: 'Đóng' });
    fireEvent.click(acknowledgeButtons[acknowledgeButtons.length - 1]!);
    await waitFor(() => expect(screen.queryByText('Không thể xóa container')).toBeNull());
    expect(screen.getAllByText('MSCU1160001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MSCU1160003').length).toBeGreaterThan(0);
  });

  it('blocks a tờ khai-only container with its declaration reason', async () => {
    renderEdit();
    await screen.findAllByText('MSCU1160002');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container 2' }));

    expect(await screen.findByText('Không thể xóa container')).toBeTruthy();
    expect(screen.getByText('Cont có tờ khai TK-1160-B — gỡ tờ khai trước khi xóa')).toBeTruthy();
    expect(screen.queryByText(TRIP_REASON)).toBeNull();
  });

  it('deletes a trip-free container through the standing confirm', async () => {
    renderEdit();
    await screen.findAllByText('MSCU1160003');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container 3' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Xóa container' }));
    await waitFor(() => expect(screen.queryAllByText('MSCU1160003')).toHaveLength(0));
    // The blocked siblings stay.
    expect(screen.getAllByText('MSCU1160001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MSCU1160002').length).toBeGreaterThan(0);
  });
});
