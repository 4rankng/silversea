// SIL-938 (QA fail df7b2a73, KB CUS-02 §7.2.1 K7.2): trong form SỬA lô hàng,
// Enter ở ô nhập (ô Số tờ khai của dòng container, ô "Ngày giờ đóng trả")
// phải LƯU lot và THOÁT về danh sách lô hàng — không phải một phím chết.
// Lỗi thật: ShipmentContainerCell chặn Enter ở capture phase
// (preventDefault + blur) trước khi luật Enter của form (bubble) chạy, nên
// mọi ô trong bảng container không gửi được form. Landing của Enter-save là
// DANH SÁCH (/shipments) theo KB K7.2 — nút "Lưu thay đổi" giữ landing chi
// tiết lot (SIL-171, test riêng).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';

const {
  bootstrap: bootstrapMock,
  sites: sitesMock,
  sharedWarehouseSites,
  quickCreate,
  updateShipment,
  saveContainers,
  getShipmentDetail,
  createShippingLine,
  deleteCusShipment,
} = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  sites: vi.fn(),
  sharedWarehouseSites: vi.fn(),
  quickCreate: vi.fn(),
  updateShipment: vi.fn(),
  saveContainers: vi.fn(),
  getShipmentDetail: vi.fn(),
  createShippingLine: vi.fn(),
  deleteCusShipment: vi.fn(),
}));
vi.mock('../../api/tripClient', () => ({ tripClient: { getBootstrap: bootstrapMock } }));
vi.mock('../../features/shipments/create/FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../api/shipmentClient', () => ({
  listOperationalSites: sitesMock,
  listSharedWarehouseSites: sharedWarehouseSites,
  quickCreateShipment: quickCreate,
  saveShipmentContainers: saveContainers,
  createShipmentDeclaration: vi.fn(),
  updateShipmentDeclaration: vi.fn(),
  deleteShipmentDeclaration: vi.fn(),
  updateShipment,
  getShipmentDetail,
  createShippingLine,
  deleteCusShipment,
}));
vi.mock('../../api/shipmentDuplicateClient', () => ({
  checkShipmentReferenceDuplicate: vi.fn().mockResolvedValue([]),
}));

import ClerkShipmentEditPage from './ClerkShipmentEditPage';
import type { ShipmentEditDetail } from '../../features/shipments/create/shipment-edit-prefill';
import { ToastProvider } from '../../components/shared/Toast';

const bootstrap = {
  customers: [{ id: 7, name: 'Công ty Silver Sea' }],
  routes: [{ id: 11, name: 'Cát Lái — Sóng Thần' }],
  ports: [{ id: 21, name: 'Cảng Cát Lái' }, { id: 22, name: 'Cảng ICD Sóng Thần' }],
  containerTypes: [{ id: 31, code: '40HC', name: 'Container 40 feet cao' }],
  cargoTypes: [{ id: 32, code: 'LCL', name: 'Hàng lẻ' }],
  externalCarriers: [],
};

const sites = [
  { id: 41, customerId: 7, code: 'NM01', name: 'Nhà máy Long Minh', siteType: 'FACTORY', routeId: 11, address: 'Bình Dương', googleMapsUrl: null, contactName: null, contactPhone: null, liftFeeInvoiceName: null, liftFeeInvoiceAddress: null, liftFeeTaxCode: null, strictRules: null, version: 1 },
];

