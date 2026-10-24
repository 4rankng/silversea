// SIL-171 (FB-147) — "Sửa lô" opens the Tạo lô hàng form in EDIT mode.
// Scoped gates for the ticket: the form opens pre-filled (incl. Hình thức
// XNK — the field QA's repro called out), validation stays the create form's
// own, and the submit PATCHes the existing lot (PUT /shipments/:id via
// updateShipment) instead of creating a new one.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import { ToastProvider } from '../../components/shared/Toast';
import { ReducedMotionProvider } from '../../hooks/usePrefersReducedMotion';
import type { ShipmentEditDetail } from '../../features/shipments/create/shipment-edit-prefill';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  quickCreate: vi.fn(),
  sites: vi.fn(),
  sharedWarehouseSites: vi.fn(),
  saveContainers: vi.fn(),
  createDeclaration: vi.fn(),
  updateDeclaration: vi.fn(),
  deleteDeclaration: vi.fn(),
  updateShipment: vi.fn(),
  getShipmentDetail: vi.fn(),
  checkDuplicate: vi.fn().mockResolvedValue([]),
  createShippingLine: vi.fn(),
}));

vi.mock('../../api/tripClient', () => ({ tripClient: { getBootstrap: mocks.bootstrap } }));
vi.mock('../../features/shipments/create/FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../api/shipmentClient', () => ({
  quickCreateShipment: mocks.quickCreate,
  listOperationalSites: mocks.sites,
  listSharedWarehouseSites: mocks.sharedWarehouseSites,
  saveShipmentContainers: mocks.saveContainers,
  createShipmentDeclaration: mocks.createDeclaration,
  updateShipmentDeclaration: mocks.updateDeclaration,
  deleteShipmentDeclaration: mocks.deleteDeclaration,
  updateShipment: mocks.updateShipment,
  getShipmentDetail: mocks.getShipmentDetail,
  createShippingLine: mocks.createShippingLine,
}));
vi.mock('../../api/shipmentDuplicateClient', () => ({
  checkShipmentReferenceDuplicate: mocks.checkDuplicate,
}));

import ClerkShipmentEditPage from './ClerkShipmentEditPage';

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

/** QA R41's exact repro shape: lot 186, FCL IMPORT, one container, one
 *  declaration — the detail GET /shipments/:id returns. */
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
    factoryName: null,
    shippingLineName: 'Maersk',
    customsCutoffAt: null,
    closingAt: null,
    plannedReturnAt: null,
    cargoWeightKg: null,
    cargoVolumeCbm: null,
    packageCount: null,
    packageType: null,
    operationalNotes: 'Ghi chú cho lái xe ban đầu',
    customerNotes: 'Ghi chú khách ban đầu',
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
      customerAppointmentAt: '2026-10-20T08:30:00+07:00',
      pickupPortId: 21,
      dropoffPortId: 22,
      routeId: 11,
      operationalSiteId: 41,
      notes: null,
    },
  ],
  documents: [],
  declarations: [
    { id: 66, shipmentId: 186, declarationNumber: 'TK-001', scope: 'SINGLE', issuedAt: null, note: null, createdBy: null, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' },
  ],
  statusHistory: [],
  pendingChangeRequests: [],
  podReviews: [],
  carrierAssignments: [],
  accountingLock: null,
};

function renderEditPage(path = '/shipments/186/edit') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><ReducedMotionProvider><ToastProvider><Routes>
    <Route path="/shipments/:id/edit" element={<ClerkShipmentEditPage />} />
    <Route path="/shipments/:id" element={<div data-testid="shipment-detail" />} />
    <Route path="/shipments" element={<div data-testid="shipment-list" />} />
  </Routes></ToastProvider></ReducedMotionProvider></QueryClientProvider></MemoryRouter>);
}

