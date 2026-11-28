// SIL-1144 (KB Ch.10 §10.6.7, QA-Retest4 28/11) — the /shipments/:id review
// page carries the "Tờ khai hải quan" band: the §3.4.2 completeness pills
// over the SAME per-container values, with the one write SIL-720 already
// sanctions there (clearing a row's declaration through the per-container
// command + lot reload). No add slot — container mutation is the Sửa lô
// form's territory (SIL-481 review law). A locked lot renders read-only with
// the lock reason captioned; an LCL lot reads its lot-level number as one
// read-only row.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, getShipmentDetail, listOperationalSites, listSharedWarehouseSites, checkShipmentReferenceDuplicate, updateCusShipmentContainerLine } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  getShipmentDetail: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
  checkShipmentReferenceDuplicate: vi.fn(),
  updateCusShipmentContainerLine: vi.fn(),
}));

vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentDuplicateClient', () => ({ checkShipmentReferenceDuplicate }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  getShipmentDetail,
  listOperationalSites,
  listSharedWarehouseSites,
  updateCusShipmentContainerLine,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

function lotDetail(overrides: {
  accountingLock?: Record<string, unknown> | null;
  shipment?: Record<string, unknown>;
  containers?: Array<Record<string, unknown>>;
  declarations?: Array<Record<string, unknown>>;
} = {}) {
  return {
    accountingLock: overrides.accountingLock ?? null,
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
      ...overrides.shipment,
    },
    declarations: overrides.declarations ?? [],
    containers: overrides.containers ?? [
      { id: 31, containerNumber: 'CSQU3054383', containerTypeId: null, routeId: null, rawRouteName: null, pickupPortId: null, dropoffPortId: null, rawPickupPortName: null, rawDropoffPortName: null, cargoWeightKg: null, cargoVolumeCbm: null, customerAppointmentAt: null, operationalSiteId: null, rawFactoryName: null, declarationNumber: 'TK-V1' },
      { id: 32, containerNumber: 'MSKU2000220', containerTypeId: null, routeId: null, rawRouteName: null, pickupPortId: null, dropoffPortId: null, rawPickupPortName: null, rawDropoffPortName: null, cargoWeightKg: null, cargoVolumeCbm: null, customerAppointmentAt: null, operationalSiteId: null, rawFactoryName: null, declarationNumber: null },
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
            <Route path="/shipments/new" element={<div data-testid="shipment-new" />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ShipmentCreateWorkspace — SIL-1144 Tờ khai hải quan band on the review page', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getShipmentDetail.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    checkShipmentReferenceDuplicate.mockReset();
    updateCusShipmentContainerLine.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
    getShipmentDetail.mockResolvedValue(lotDetail());
  });

  it('renders the band with per-container pills and NO add slot on the review page', async () => {
    renderView({ canEditDeclaration: true });

    const section = await screen.findByText('Tờ khai hải quan');
    expect(section.closest('section')?.querySelector('h2')?.textContent).toContain('Tờ khai hải quan');

    const rows = document.querySelectorAll('[data-field-id^="declaration-review-row-"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('CSQU3054383');
    expect(rows[0].textContent).toContain('Đầy đủ');
    expect(rows[0].textContent).toContain('TK-V1');
    expect(rows[1].textContent).toContain('MSKU2000220');
    expect(rows[1].textContent).toContain('Vẫn thiếu');

    // The review page never grows a container: no '+ Thêm tờ khai' slot, and
    // the create form's register (its local delete over drafts) stays off.
    expect(screen.queryByRole('button', { name: '+ Thêm tờ khai' })).toBeNull();
    expect(document.querySelector('[data-field-id="declaration-add"]')).toBeNull();
  });

  it('the per-row clear rides the SIL-720 per-container command, then reloads the lot', async () => {
    updateCusShipmentContainerLine.mockResolvedValue({ updatedContainers: [] });
    renderView({ canEditDeclaration: true });
    await screen.findByText('Tờ khai hải quan');

    const before = getShipmentDetail.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tờ khai TK-V1' }));

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    expect(updateCusShipmentContainerLine.mock.calls[0]).toEqual([
      9,
      31,
      { expectedShipmentVersion: 3, declarationNumber: null },
      expect.any(String),
    ]);
    await waitFor(() => expect(getShipmentDetail.mock.calls.length).toBeGreaterThan(before));
    // The empty row has nothing to clear — its delete stays disabled.
    expect((screen.getByRole('button', { name: 'Xóa tờ khai MSKU2000220' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a viewer without the declaration gate reads pills only — no delete buttons', async () => {
    renderView();
    await screen.findByText('Tờ khai hải quan');
    expect(screen.queryByRole('button', { name: /Xóa tờ khai/ })).toBeNull();
    expect(document.querySelector('[data-field-id="declaration-review-row-1"]')?.textContent).toContain('TK-V1');
  });

  it('an accounting-locked lot captions the lock reason under the band', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail({
      accountingLock: { reason: 'Kế toán đã khóa', activatedAt: null, activatedByName: null },
    }));
    renderView({ canEditDeclaration: true });
    const section = (await screen.findByText('Tờ khai hải quan')).closest('section') as HTMLElement;
    expect(screen.queryByRole('button', { name: /Xóa tờ khai/ })).toBeNull();
    expect(section.querySelector('p.csc-decl-review__lock')?.textContent).toBe('Lô hàng đã khóa kế toán; không thể sửa tờ khai.');
  });

  it('an LCL lot reads its lot-level number as one read-only register row', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail({
      shipment: { cargoMode: 'LCL' },
      declarations: [{ id: 1, declarationNumber: 'TK-LO-9' }],
      containers: [],
    }));
    renderView({ canEditDeclaration: true });
    await screen.findByText('Tờ khai hải quan');
    const row = document.querySelector('[data-field-id="declaration-review-row-lcl"]') as HTMLElement;
    expect(row.textContent).toContain('Tờ khai cấp lô');
    expect(row.textContent).toContain('TK-LO-9');
    expect(row.textContent).toContain('Đầy đủ');
    expect(screen.queryByRole('button', { name: /Xóa tờ khai/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Thêm tờ khai' })).toBeNull();
  });
});