/** Lô FCL Nhập khẩu 1 container, chưa chốt lịch (QA tái hiện trên R8B-472). */
const detail: ShipmentEditDetail = {
  shipment: {
    id: 186,
    shipmentCode: 'CUS-0186',
    version: 7,
    customerId: 7,
    routeId: null,
    responsibleUnitId: null,
    status: ShipmentStatus.READY_FOR_DISPATCH,
    bookingRef: null,
    blNumber: 'BL-001',
    expectedDeliveryDate: null,
    pickupLocation: null,
    deliveryLocation: null,
    contactName: null,
    contactPhone: null,
    tradeDirection: 'IMPORT',
    cargoMode: 'FCL',
    operationalSiteId: null,
    pickupWarehouseSiteId: null,
    additionalPickupWarehouses: [],
    factoryName: null,
    shippingLineName: 'Maersk',
    customsCutoffAt: null,
    closingAt: null,
    plannedReturnAt: null,
    cargoWeightKg: null,
    cargoVolumeCbm: null,
    packageCount: null,
    packageType: null,
    operationalNotes: null,
    customerNotes: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    pricingProjection: null,
    carrierAllocationSummary: null,
    accountingLock: null,
    customerName: 'Công ty Silver Sea',
    effectiveFactoryName: null,
    pickupWarehouseSiteName: null,
    pickupWarehouseSiteType: null,
    routeName: null,
  },
  containers: [
    {
      id: 55,
      shipmentId: 186,
      containerTypeId: 31,
      containerNumber: 'CONT-001',
      sealNumber: null,
      cargoWeightKg: '12000',
      customerAppointmentAt: null,
      pickupPortId: 21,
      dropoffPortId: 22,
      routeId: 11,
      operationalSiteId: 41,
      notes: null,
    },
  ],
  documents: [],
  declarations: [],
  statusHistory: [],
  pendingChangeRequests: [],
  podReviews: [],
  carrierAssignments: [],
  hasLiveTrips: false,
  accountingLock: null,
};

function renderEditPage() {
  return render(<MemoryRouter initialEntries={['/shipments/186/edit']}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><Routes>
    <Route path="/shipments/:id/edit" element={<ClerkShipmentEditPage />} />
    <Route path="/shipments/:id" element={<div data-testid="shipment-detail" />} />
    <Route path="/shipments" element={<div data-testid="shipment-list" />} />
  </Routes></ToastProvider></QueryClientProvider></MemoryRouter>);
}

async function openEditForm() {
  renderEditPage();
  await screen.findByRole('heading', { name: 'Sửa lô hàng' });
  const declaration = await within(screen.getByRole('table', { name: 'Danh sách container' })).findByLabelText('Số tờ khai');
  return declaration;
}

