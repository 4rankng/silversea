import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SIL-720 (id 840) — the CUS lot page (/shipments/:id) edits the per-container
 * "Số tờ khai" INLINE: click the cell → the shared floating editor opens →
 * Enter saves through the per-container command (the FB-109 auto-copy to the
 * lot's still-empty sibling containers runs server-side, so the page re-reads
 * to show it).
 *
 * Before the fix the cell only displayed: the whole worksheet is frozen in
 * view mode, so the customer had to open "Sửa" (the full form) or move to the
 * /shipments-detail grid to change a declaration number.
 */
const { getBootstrap, getShipmentDetail, listOperationalSites, listSharedWarehouseSites, updateCusShipmentContainerLine } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  getShipmentDetail: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
  updateCusShipmentContainerLine: vi.fn(),
}));

vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  getShipmentDetail,
  listOperationalSites,
  listSharedWarehouseSites,
  updateCusShipmentContainerLine,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

function lotDetail(declarationNumbers: Array<string | null> = [null]) {
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
      blNumber: 'BL-VIEW-001',
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
        cargoWeightKg: null,
        cargoVolumeCbm: null,
        customerAppointmentAt: null,
        operationalSiteId: null,
        rawFactoryName: null,
        declarationNumber: declarationNumbers[0] ?? null,
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
        declarationNumber: declarationNumbers[1] ?? null,
      },
    ],
    documents: [],
    statusHistory: [],
  } as unknown as ShipmentClientModule.ShipmentDetail;
}

function renderView(viewProps: { canEditDeclaration?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={['/shipments/9']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <Routes>
            <Route
              path="/shipments/:id"
              element={<ShipmentCreateWorkspace viewTarget={{ shipmentId: 9, ...viewProps }} />}
            />
            <Route path="/shipments/:id/edit" element={<div data-testid="edit-form" />} />
            <Route path="/shipments" element={<div data-testid="shipment-list" />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ShipmentCreateWorkspace — SIL-720 inline tờ khai on the lot page', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getShipmentDetail.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    updateCusShipmentContainerLine.mockReset();
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
    updateCusShipmentContainerLine.mockResolvedValue({ line: {} as never, declarationSync: { updatedContainerIds: [32] } });
  });

  it('opens the inline editor on the Số tờ khai cell and saves through the per-container command', async () => {
    renderView({ canEditDeclaration: true });

    const trigger = await screen.findByRole('button', { name: /Sửa số tờ khai · CSQU3054383/ });
    fireEvent.click(trigger);

    const input = await screen.findByRole('textbox', { name: 'Số tờ khai' });
    fireEvent.change(input, { target: { value: 'TK-A15-01' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(
      9,
      31,
      { expectedShipmentVersion: 3, declarationNumber: 'TK-A15-01' },
      expect.any(String),
    );
  });

  it('reports the FB-109 auto-copy and re-reads the lot so the synced rows show', async () => {
    // The second read returns the SERVER's state: the number on the saved
    // container AND on the still-empty sibling (FB-109 auto-copy). The page
    // must show both — the ticket's "2 dòng có, 1 dòng trống" complaint was
    // exactly this surface reading stale data.
    getShipmentDetail.mockResolvedValueOnce(lotDetail());
    getShipmentDetail.mockResolvedValue(lotDetail(['TK-A15-01', 'TK-A15-01']));

    renderView({ canEditDeclaration: true });

    const trigger = await screen.findByRole('button', { name: /Sửa số tờ khai · CSQU3054383/ });
    fireEvent.click(trigger);
    const input = await screen.findByRole('textbox', { name: 'Số tờ khai' });
    fireEvent.change(input, { target: { value: 'TK-A15-01' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText(/tự điền thêm cho 1 container/i)).toBeTruthy());
    // The lot is re-read — the server filled the still-empty sibling container.
    await waitFor(() => expect(getShipmentDetail.mock.calls.length).toBeGreaterThan(1));
    // Both rows show the number on THIS surface.
    await waitFor(() => {
      const cells = [...document.querySelectorAll('[data-field-id$="-declaration"]')]
        .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '');
      expect(cells).toHaveLength(2);
      expect(cells.every((cell) => cell.includes('TK-A15-01'))).toBe(true);
    });
  });

  it('keeps the cell frozen for a viewer without the declaration writer law', async () => {
    renderView({});

    await screen.findByRole('button', { name: /Quay lại/ });
    expect(screen.queryByRole('button', { name: /Sửa số tờ khai/ })).toBeNull();
  });
});
