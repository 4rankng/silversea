import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  getShipmentDetail,
  listOperationalSites,
  listSharedWarehouseSites,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

/** A minimal persisted FCL lot — only the fields the workspace and the
 *  SIL-171 prefill mapping actually read. `accountingLock` is a TOP-LEVEL
 *  detail field (GET /shipments/:id), not a shipment field. */
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
      operationalNotes: 'Chú ý vessel delay',
      ...overrides.shipment,
    },
    declarations: overrides.declarations ?? [],
    containers: overrides.containers ?? [{
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
  } as unknown as ShipmentClientModule.ShipmentDetail;
}

function renderView(viewProps: { canEditLot?: boolean } = {}) {
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

describe('ShipmentCreateWorkspace — SIL-481 view mode (post-create review)', { timeout: 20000 }, () => {
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
    getShipmentDetail.mockResolvedValue(lotDetail());
  });

  it('prefills the lot read-only under the "Chi tiết lô hàng" topline with no save actions', async () => {
    renderView({ canEditLot: true });

    expect(await screen.findByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    const bill = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(bill.value).toBe('BL-VIEW-001');
    expect(bill).toBeDisabled();

    // The whole worksheet is frozen: mode radios, notes, container cells.
    expect(screen.getByRole('radio', { name: /Hàng FCL/ })).toBeDisabled();
    const driverNotes = screen.getByLabelText('Ghi chú cho lái xe') as HTMLTextAreaElement;
    expect(driverNotes.value).toBe('Chú ý vessel delay');
    expect(driverNotes).toBeDisabled();

    // No create/save affordance anywhere, and the fill-progress chip is gone.
    expect(screen.queryByRole('button', { name: 'Tạo lô hàng' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu nháp' })).toBeNull();
    expect(screen.queryByText(/Bắt buộc:/)).toBeNull();
  });

  it('the action pair is Quay lại + Chuyển sang sửa, repeated at the foot', async () => {
    renderView({ canEditLot: true });

    expect(await screen.findByRole('button', { name: 'Chuyển sang sửa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chuyển sang sửa (cuối trang)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quay lại (cuối trang)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Huỷ (cuối trang)' })).toBeNull();
  });

  it('"Chuyển sang sửa" opens the SIL-171 edit form for the same lot', async () => {
    renderView({ canEditLot: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Chuyển sang sửa' }));
    await waitFor(() => expect(screen.getByTestId('edit-form')).toBeTruthy());
  });

  it('"Quay lại" returns to the lô list', async () => {
    renderView({ canEditLot: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Quay lại' }));
    await waitFor(() => expect(screen.getByTestId('shipment-list')).toBeTruthy());
  });

  it('a role the edit route refuses sees Quay lại only — no edit button', async () => {
    renderView({ canEditLot: false });
    expect(await screen.findByRole('button', { name: 'Quay lại' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chuyển sang sửa' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chuyển sang sửa (cuối trang)' })).toBeNull();
  });

  it('an accounting-locked lot still reads, but Chuyển sang sửa is disabled with the reason', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail({
      accountingLock: { reason: 'Kế toán đã khóa', activatedAt: null, activatedByName: null },
    }));
    renderView({ canEditLot: true });

    expect(await screen.findByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    const bill = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
      expect(el?.value).toBe('BL-VIEW-001');
      return el!;
    });
    expect(bill).toBeDisabled();
    const edit = await screen.findByRole('button', { name: 'Chuyển sang sửa' });
    // react-aria buttons express disabled as data-disabled (still focusable).
    expect(edit.getAttribute('data-disabled')).toBe('true');
  });

  it('the as-you-type duplicate-reference guard never runs on a read-only review', async () => {
    renderView({ canEditLot: true });
    await screen.findByRole('heading', { name: 'Chi tiết lô hàng' });
    await waitFor(() => {
      const bill = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
      expect(bill?.value).toBe('BL-VIEW-001');
    });
    // The guard debounces 350ms after the prefill lands; give it that window.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkShipmentReferenceDuplicate).not.toHaveBeenCalled();
  });

  it('Enter on a read-only field never submits the review', async () => {
    renderView({ canEditLot: true });
    const bill = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input');
      expect(el).toBeTruthy();
      return el!;
    });
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit');
    fireEvent.keyDown(bill, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The Enter gate itself must fire (not just the submit backstop).
    expect(submitSpy).not.toHaveBeenCalled();
    // Still on the review — no edit landing, no list exit, form intact.
    expect(screen.getByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    expect(screen.queryByTestId('edit-form')).toBeNull();
    expect(screen.queryByTestId('shipment-list')).toBeNull();
    submitSpy.mockRestore();
  });

  it('a multi-container lot exposes no mutating affordance in view (copy-down, delete row)', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail({
      containers: [
        { id: 31, containerNumber: 'CSQU3054383', customerAppointmentAt: '2026-10-26T08:30' },
        { id: 32, containerNumber: 'CSQU4444444', customerAppointmentAt: null },
      ],
    }));
    renderView({ canEditLot: true });

    expect(await screen.findByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    await waitFor(() => {
      // The cell renders its collapsed mask as text (no editor input in view).
      expect(document.body.textContent).toContain('CSQU3054383');
    });
    // MAJOR-fix pins (review 25/10): the per-row copy-down mutation and the
    // per-row delete (which opens the discard confirm) must not render in
    // view. The SECTION-level copy button stays in the DOM but disabled.
    expect(screen.queryByRole('button', { name: /Copy ngày giờ đóng trả .* sang các container chưa có lịch/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa container 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa container 2' })).toBeNull();
    const sectionCopy = screen.queryByRole('button', { name: /Copy giờ hẹn xuống cont trống/ });
    if (sectionCopy) expect(sectionCopy).toHaveAttribute('disabled');
  });
});