describe('SIL-938 — Enter trong form Sửa lô hàng = lưu + về danh sách lô (KB CUS-02 §7.2.1 K7.2)', { timeout: 30000 }, () => {
  beforeEach(() => {
    bootstrapMock.mockReset().mockResolvedValue(bootstrap);
    getShipmentDetail.mockReset().mockResolvedValue(detail);
    sitesMock.mockReset().mockResolvedValue(sites);
    sharedWarehouseSites.mockReset().mockResolvedValue([]);
    quickCreate.mockReset();
    updateShipment.mockReset().mockResolvedValue({ id: 186, version: 8 });
    saveContainers.mockReset().mockResolvedValue({ shipmentVersion: 9 });
    createShippingLine.mockReset();
  });

  it('Enter ở ô Số tờ khai (dòng container) lưu lot PATCH và thoát về danh sách', async () => {
    // Form hợp lệ: lịch hẹn đã có (QA test 1 chỉ đổi tờ khai) — Enter phải
    // PATCH + thoát. (Trường bắt buộc còn thiếu thì Enter vẽ lỗi, test 3.)
    getShipmentDetail.mockResolvedValue({
      ...detail,
      containers: [{ ...detail.containers[0]!, customerAppointmentAt: '2026-10-20T08:30:00+07:00' }],
    });
    const declaration = await openEditForm();
    fireEvent.change(declaration, { target: { value: 'R8B472DECL01' } });
    fireEvent.keyDown(declaration, { key: 'Enter' });

    await waitFor(() => expect(updateShipment).toHaveBeenCalledTimes(1));
    expect(updateShipment).toHaveBeenCalledWith(186, expect.objectContaining({ expectedVersion: 7 }));
    // KB K7.2: thoát về DANH SÁCH lô hàng, không đứng lại ở form.
    await waitFor(() => expect(screen.getByTestId('shipment-list')).toBeTruthy());
  });

  it('Enter ở ô "Ngày giờ đóng trả" (draft đầy đủ) lưu lot PATCH và thoát về danh sách', async () => {
    await openEditForm();
    const table = screen.getByRole('table', { name: 'Danh sách container' });
    const cell = table.querySelector<HTMLElement>('td[data-label^="Ngày giờ đóng trả"]')!;
    const seg = (key: string) => cell.querySelector<HTMLInputElement>(`input[data-seg="${key}"]`)!;
    fireEvent.change(seg('dd'), { target: { value: '27' } });
    fireEvent.change(seg('mm2'), { target: { value: '11' } });
    fireEvent.change(seg('yyyy'), { target: { value: '2026' } });
    fireEvent.change(seg('hh'), { target: { value: '08' } });
    fireEvent.change(seg('mm'), { target: { value: '00' } });
    fireEvent.keyDown(seg('hh'), { key: 'Enter' });

    await waitFor(() => expect(updateShipment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('shipment-list')).toBeTruthy());
  });

  it('1 Enter ở "Ngày giờ đóng trả" khi hộp "Chọn ngày giờ" đang mở vẫn lưu + thoát (QA 9a96af4a: click cell mở hộp, draft đầy đủ, Enter chỉ collapse ô)', async () => {
    // Repro thật QA trên build 9a96af4a: click ô lịch → combined picker mở
    // (cell reveal tự control.click()), draft điền đủ (chọn từ lịch/không
    // gõ digit — digit-close không chạy), Enter trên segment input: luật cũ
    // nuốt phím khi `active` (chỉ đóng hộp + blur = collapse) → form không
    // bao giờ submit. Kỳ vọng KB K7.2: ĐÚNG 1 Enter lưu + về danh sách.
    await openEditForm();
    const table = screen.getByRole('table', { name: 'Danh sách container' });
    const cell = table.querySelector<HTMLElement>('td[data-label^="Ngày giờ đóng trả"]')!;
    fireEvent.click(cell);
    // Hộp thoại combined đang mở — điều kiện tiền đề của repro FAIL.
    await waitFor(() => expect(document.querySelector('.combined-datetime__popup')).toBeTruthy());
    const seg = (key: string) => cell.querySelector<HTMLInputElement>(`input[data-seg="${key}"]`)!;
    fireEvent.change(seg('dd'), { target: { value: '27' } });
    fireEvent.change(seg('mm2'), { target: { value: '11' } });
    fireEvent.change(seg('yyyy'), { target: { value: '2026' } });
    fireEvent.change(seg('hh'), { target: { value: '08' } });
    fireEvent.change(seg('mm'), { target: { value: '00' } });
    expect(document.querySelector('.combined-datetime__popup')).toBeTruthy();
    fireEvent.keyDown(seg('hh'), { key: 'Enter' });

    await waitFor(() => expect(updateShipment).toHaveBeenCalledTimes(1));
    expect(updateShipment).toHaveBeenCalledWith(186, expect.objectContaining({ expectedVersion: 7 }));
    await waitFor(() => expect(screen.getByTestId('shipment-list')).toBeTruthy());
  });

  it('form thiếu bắt buộc: Enter KHÔNG PATCH, không thoát — vẽ lỗi ở trường (nút Lưu thay đổi vẫn giữ hành vi cũ)', async () => {
    const declaration = await openEditForm();
    // Xoá Số Bill (IMPORT bắt buộc) rồi Enter.
    const bill = screen.getByLabelText(/Số Bill\/Booking/);
    fireEvent.change(bill, { target: { value: '' } });
    fireEvent.keyDown(declaration, { key: 'Enter' });

    await waitFor(() => expect(screen.getAllByText(/Hàng Nhập cần Số Bill/).length).toBeGreaterThan(0));
    expect(updateShipment).not.toHaveBeenCalled();
    expect(quickCreate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('shipment-list')).toBeNull();
  });
});
