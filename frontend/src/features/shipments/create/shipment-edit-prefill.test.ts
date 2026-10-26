// SIL-171 — unit pins for the edit pre-fill mapping (GET /shipments/:id →
// create-form state). UI behavior lives in ClerkShipmentEditPage.test.tsx;
// these cover the branches the page test cannot reach cheaply (LCL kho
// direction mapping, ad-hoc identity, FCL id/version/declaration seed).
import { describe, expect, it } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import type { ShipmentDetail } from '../../../api/shipmentClient';
import { buildShipmentEditPrefill, type ShipmentEditDetail } from './shipment-edit-prefill';

function detailFixture(overrides: Partial<ShipmentEditDetail['shipment']>): ShipmentEditDetail {
  const base: ShipmentDetail = {
    shipment: {
      id: 186,
      shipmentCode: 'CUS-0186',
      version: 7,
      customerId: 7,
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
      operationalNotes: null,
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
      ...overrides,
    },
    containers: [],
    documents: [],
    declarations: [],
    statusHistory: [],
    pendingChangeRequests: [],
    podReviews: [],
    carrierAssignments: [],
    accountingLock: null,
  };
  return base as ShipmentEditDetail;
}

describe('buildShipmentEditPrefill', () => {
  it('FCL: seed mang id/version + declaration ids, container giữ persisted id', () => {
    const detail = detailFixture({});
    detail.containers = [{
      id: 55, shipmentId: 186, containerTypeId: 31, containerNumber: 'CONT-001',
      sealNumber: null, cargoWeightKg: '12000', customerAppointmentAt: '2026-10-20T08:30:00+07:00',
      pickupPortId: 21, dropoffPortId: 22, routeId: 11, operationalSiteId: 41, notes: null,
    } as ShipmentEditDetail['containers'][number]];
    detail.declarations = [
      { id: 66, shipmentId: 186, declarationNumber: 'TK-001', scope: 'SINGLE', issuedAt: null, note: null, createdBy: null, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' },
      { id: 67, shipmentId: 186, declarationNumber: 'TK-002', scope: 'SINGLE', issuedAt: null, note: null, createdBy: null, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' },
    ];

    const prefill = buildShipmentEditPrefill(detail);

    // SIL-521: seed không còn declaration state — tờ khai per-cont only.
    expect(prefill.seed).toEqual({
      shipmentId: 186,
      version: 7,
      fclContainers: true,
    });
    expect(prefill.form).not.toHaveProperty('declarationNumber');
    expect(prefill.form).not.toHaveProperty('declarationNumbers');
    expect(prefill.containers).toHaveLength(1);
    expect(prefill.containers[0].id).toBe(55);
    expect(prefill.containers[0].containerTypeId).toBe('31');
    // +07:00 ISO → local datetime input (inverse of localDateTimeToIso).
    expect(prefill.containers[0].customerAppointmentAt).toBe('2026-10-20T08:30');
  });

  it('LCL: pre-fill Hình thức XNK, kho theo chiều hướng, các trường hàng lẻ + không reconcile container', () => {
    const detail = detailFixture({
      cargoMode: 'LCL',
      tradeDirection: 'EXPORT',
      bookingRef: 'BOOK-9',
      blNumber: null,
      operationalSiteId: 41,
      pickupWarehouseSiteId: null,
      factoryName: 'Nhà máy Long Minh',
      routeId: 11,
      cargoTypeId: 32,
      expectedDeliveryDate: '2026-10-22',
      // Xuất khẩu: kho là điểm GIAO → đọc từ deliveryLocation (FB-105 §3).
      deliveryLocation: 'Kho Cát Lái',
      pickupLocation: 'Nhà máy Long Minh',
      cargoWeightKg: '1500',
      cargoVolumeCbm: '2.5',
      packageCount: 30,
      packageType: 'Pallet',
      closingAt: '2026-10-21T09:00:00+07:00',
    });

    const prefill = buildShipmentEditPrefill(detail);

    expect(prefill.form.tradeDirection).toBe('EXPORT');
    expect(prefill.form.bookingRef).toBe('BOOK-9');
    expect(prefill.form.operationalSiteId).toBe('41');
    expect(prefill.form.routeId).toBe('11');
    expect(prefill.form.expectedDeliveryDate).toBe('2026-10-22');
    expect(prefill.form.pickupWarehouseName).toBe('Kho Cát Lái');
    expect(prefill.form.packageCount).toBe('30');
    expect(prefill.form.closingAt).toBe('2026-10-21T09:00');
    expect(prefill.containers).toEqual([]);
    expect(prefill.seed.fclContainers).toBe(false);
  });

  it('ad-hoc: customerId rỗng + isAdHoc/rawCustomerName; customer note đi theo form', () => {
    const detail = detailFixture({
      isAdHoc: true,
      rawCustomerName: 'Khách chạy ngoài',
      rawRouteName: 'Tuyến riêng',
      customerNotes: 'Ghi chú khách',
      tradeDirection: 'IMPORT',
      cargoMode: 'LCL',
    });
    (detail.shipment as { customerId: number | null }).customerId = null;

    const prefill = buildShipmentEditPrefill(detail);

    expect(prefill.form.customerId).toBe('');
    expect(prefill.form.isAdHoc).toBe(true);
    expect(prefill.form.rawCustomerName).toBe('Khách chạy ngoài');
    expect(prefill.customerNotes).toBe('Ghi chú khách');
  });

  it('FCL không có container row nào vẫn mở 1 dòng trống để sửa', () => {
    const prefill = buildShipmentEditPrefill(detailFixture({}));
    expect(prefill.containers).toHaveLength(1);
    expect(prefill.containers[0].id).toBeUndefined();
  });
});