describe('ClerkShipmentEditPage — SIL-171 "Sửa lô" dùng lại form Tạo lô hàng', () => {
  beforeEach(() => {
    mocks.bootstrap.mockReset().mockResolvedValue(bootstrap);
    mocks.getShipmentDetail.mockReset().mockResolvedValue(detail);
    mocks.sites.mockReset().mockResolvedValue(sites);
    mocks.sharedWarehouseSites.mockReset().mockResolvedValue([]);
    mocks.quickCreate.mockReset();
    mocks.updateShipment.mockReset().mockResolvedValue({ id: 186, version: 8 });
    mocks.saveContainers.mockReset().mockResolvedValue({ shipmentVersion: 9 });
    mocks.createDeclaration.mockReset();
    mocks.updateDeclaration.mockReset();
    mocks.deleteDeclaration.mockReset();
    mocks.checkDuplicate.mockReset().mockResolvedValue([]);
  });

  it('mở đúng form Tạo lô hàng ở chế độ sửa — tiêu đề "Sửa lô hàng", không còn "Tạo lô hàng"/"Lưu nháp"', async () => {
    renderEditPage();
    expect(await screen.findByRole('heading', { name: 'Sửa lô hàng' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tạo lô hàng' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu nháp' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeTruthy();
  });

  it('pre-fill toàn bộ dữ liệu lô — kể cả Hình thức XNK (trường QA R41 gọi tên)', async () => {
    renderEditPage();
    // Chờ pre-fill xong (form render sau khi detail + bootstrap lands).
    await screen.findByRole('heading', { name: 'Sửa lô hàng' });
    // XNK là UUI Select (trigger hiển thị option label) — assert trigger text.
    const xnkField = document.querySelector('[data-field-id="shipment-trade-direction"]');
    expect(xnkField).toBeTruthy();
    expect(xnkField!.textContent).toContain('Nhập khẩu');
    const bill = screen.getByLabelText(/Số Bill\/Booking/) as HTMLInputElement;
    expect(bill.value).toBe('BL-001');
    // Container row giữ id persist (reconcile update-by-id) + số cont.
    const contInputs = screen.getAllByLabelText(/Số container/i) as HTMLInputElement[];
    expect(contInputs.some((input) => input.value === 'CONT-001')).toBe(true);
    // Số tờ khai lô pre-fill từ declarations — render dạng chip trong strip.
    const declStrip = document.querySelector('[data-field-id="shipment-declarations"]');
    expect(declStrip).toBeTruthy();
    expect(declStrip!.textContent).toContain('TK-001');
  });

  it('submit = PATCH lô hiện có — updateShipment với expectedVersion, KHÔNG tạo lô mới', async () => {
    renderEditPage();
    await screen.findByRole('heading', { name: 'Sửa lô hàng' });
    // Sửa Số Bill rồi lưu — đúng luồng khách Zalo 24/10 mô tả.
    const bill = await screen.findByLabelText(/Số Bill\/Booking/);
    fireEvent.change(bill, { target: { value: 'BL-009' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => {
      expect(mocks.updateShipment).toHaveBeenCalledTimes(1);
    });
    expect(mocks.updateShipment).toHaveBeenCalledWith(186, expect.objectContaining({
      expectedVersion: 7,
      customerId: 7,
      tradeDirection: 'IMPORT',
      blNumber: 'BL-009',
    }));
    expect(mocks.quickCreate).not.toHaveBeenCalled();
    // Container row reconcile theo id persist — không delete + reinsert.
    await waitFor(() => {
      expect(mocks.saveContainers).toHaveBeenCalledWith(186, expect.objectContaining({
        expectedVersion: 8,
        containers: [expect.objectContaining({ id: 55, containerNumber: 'CONT-001' })],
      }));
    });
    // Tờ khai không đổi → không phát sinh gọi declaration.
    expect(mocks.createDeclaration).not.toHaveBeenCalled();
    expect(mocks.updateDeclaration).not.toHaveBeenCalled();
    expect(mocks.deleteDeclaration).not.toHaveBeenCalled();
    // Sau lưu về đúng chi tiết lô đang sửa (rung 1).
    await waitFor(() => {
      expect(screen.getByTestId('shipment-detail')).toBeTruthy();
    });
  });

  it('giữ nguyên validation form tạo — thiếu trường bắt buộc thì chặn, không gọi PATCH', async () => {
    renderEditPage();
    await screen.findByRole('heading', { name: 'Sửa lô hàng' });
    // Xoá Số Bill (IMPORT bắt buộc có Bill) rồi lưu.
    const bill = await screen.findByLabelText(/Số Bill\/Booking/);
    fireEvent.change(bill, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => {
      // Vấn đề vẽ ở cả panel "Cần bổ sung" lẫn viền trường — ít nhất một chỗ.
      expect(screen.getAllByText(/Hàng Nhập cần Số Bill/).length).toBeGreaterThan(0);
    });
    expect(mocks.updateShipment).not.toHaveBeenCalled();
    expect(mocks.quickCreate).not.toHaveBeenCalled();
  });

  it('lô không tải được thì báo lỗi, không mở form rỗng', async () => {
    mocks.getShipmentDetail.mockRejectedValue(new Error('boom'));
    renderEditPage();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Sửa lô hàng' })).toBeNull();
  });

  it('edit mode ẩn các flag create-only (Lệnh chạy ngoài, Có cược container) — không chọn được thứ PATCH không lưu', async () => {
    renderEditPage();
    await screen.findByRole('heading', { name: 'Sửa lô hàng' });
    expect(screen.queryByText('Lệnh chạy ngoài')).toBeNull();
    expect(screen.queryByText('Có cược container')).toBeNull();
    // Đóng kết hợp Ở LẠI: chuỗi update (schema + service + route) hỗ trợ nó.
    expect(screen.getByText('Đóng kết hợp')).toBeTruthy();
  });

  it('lô đang khóa kế toán không mở form sửa (chặn trước khi user gõ) — M2 review', async () => {
    mocks.getShipmentDetail.mockResolvedValue({
      ...detail,
      accountingLock: { billingDocumentId: 44, billingDocumentNumber: 'DN-044', activatedAt: '2026-10-24T00:00:00.000Z', activatedByName: 'Kế toán', reason: 'Khóa cuối kỳ' },
    });
    renderEditPage();
    expect(await screen.findByText(/khóa kế toán/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Sửa lô hàng' })).toBeNull();
    expect(mocks.updateShipment).not.toHaveBeenCalled();
  });
});
