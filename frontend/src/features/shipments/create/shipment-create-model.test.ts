import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_SHIPMENT_CREATE_FORM,
  buildShipmentContainerPayload,
  createContainerFromPrevious,
  buildShipmentRootPayload,
  createEmptyContainer,
  getShipmentCreateReadiness,
  resetCustomerSite,
  validateShipmentCreate,
  type ShipmentContainerDraft,
} from './shipment-create-model';

vi.stubGlobal('crypto', { randomUUID: () => 'row-1' });

const container: ShipmentContainerDraft = {
  key: 'row-1',
  containerNumber: 'MSCU6639870',
  containerTypeId: '31',
  routeId: '11',
  rawRouteName: '',
  pickupPortId: '21',
  dropoffPortId: '22',
  rawPickupPortName: '',
  rawDropoffPortName: '',
  cargoWeightKg: '12000.25',
  cargoVolumeCbm: '33.5',
  operationalSiteId: '41',
  rawFactoryName: '',
  customerAppointmentAt: '',
};

describe('shipment create model', () => {
  it.each([
    ['inherited', '11', 11, ''],
    ['manually overridden', '12', 11, '12'],
    ['manual without factory route', '12', null, '12'],
    ['unset', '', null, ''],
  ] as const)('TC-CUS-FACTORY-SEARCH-08 clears the factory with a %s route', (_name, routeId, factoryRouteId, expectedRoute) => {
    expect(resetCustomerSite({ operationalSiteId: '41', routeId }, [{ id: 41, routeId: factoryRouteId }]))
      .toEqual({ operationalSiteId: '', routeId: expectedRoute });
  });

  it('keeps a customer-only draft valid while listing every dispatch requirement', () => {
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '7' };
    const readiness = getShipmentCreateReadiness(form, [{ ...container, containerNumber: '' }]);

    expect(readiness.draftReady).toBe(true);
    expect(readiness.dispatchReady).toBe(false);
    expect(readiness.issues.map((item) => item.fieldId)).toEqual([
      'shipment-trade-direction',
      'container-row-1-customer-appointment',
    ]);
    expect(validateShipmentCreate('DRAFT', readiness)).toEqual([]);
  });

  it('keeps FCL route authority on its container payload, never the root payload', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      cargoTypeId: '31',
      blNumber: 'BL-FCL',
      shippingLineName: 'MSC',
      declarationNumber: 'TK-01',
      tradeDirection: 'IMPORT' as const,
      operationalSiteId: '41',
      expectedDeliveryDate: '2026-08-14',
      isCombined: true,
    };

    expect(buildShipmentRootPayload(form, [container], [{ id: 41, name: 'Nhà máy Long Minh' }])).toMatchObject({
      customerId: 7,
      routeId: null,
      blNumber: 'BL-FCL',
      cargoMode: 'FCL',
      operationalSiteId: null,
      factoryName: null,
      shippingLineName: 'MSC',
      isCombined: true,
      driverNotes: null,
    });
    expect(buildShipmentContainerPayload(form, [container])).toEqual([{
      containerNumber: 'MSCU6639870',
      containerTypeId: 31,
      shippingLineName: 'MSC',
      pickupPortId: 21,
      dropoffPortId: 22,
      rawPickupPortName: null,
      rawDropoffPortName: null,
      operationalSiteId: 41,
      rawFactoryName: null,
      cargoWeightKg: '12000.25',
      cargoVolumeCbm: '33.5',
      routeId: 11,
      rawRouteName: null,
      customerAppointmentAt: null,
    }]);
  });

  it('carries row-tier raw factory/route for adhoc rows and nulls the catalog ids', () => {
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, isAdHoc: true, tradeDirection: 'IMPORT' as const, blNumber: 'BL-ADHOC-ROW' };
    const rawRow = { ...createEmptyContainer(), containerTypeId: '31', rawFactoryName: 'Xưởng vãng lai 1', rawRouteName: 'Tuyến riêng 1' };
    const catalogRow = { ...createEmptyContainer(), containerTypeId: '31', operationalSiteId: '41', routeId: '11' };
    const [first, second] = buildShipmentContainerPayload(form, [rawRow, catalogRow]);
    expect(first).toEqual({
      containerNumber: null,
      containerTypeId: 31,
      shippingLineName: null,
      pickupPortId: null,
      dropoffPortId: null,
      rawPickupPortName: null,
      rawDropoffPortName: null,
      operationalSiteId: null,
      rawFactoryName: 'Xưởng vãng lai 1',
      cargoWeightKg: null,
      cargoVolumeCbm: null,
      routeId: null,
      rawRouteName: 'Tuyến riêng 1',
      customerAppointmentAt: null,
    });
    expect(second).toEqual(expect.objectContaining({ operationalSiteId: 41, rawFactoryName: null, routeId: 11, rawRouteName: null }));

  });
  it('keeps lift, drop, and appointment times on each FCL container instead of collapsing them into the lot', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      blNumber: 'BL-TWO-CONTAINERS',
      tradeDirection: 'IMPORT' as const,
    };
    const secondContainer: ShipmentContainerDraft = {
      ...container,
      key: 'row-2',
      containerNumber: 'MSCU6639871',
      pickupPortId: '23',
      dropoffPortId: '24',
      routeId: '12',
      customerAppointmentAt: '2026-08-15T09:00',
    };

    expect(getShipmentCreateReadiness(form, [{ ...container, customerAppointmentAt: '2026-08-14T09:00' }, secondContainer]).dispatchReady).toBe(true);
    expect(buildShipmentContainerPayload(form, [container, secondContainer])).toEqual([
      expect.objectContaining({ routeId: 11, pickupPortId: 21, dropoffPortId: 22 }),
      expect.objectContaining({ routeId: 12, pickupPortId: 23, dropoffPortId: 24 }),
    ]);
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

  it('copies a preceding container while requiring a new container number', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'row-2' });
    const copied = createContainerFromPrevious({
      ...container,
      customerAppointmentAt: '2026-08-20T09:30',
    });

    expect(copied).toMatchObject({
      ...container,
      key: 'row-2',
      containerNumber: '',
      customerAppointmentAt: '2026-08-20T09:30',
    });
  });

  it('requires only LCL-specific cargo and schedule fields for dispatch', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      cargoMode: 'LCL' as const,
      blNumber: 'BL-LCL',
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

  it('keeps the shipping line optional once each FCL container has its factory', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      blNumber: 'BL-FCL',
      tradeDirection: 'IMPORT' as const,
    };
    const readiness = getShipmentCreateReadiness(form, [{ ...container, customerAppointmentAt: '2026-08-14T09:00' }]);
    expect(readiness.dispatchReady).toBe(true);
    expect(readiness.issues).toEqual([]);
  });

  it('requires an appointment for every FCL container before the lot can be dispatched', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      blNumber: 'BL-FCL-SCHEDULE',
      tradeDirection: 'IMPORT' as const,
      shippingLineName: 'MSC',
      operationalSiteId: '41',
    };

    const missingSchedule = getShipmentCreateReadiness(form, [container]);
    expect(missingSchedule.issues).toContainEqual(expect.objectContaining({
      fieldId: 'container-row-1-customer-appointment',
      sectionId: 'schedule',
    }));

    expect(getShipmentCreateReadiness(form, [{ ...container, customerAppointmentAt: '2026-08-14T09:00' }]).dispatchReady).toBe(true);
  });

  it('rejects zero-valued LCL quantities and preserves the common factory detail', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      blNumber: 'BL-LCL-ZERO',
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

  it('maps the per-container appointment date and time to customerAppointmentAt (ISO)', () => {
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '7', shippingLineName: 'MSC' };
    expect(buildShipmentContainerPayload(form, [{ ...container, customerAppointmentAt: '2026-08-20T14:30' }])).toMatchObject([
      { customerAppointmentAt: '2026-08-20T14:30:00+07:00' },
    ]);
    expect(buildShipmentContainerPayload(form, [container])).toMatchObject([
      { customerAppointmentAt: null },
    ]);
  });

  it('keeps FCL root delivery dates empty because the first container appointment is authoritative', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      blNumber: 'BL-FCL-DATE',
      tradeDirection: 'IMPORT' as const,
    };
    const scheduled = { ...form, expectedDeliveryDate: '2026-08-20' };
    const readiness = getShipmentCreateReadiness(scheduled, [{ ...container, containerNumber: '', customerAppointmentAt: '2026-08-21T09:00' }]);

    expect(readiness.initialStatus).toBe('PENDING_DATE');
    expect(readiness.dispatchReady).toBe(true);
    expect(buildShipmentRootPayload(scheduled, [{ ...container, customerAppointmentAt: '2026-08-21T09:00' }], []).expectedDeliveryDate).toBeUndefined();
  });

  it('formats LCL extra delivery dates into driverNotes and only for LCL', () => {
    const lcl = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      cargoMode: 'LCL' as const,
      expectedDeliveryDate: '2026-08-14',
      extraDeliveryDates: ['2026-08-15', ''],
    };
    expect(buildShipmentRootPayload(lcl, [], [])).toMatchObject({
      driverNotes: 'Ngày giao bổ sung: 2026-08-15',
    });

    const fcl = { ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '7', extraDeliveryDates: ['2026-08-15'] };
    expect(buildShipmentRootPayload(fcl, [], []).driverNotes).toBeNull();
  });

  // ── Lệnh chạy ngoài (MasterDataNhaMay §4.1) ─────────────────────────────────
  it('ad-hoc flag bypasses catalog/pricing requirements but keeps data-safety checks', () => {
    const adHoc = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      isAdHoc: true,
      rawCustomerName: 'Khách vãng lai',
      tradeDirection: 'IMPORT' as const,
      blNumber: 'ADHOC-1',
      cargoMode: 'FCL' as const,
    };
    // No factory/route/ports on the container — still dispatch-ready under the
    // bypass (AC3), while the container type + appointment remain required.
    const bareContainer = { ...container, operationalSiteId: '', routeId: '', pickupPortId: '', dropoffPortId: '', containerTypeId: '', customerAppointmentAt: '' };
    const readiness = getShipmentCreateReadiness(adHoc, [bareContainer]);
    const byField = new Map(readiness.issues.map((item) => [item.fieldId, item.message]));
    expect(byField.has('shipment-customer')).toBe(false);
    expect(byField.has('container-row-1-factory')).toBe(false);
    expect(byField.has('container-row-1-route')).toBe(false);
    expect(byField.has('container-row-1-pickup-port')).toBe(false);
    expect(byField.has('container-row-1-dropoff-port')).toBe(false);
    // Data-safety checks survive the bypass.
    expect(byField.get('container-row-1-type')).toContain('loại container');
    expect(byField.get('container-row-1-customer-ointment') ?? byField.get('container-row-1-customer-appointment')).toBeTruthy();
  });

  it('ad-hoc create requires a free-text customer name and carries raw fields in the payload', () => {
    const noName = { ...EMPTY_SHIPMENT_CREATE_FORM, isAdHoc: true, tradeDirection: 'IMPORT' as const, blNumber: 'ADHOC-2' };
    const readiness = getShipmentCreateReadiness(noName, []);
    expect(readiness.issues.find((item) => item.fieldId === 'shipment-customer')?.message)
      .toContain('tên khách hàng');

    const adHoc = {
      ...noName,
      rawCustomerName: '  Khách một cuốc  ',
      rawRouteName: 'Cầu Nhật Tân — KCN Quang Minh',
    };
    const root = buildShipmentRootPayload(adHoc, [], []);
    expect(root).toMatchObject({
      customerId: null,
      isAdHoc: true,
      rawCustomerName: 'Khách một cuốc',
      rawRouteName: 'Cầu Nhật Tân — KCN Quang Minh',
    });

    // A catalog pick wins and clears its raw mirror (XOR, §2.1 rule 1).
    const mixed = { ...adHoc, customerId: '7', rawCustomerName: 'ignored' };
    expect(buildShipmentRootPayload(mixed, [], [])).toMatchObject({
      customerId: 7,
      rawCustomerName: null,
    });
  });

  it('sends per-container raw port names only when no catalog port was picked', () => {
    const adHoc = { ...EMPTY_SHIPMENT_CREATE_FORM, isAdHoc: true, rawCustomerName: 'K', tradeDirection: 'IMPORT' as const, blNumber: 'B', cargoMode: 'FCL' as const };
    const rawPorts = {
      ...container,
      pickupPortId: '',
      dropoffPortId: '',
      rawPickupPortName: 'Cảng Bạch Đằng',
      rawDropoffPortName: '  ICD Gia Lâm  ',
    };
    const [row] = buildShipmentContainerPayload(adHoc, [rawPorts]);
    expect(row).toMatchObject({
      pickupPortId: null,
      rawPickupPortName: 'Cảng Bạch Đằng',
      dropoffPortId: null,
      rawDropoffPortName: 'ICD Gia Lâm',
    });

    // Catalog port id present → raw stays null even if text lingered.
    const catalogPick = { ...rawPorts, pickupPortId: '21', rawPickupPortName: 'stale' };
    const [picked] = buildShipmentContainerPayload(adHoc, [catalogPick]);
    expect(picked.pickupPortId).toBe(21);
    expect(picked.rawPickupPortName).toBeNull();
  });
});