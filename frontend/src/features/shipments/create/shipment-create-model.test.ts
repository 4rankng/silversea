import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_SHIPMENT_CREATE_FORM,
  buildShipmentContainerPayload,
  buildShipmentRootPayload,
  createEmptyContainer,
  getShipmentCreateReadiness,
  validateShipmentCreate,
  type ShipmentContainerDraft,
} from './shipment-create-model';

vi.stubGlobal('crypto', { randomUUID: () => 'row-1' });

const container: ShipmentContainerDraft = {
  key: 'row-1',
  containerNumber: 'MSCU6639870',
  containerTypeId: '31',
  pickupPortId: '21',
  dropoffPortId: '22',
  cargoWeightKg: '12000.25',
  cargoVolumeCbm: '33.5',
  closingDate: '',
};

describe('shipment create model', () => {
  it('keeps a customer-only draft valid while listing every dispatch requirement', () => {
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '7' };
    const readiness = getShipmentCreateReadiness(form, [{ ...container, containerNumber: '' }]);

    expect(readiness.draftReady).toBe(true);
    expect(readiness.dispatchReady).toBe(false);
    expect(readiness.issues.map((item) => item.fieldId)).toEqual([
      'shipment-booking-ref',
      'shipment-trade-direction',
      'shipment-route',
      'container-row-1-number',
      'shipment-expected-delivery',
    ]);
    expect(validateShipmentCreate('DRAFT', readiness)).toEqual([]);
  });

  it('builds the existing FCL root and container payload semantics', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      cargoTypeId: '31',
      bookingRef: 'BK-FCL',
      shippingLineName: 'MSC',
      declarationNumber: 'TK-01',
      tradeDirection: 'IMPORT' as const,
      operationalSiteId: '41',
    };

    expect(buildShipmentRootPayload(form, [container], [{ id: 41, name: 'Nhà máy Long Minh' }])).toMatchObject({
      customerId: 7,
      routeId: 11,
      bookingRef: 'BK-FCL',
      cargoMode: 'FCL',
      operationalSiteId: 41,
      factoryName: 'Nhà máy Long Minh',
      shippingLineName: 'MSC',
      operationalNotes: 'Số tờ khai: TK-01',
    });
    expect(buildShipmentContainerPayload(form, [container])).toEqual([{
      containerNumber: 'MSCU6639870',
      containerTypeId: 31,
      shippingLineName: 'MSC',
      pickupPortId: 21,
      dropoffPortId: 22,
      cargoWeightKg: '12000.25',
      cargoVolumeCbm: '33.5',
      customerAppointmentAt: null,
    }]);
  });

  it('emits per-container cargoVolumeCbm and allows it to be blank (nullable)', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      cargoMode: 'FCL' as const,
      bookingRef: 'BK-FCL',
      shippingLineName: 'MSC',
    };

    const withCbm: ShipmentContainerDraft = {
      ...container,
      cargoVolumeCbm: '  28.75  ',
    };
    expect(buildShipmentContainerPayload(form, [withCbm])).toMatchObject([{ cargoVolumeCbm: '  28.75  ' }]);

    const blankCbm: ShipmentContainerDraft = { ...container, cargoVolumeCbm: '' };
    expect(buildShipmentContainerPayload(form, [blankCbm])).toMatchObject([{ cargoVolumeCbm: null }]);
  });

  it('initializes per-container cargoVolumeCbm as empty string on a new draft', () => {
    expect(createEmptyContainer().cargoVolumeCbm).toBe('');
  });

  it('requires only LCL-specific cargo and schedule fields for dispatch', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      cargoMode: 'LCL' as const,
      bookingRef: 'BK-LCL',
      tradeDirection: 'IMPORT' as const,
      cargoTypeId: '32',
      pickupWarehouseSiteId: '42',
      packageType: 'Pallet',
      packageCount: '8',
      cargoWeightKg: '1200',
      cargoVolumeCbm: '4.25',
      expectedDeliveryDate: '2026-08-14',
    };

    const readiness = getShipmentCreateReadiness(form, [container]);
    expect(readiness.dispatchReady).toBe(true);
    expect(readiness.issues).toEqual([]);
    expect(buildShipmentContainerPayload(form, [container])).toEqual([]);
  });

  it('keeps shipping line and factory optional for FCL dispatch readiness', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      bookingRef: 'BK-FCL',
      tradeDirection: 'IMPORT' as const,
      expectedDeliveryDate: '2026-08-14',
    };
    const readiness = getShipmentCreateReadiness(form, [container]);
    expect(readiness.dispatchReady).toBe(true);
    expect(readiness.issues).toEqual([]);
  });

  it('requires an FCL dispatch schedule date that can make intake ready', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      bookingRef: 'BK-FCL-SCHEDULE',
      tradeDirection: 'IMPORT' as const,
      shippingLineName: 'MSC',
      operationalSiteId: '41',
    };

    const missingSchedule = getShipmentCreateReadiness(form, [container]);
    expect(missingSchedule.issues).toContainEqual(expect.objectContaining({
      fieldId: 'shipment-expected-delivery',
      sectionId: 'schedule',
    }));

    expect(getShipmentCreateReadiness({ ...form, closingAt: '2026-08-14T09:00' }, [container]).dispatchReady).toBe(true);
  });

  it('rejects zero-valued LCL quantities and preserves the common factory detail', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      bookingRef: 'BK-LCL-ZERO',
      tradeDirection: 'IMPORT' as const,
      cargoMode: 'LCL' as const,
      cargoTypeId: '32',
      operationalSiteId: '41',
      pickupWarehouseSiteId: '42',
      packageType: 'Pallet',
      packageCount: '0',
      cargoWeightKg: '0',
      cargoVolumeCbm: '0',
      expectedDeliveryDate: '2026-08-14',
    };
    const readiness = getShipmentCreateReadiness(form, [container]);
    expect(readiness.dispatchReady).toBe(false);
    expect(readiness.issues.map((item) => item.fieldId)).toEqual([
      'shipment-package-count',
      'shipment-cargo-weight',
      'shipment-cargo-volume',
    ]);
    expect(buildShipmentRootPayload(form, [container], [{ id: 41, name: 'Nhà máy Long Minh' }])).toMatchObject({
      operationalSiteId: 41,
      factoryName: 'Nhà máy Long Minh',
      pickupWarehouseSiteId: 42,
    });
  });

  it('maps the per-container closing date to customerAppointmentAt (ISO)', () => {
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '7', shippingLineName: 'MSC' };
    expect(buildShipmentContainerPayload(form, [{ ...container, closingDate: '2026-08-20' }])).toMatchObject([
      { customerAppointmentAt: '2026-08-20T12:00:00.000Z' },
    ]);
    expect(buildShipmentContainerPayload(form, [container])).toMatchObject([
      { customerAppointmentAt: null },
    ]);
  });

  it('formats LCL extra delivery dates into operationalNotes and only for LCL', () => {
    const lcl = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      cargoMode: 'LCL' as const,
      expectedDeliveryDate: '2026-08-14',
      extraDeliveryDates: ['2026-08-15', ''],
    };
    expect(buildShipmentRootPayload(lcl, [], [])).toMatchObject({
      operationalNotes: 'Ngày giao bổ sung: 2026-08-15',
    });

    const fcl = { ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '7', extraDeliveryDates: ['2026-08-15'] };
    expect(buildShipmentRootPayload(fcl, [], []).operationalNotes).toBeNull();
  });
});
