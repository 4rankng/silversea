// SIL-930 (KB §3.7.4 K3.99, QA staging 3e9a28fa): the TRỌNG LƯỢNG ghost line
// on the lot worksheet — Chi tiết lô dạng xem (/shipments/:id) and the Tạo lô
// container table — DISPLAYS weight in tấn ("18.500 kg → 18,5 tấn", vi-VN)
// through the shared formatWeight. The old local formatter printed bare kg
// "18.500", which read as 18.500 tấn. The EDIT contract is untouched: the
// floating editor stays raw kg ("Trọng lượng (kg)" + the kg unit span).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, getShipmentDetail, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  getShipmentDetail: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
}));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  getShipmentDetail,
  listOperationalSites,
  listSharedWarehouseSites,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

/** The QA lot: two 20DC containers at 18.500 kg — one seeded, one empty. */
function lotDetail() {
  return {
    accountingLock: null,
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
      blNumber: 'BL-QA3A-FCL-01',
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
    containers: [
      {
        id: 31,
        containerNumber: 'CSQU3054383',
        containerTypeId: null,
        routeId: null,
        rawRouteName: null,
        pickupPortId: null,
        dropoffPortId: null,
        rawPickupPortName: null,
        rawDropoffPortName: null,
        cargoWeightKg: '18500',
        cargoVolumeCbm: null,
        customerAppointmentAt: null,
        operationalSiteId: null,
        rawFactoryName: null,
        declarationNumber: null,
      },
      {
        id: 32,
        containerNumber: 'CSQU3054384',
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
      },
    ],
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
            <Route path="/shipments/:id" element={<ShipmentCreateWorkspace viewTarget={{ shipmentId: 9 }} />} />
            <Route path="/shipments/:id/edit" element={<div data-testid="edit-form" />} />
            <Route path="/shipments" element={<div data-testid="shipment-list" />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentCreateWorkspace />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const weightTrigger = (row: number) =>
  screen.getAllByRole('button', { name: /Chỉnh sửa trọng lượng — dòng \d+/ })[row]!;
const weightInput = (row: number) =>
  screen.getByLabelText(`Trọng lượng (kg) — dòng ${row + 1}`) as HTMLInputElement;

beforeEach(() => {
  getBootstrap.mockReset();
  getShipmentDetail.mockReset();
  listOperationalSites.mockReset();
  listSharedWarehouseSites.mockReset();
  getBootstrap.mockResolvedValue({
    customers: [{ id: 1, name: 'KH A' }],
    routes: [{ id: 7, name: 'Route A' }],
    operationalSites: [],
    sharedWarehouseSites: [],
    containerTypes: [],
    ports: [],
  });
  listOperationalSites.mockResolvedValue([]);
  listSharedWarehouseSites.mockResolvedValue([]);
  getShipmentDetail.mockResolvedValue(lotDetail());
});

describe("SIL-930 — TRỌNG LƯỢNG displays '18,5 tấn' (KB §3.7.4 K3.99)", () => {
  it("the lot view line reads '18,5 tấn' — never the bare kg '18.500'", async () => {
    renderView();
    await waitFor(() => expect(weightTrigger(0)).toBeTruthy());
    expect(weightTrigger(0).textContent).toContain('18,5 tấn');
    expect(weightTrigger(0).textContent).not.toContain('18.500');
  });

  it('an empty weight still reads the empty text, not a fake 0 tấn', async () => {
    renderView();
    await waitFor(() => expect(weightTrigger(1)).toBeTruthy());
    expect(weightTrigger(1).textContent).toContain('Nhập kg');
    expect(weightTrigger(1).textContent).not.toContain('tấn');
  });

  it('the edit contract stays kg: typing into the editor stays raw kg while the line reads tấn', async () => {
    renderCreate();
    await waitFor(() => expect(weightTrigger(0)).toBeTruthy());
    fireEvent.click(weightTrigger(0));
    const input = weightInput(0);
    fireEvent.change(input, { target: { value: '18500' } });
    expect(input.value).toBe('18500');
    expect(screen.getByText('kg', { selector: '.csc-fline__unit' })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(weightTrigger(0).textContent).toContain('18,5 tấn'));
  });
});
