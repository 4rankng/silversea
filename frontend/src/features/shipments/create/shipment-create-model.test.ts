import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_SHIPMENT_CREATE_FORM,
  buildShipmentContainerPayload,
  buildShipmentDeclarationPayload,
  createContainerFromPrevious,
  duplicateContainerRow,
  buildShipmentRootPayload,
  createEmptyContainer,
  getShipmentCreateReadiness,
  resetCustomerSite,
  validateShipmentCreate,
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
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
  declarationNumber: 'TK-SIL701-A',
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

  // SIL-607 (ticket 607): the missing-schedule complaint. The validation list
  // must carry exactly ONE appointment issue per container (never a duplicated
  // message for the same row), and a completed copy-all fill — every row
  // carrying the copied datetime — leaves zero appointment issues (CUS-03).
  it('emits one appointment issue per container; a full copy-all fill leaves none', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      tradeDirection: 'IMPORT' as const,
      blNumber: 'BL-SIL607',
    };
    const rows = [container, { ...container, key: 'row-2' }];

    const appointmentIssues = getShipmentCreateReadiness(form, rows).issues
      .filter((item) => item.fieldId.endsWith('-customer-appointment'));
    expect(appointmentIssues.map((item) => item.fieldId)).toEqual([
      'container-row-1-customer-appointment',
      'container-row-2-customer-appointment',
    ]);
    expect(new Set(appointmentIssues.map((item) => item.message)).size).toBe(2);

    const copied = rows.map((row) => ({ ...row, customerAppointmentAt: '2026-08-14T09:00' }));
    expect(getShipmentCreateReadiness(form, copied).issues.some((item) => item.fieldId.endsWith('-customer-appointment'))).toBe(false);
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
      declarationNumber: 'TK-SIL701-A',
      // SIL-643: every intake row rides the explicit Đơn default.
      classification: 'SINGLE',
    }]);
  });

  // SIL-643 (id 748, owner 01/11 — reverses SIL-638 TC5): the create form has
  // NO Phân loại picker — every row the intake sends is Đơn, and the payload
  // carries `classification: 'SINGLE'` explicitly (the BE wire field stays).
  it('SIL-643: payload luôn gửi classification SINGLE cho mọi dòng (không còn cột chọn)', () => {
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '7', cargoMode: 'FCL' as const, shippingLineName: 'MSC' };
    const firstRow = { ...createEmptyContainer(), containerTypeId: '31', declarationNumber: 'TK-643-1' };
    const secondRow = { ...createEmptyContainer(), containerTypeId: '31', declarationNumber: 'TK-643-2' };

    const rows = buildShipmentContainerPayload(form, [firstRow, secondRow]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ classification: 'SINGLE' });
    expect(rows[1]).toMatchObject({ classification: 'SINGLE' });
  });

  // SIL-643: no classification field exists on a draft anymore — an untouched
  // row stays filtered by the plain value scan (the TC5 exemption is gone).
  it('SIL-643: dòng untouched vẫn bị lọc khỏi payload (quét giá trị thuần)', () => {
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '7', cargoMode: 'FCL' as const };
    const untouched = createEmptyContainer();
    const typed = { ...createEmptyContainer(), containerTypeId: '31' };

    expect(buildShipmentContainerPayload(form, [untouched])).toEqual([]);
    expect(buildShipmentContainerPayload(form, [typed])).toMatchObject([{ classification: 'SINGLE' }]);
  });

  it('carries the carrier name on hàng-lẻ root payloads too (SIL-681 r2 — QA fail comment 3885)', () => {
    // The old `cargoMode === 'FCL'` gate (0abff7aa, 14/08/2026) silently
    // dropped LCL carriers on every save while the detail ledger and
    // CusQuickEdit kept editing the field. The lot-level carrier is
    // mode-independent now.
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '7', cargoMode: 'LCL' as const, shippingLineName: 'MSC' };
    expect(buildShipmentRootPayload(form, [container], [{ id: 41, name: 'Nhà máy Long Minh' }])).toMatchObject({
      cargoMode: 'LCL',
      shippingLineName: 'MSC',
    });
    expect(buildShipmentRootPayload({ ...form, shippingLineName: '' }, [container], [{ id: 41, name: 'Nhà máy Long Minh' }])).toMatchObject({
      cargoMode: 'LCL',
      shippingLineName: null,
    });
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
      declarationNumber: null,
      classification: 'SINGLE',
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

  it('initializes per-container SỐ TỜ KHAI as empty string and trims/nulls it in the payload (SIL-600)', () => {
    expect(createEmptyContainer().declarationNumber).toBe('');
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '7', cargoMode: 'FCL' as const, tradeDirection: 'EXPORT' as const, bookingRef: 'BK' };
    const typed = { ...container, containerTypeId: '31', declarationNumber: '  TK-0123456789  ' };
    expect(buildShipmentContainerPayload(form, [typed])).toMatchObject([{ declarationNumber: 'TK-0123456789' }]);
    const emptied = { ...container, containerTypeId: '31', declarationNumber: '   ' };
    expect(buildShipmentContainerPayload(form, [emptied])).toMatchObject([{ declarationNumber: null }]);
  });

  it('allows two rows to carry the SAME số tờ khai (SIL-521 duplicates-allowed model)', () => {
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '7', cargoMode: 'FCL' as const, tradeDirection: 'EXPORT' as const, bookingRef: 'BK' };
    const first = { ...container, containerNumber: 'MSCU6639870', containerTypeId: '31', declarationNumber: 'TK-SHARED-01' };
    const second = { ...container, key: 'row-2', containerNumber: 'MSCU6639871', containerTypeId: '31', declarationNumber: 'TK-SHARED-01' };
    const payload = buildShipmentContainerPayload(form, [first, second]);
    expect(payload).toHaveLength(2);
    expect(payload[0].declarationNumber).toBe('TK-SHARED-01');
    expect(payload[1].declarationNumber).toBe('TK-SHARED-01');
  });

  it('copies a preceding container except Số container and Loại cont (REQ-22 REVERSED)', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'row-2' });
    const copied = createContainerFromPrevious({
      ...container,
      declarationNumber: 'TK-0123456789',
      customerAppointmentAt: '2026-08-20T09:30',
    });

    // REQ-22 REVERSED (ticket 221026173728, 22/10; SIL-488 — workspace gap of
    // reversal 093c5334): "Thêm container" inherits the previous row's shared
    // fields — route, factory, ports, weight and the schedule window — but the
    // two per-container identifiers stay empty: Số container for entry and
    // Loại cont ("Chọn loại") for the operator's own pick. SIL-701/SIL-600:
    // SỐ TỜ KHAI belongs to the shared half — one declaration usually covers
    // the lot, so the copy carries it and each row stays editable (divergence
    // allowed).
    expect(copied).toMatchObject({
      ...container,
      key: 'row-2',
      containerNumber: '',
      containerTypeId: '',
      declarationNumber: 'TK-0123456789',
      customerAppointmentAt: '2026-08-20T09:30',
    });
  });

  it('duplicates a row with EVERY value (SIL-513 STT copy, tờ khai included) but never the persisted id', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'row-3' });
    const clone = duplicateContainerRow({
      ...container,
      id: 77,
      customerAppointmentAt: '2026-08-20T09:30',
    });

    // SIL-513 (owner 26/10): the STT hover copy duplicates the whole line —
    // số cont, loại AND tờ khai INCLUDED (deliberately different from
    // createContainerFromPrevious, whose REQ-22-reversed contract serves
    // "Thêm container"). "Nhân bản" is an EXPLICIT row copy ("copy dòng đó",
    // §3.2 UX note 26/10) and same-lot declaration repeats are legal per
    // SIL-521 — so the clone carries the number. A duplicated row is still a
    // NEW container: fresh key, no persisted id (the reconcile would
    // overwrite its sibling).
    expect(clone).toMatchObject({
      ...container,
      key: 'row-3',
      declarationNumber: 'TK-SIL701-A',
      customerAppointmentAt: '2026-08-20T09:30',
    });
    expect(clone.id).toBeUndefined();
  });

  it('SIL-701: same-lot declaration repeats stay legal and the payload trims/blanks per row', () => {
    // Owner law (SIL-521 điểm 2 + ruling 30/10): trùng số tờ khai trong cùng
    // lô — 1 phần hoặc toàn bộ — never raises a readiness/validation issue.
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      blNumber: 'BL-SAME-DECK',
      tradeDirection: 'IMPORT' as const,
    };
    const twin = { ...container, key: 'row-2', containerNumber: 'MSCU6639871', declarationNumber: 'TK-SIL701-A' };
    const readiness = getShipmentCreateReadiness(form, [
      { ...container, customerAppointmentAt: '2026-08-14T09:00' },
      { ...twin, customerAppointmentAt: '2026-08-14T09:00' },
    ]);
    expect(readiness.dispatchReady).toBe(true);
    expect(readiness.issues).toEqual([]);

    // Per-row wire semantics: trims, blank → null, values never merge.
    const [first, second, third] = buildShipmentContainerPayload(form, [
      { ...container, declarationNumber: '  TK-TRIM  ' },
      { ...twin, declarationNumber: '' },
      { ...twin, key: 'row-3', declarationNumber: 'TK-SIL701-A' },
    ]);
    expect(first).toMatchObject({ declarationNumber: 'TK-TRIM' });
    expect(second).toMatchObject({ declarationNumber: null });
    expect(third).toMatchObject({ declarationNumber: 'TK-SIL701-A' });
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
      operationalSiteId: '41',
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

  // Lệnh chạy ngoài has no catalog customer, and a warehouse always belongs to
  // a customer — so the pickup-warehouse requirement (catalog prerequisite) is
  // waived for ad-hoc LCL lots, mirroring route/factory.
  it('waives the pickup warehouse for an ad-hoc LCL lot', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      isAdHoc: true,
      rawCustomerName: 'Khách chạy ngoài',
      rawRouteName: 'Tuyến riêng',
      cargoMode: 'LCL' as const,
      blNumber: 'BL-LCL-ADHOC-NOWH',
      tradeDirection: 'IMPORT' as const,
      pickupWarehouseSiteId: '',
      packageType: 'Pallet',
      packageCount: '5',
      cargoWeightKg: '300',
      expectedDeliveryDate: '2026-08-03',
    };
    const readiness = getShipmentCreateReadiness(form, []);
    expect(readiness.issues.map((item) => item.fieldId)).not.toContain('shipment-pickup-warehouse');
    expect(readiness.dispatchReady).toBe(true);
  });

  it('still requires the pickup warehouse for a catalog-customer LCL lot', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      cargoMode: 'LCL' as const,
      blNumber: 'BL-LCL-NOWH',
      tradeDirection: 'IMPORT' as const,
      operationalSiteId: '41',
      pickupWarehouseSiteId: '',
      packageType: 'Pallet',
      packageCount: '5',
      cargoWeightKg: '300',
      expectedDeliveryDate: '2026-08-03',
    };
    const readiness = getShipmentCreateReadiness(form, []);
    expect(readiness.dispatchReady).toBe(false);
    expect(readiness.issues).toContainEqual(expect.objectContaining({
      fieldId: 'shipment-pickup-warehouse',
      message: 'Chọn kho lấy hàng.',
    }));
  });

  // FB-105 (spec §2): both hàng lẻ operating points accept typed text, not just
  // a catalog pick; the Nhà máy is required for a catalog lot too.
  it('accepts a typed Kho (CFS) name and a typed Nhà máy name for an LCL lot', () => {
    const form = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      cargoMode: 'LCL' as const,
      blNumber: 'BL-LCL-TYPED',
      tradeDirection: 'IMPORT' as const,
      operationalSiteId: '',
      factoryName: 'Nhà máy gõ tay',
      pickupWarehouseSiteId: '',
      pickupWarehouseName: 'Kho CFS gõ tay',
      packageType: 'Pallet',
      packageCount: '5',
      cargoWeightKg: '300',
      expectedDeliveryDate: '2026-08-03',
    };
    const readiness = getShipmentCreateReadiness(form, []);
    expect(readiness.issues).toEqual([]);
    expect(readiness.dispatchReady).toBe(true);
  });

  it('requires the Nhà máy for a catalog-customer LCL lot (waived for ad-hoc)', () => {
    const base = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      cargoMode: 'LCL' as const,
      blNumber: 'BL-LCL-NOFACTORY',
      tradeDirection: 'IMPORT' as const,
      pickupWarehouseName: 'Kho CFS',
      packageType: 'Pallet',
      packageCount: '5',
      cargoWeightKg: '300',
      expectedDeliveryDate: '2026-08-03',
    };
    const catalogIssues = getShipmentCreateReadiness({ ...base, customerId: '7', routeId: '11' }, []);
    expect(catalogIssues.issues).toContainEqual(expect.objectContaining({
      fieldId: 'shipment-operational-site',
      message: 'Chọn nhà máy.',
    }));

    const adHocIssues = getShipmentCreateReadiness({
      ...base,
      isAdHoc: true,
      rawCustomerName: 'Khách chạy ngoài',
      rawRouteName: 'Tuyến riêng',
      pickupWarehouseName: '',
    }, []);
    expect(adHocIssues.issues.map((item) => item.fieldId)).not.toContain('shipment-operational-site');
    expect(adHocIssues.issues.map((item) => item.fieldId)).not.toContain('shipment-pickup-warehouse');
    expect(adHocIssues.dispatchReady).toBe(true);
  });

  // FB-105 §3 — the two operating points must land on the direction-correct
  // columns: another screen (điều vận Nâng/Trả, chi tiết lô) reads them.
  it.each([
    ['IMPORT', 'Kho lấy hàng (CFS)', 'Nhà máy A', 'Kho lấy hàng (CFS)', 'Nhà máy A'],
    ['EXPORT', 'Kho trả hàng (CFS)', 'Nhà máy A', 'Nhà máy A', 'Kho trả hàng (CFS)'],
  ] as const)('maps the %s LCL points onto pickup/delivery_location', (tradeDirection, warehouse, factory, lift, drop) => {
    const payload = buildShipmentRootPayload({
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      cargoMode: 'LCL',
      blNumber: 'BL-LCL-POINTS',
      tradeDirection,
      pickupWarehouseName: warehouse,
      factoryName: factory,
    }, [], []);
    expect(payload.pickupLocation).toBe(lift);
    expect(payload.deliveryLocation).toBe(drop);
  });

  it('never writes the LCL point names from an FCL payload', () => {
    const payload = buildShipmentRootPayload({
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      cargoMode: 'FCL',
      blNumber: 'BL-FCL-POINTS',
      tradeDirection: 'IMPORT',
      pickupWarehouseName: 'Kho CFS',
      factoryName: 'Nhà máy A',
    }, [], []);
    expect('pickupLocation' in payload).toBe(false);
    expect('deliveryLocation' in payload).toBe(false);
  });

  // SIL-587 (id 687, khách 29/10): "Ngày giờ đóng trả" is LCL's single
  // schedule field. The payload persists it direction-correct (IMPORT →
  // plannedReturnAt, else closingAt — the overview quick-edit's law) as an
  // ICT instant, and derives expectedDeliveryDate from the VN calendar date
  // of the naive wall-clock draft via string surgery — never the host zone
  // (a GMT+8 host must not shift 23:50 into the next day).
  describe('SIL-587 — LCL "Ngày giờ đóng trả" payload mapping', () => {
    const lclForm = (overrides: Partial<ShipmentCreateFormState> = {}) => ({
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      cargoMode: 'LCL' as const,
      tradeDirection: 'IMPORT' as const,
      blNumber: 'BL-LCL-CLOSING',
      operationalSiteId: '41',
      pickupWarehouseSiteId: '42',
      packageType: 'Pallet',
      packageCount: '5',
      cargoWeightKg: '300',
      lclClosingAt: '2026-10-29T14:30',
      ...overrides,
    });

    it('maps an IMPORT lot onto plannedReturnAt (+07:00) and derives the VN-day EDD', () => {
      const payload = buildShipmentRootPayload(lclForm(), [], []);
      expect(payload.plannedReturnAt).toBe('2026-10-29T14:30:00+07:00');
      expect(payload.closingAt).toBeNull();
      expect(payload.expectedDeliveryDate).toBe('2026-10-29');
    });

    it('maps an EXPORT lot onto closingAt and leaves plannedReturnAt null', () => {
      const payload = buildShipmentRootPayload(
        lclForm({ tradeDirection: 'EXPORT', bookingRef: 'BK-LCL-CLOSING', blNumber: '' }),
        [], [],
      );
      expect(payload.closingAt).toBe('2026-10-29T14:30:00+07:00');
      expect(payload.plannedReturnAt).toBeNull();
      expect(payload.expectedDeliveryDate).toBe('2026-10-29');
    });

    it('derives the EDD by string surgery — 23:50 stays on its VN calendar day', () => {
      const payload = buildShipmentRootPayload(lclForm({ lclClosingAt: '2026-10-29T23:50' }), [], []);
      expect(payload.expectedDeliveryDate).toBe('2026-10-29');
      expect(payload.plannedReturnAt).toBe('2026-10-29T23:50:00+07:00');
    });

    it('keeps a legacy stored EDD when the datetime is empty (edit without re-entry)', () => {
      const payload = buildShipmentRootPayload(
        lclForm({ lclClosingAt: '', expectedDeliveryDate: '2026-10-22' }),
        [], [],
      );
      expect(payload.plannedReturnAt).toBeNull();
      expect(payload.closingAt).toBeNull();
      expect(payload.expectedDeliveryDate).toBe('2026-10-22');
    });

    it('requires the datetime for create but accepts a stored EDD (legacy edit)', () => {
      const missing = getShipmentCreateReadiness(
        lclForm({ lclClosingAt: '', expectedDeliveryDate: '' }),
        [],
      );
      expect(missing.issues).toContainEqual(expect.objectContaining({
        fieldId: 'shipment-lcl-closing-at',
        message: 'Chọn ngày giờ đóng trả.',
      }));

      const legacy = getShipmentCreateReadiness(
        lclForm({ lclClosingAt: '', expectedDeliveryDate: '2026-10-22' }),
        [],
      );
      expect(legacy.issues.map((item) => item.fieldId)).not.toContain('shipment-lcl-closing-at');

      const dated = getShipmentCreateReadiness(lclForm(), []);
      expect(dated.dispatchReady).toBe(true);
      expect(dated.initialStatus).toBe('READY_FOR_DISPATCH');
    });
  });

  // SIL-642 (id 746, owner 31/10): the FCL band datetime is retired, so the
  // lot-level closingAt has no input anymore — the payload DERIVES it from
  // the earliest container appointment (the required NGÀY GIỜ ĐÓNG TRẢ
  // column), instead of persisting a band duplicate or wiping the column.
  describe('SIL-642 — FCL closingAt derives from the earliest container', () => {
    const fclForm = (overrides: Partial<ShipmentCreateFormState> = {}) => ({
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      cargoMode: 'FCL' as const,
      tradeDirection: 'IMPORT' as const,
      blNumber: 'BL-FCL-CLOSING',
      ...overrides,
    });
    const row = (appointment: string, key = 'row-1'): ShipmentContainerDraft => ({
      ...createEmptyContainer(),
      key,
      customerAppointmentAt: appointment,
    });

    it('mirrors the EARLIEST container appointment onto the lot closingAt', () => {
      const payload = buildShipmentRootPayload(
        fclForm(),
        [row('2026-10-30T09:00'), row('2026-10-29T14:30', 'row-2')],
        [],
      );
      expect(payload.closingAt).toBe('2026-10-29T14:30:00+07:00');
    });

    it('sends null when no FCL row carries a schedule (partial DRAFT save)', () => {
      const payload = buildShipmentRootPayload(fclForm(), [row(''), row('', 'row-2')], []);
      expect(payload.closingAt).toBeNull();
    });

    it('never derives an LCL lot closingAt from containers (SIL-587 law stands)', () => {
      const payload = buildShipmentRootPayload(
        fclForm({
          cargoMode: 'LCL',
          tradeDirection: 'EXPORT',
          bookingRef: 'BK-LCL',
          blNumber: '',
          routeId: '11',
          lclClosingAt: '2026-10-29T14:30',
        }),
        [row('2026-10-30T09:00')],
        [],
      );
      expect(payload.closingAt).toBe('2026-10-29T14:30:00+07:00');
    });

    it('keeps the LCL-IMPORT root closingAt untouched (null on create)', () => {
      const payload = buildShipmentRootPayload(
        fclForm({
          cargoMode: 'LCL',
          tradeDirection: 'IMPORT',
          routeId: '11',
          lclClosingAt: '2026-10-29T14:30',
        }),
        [row('2026-10-30T09:00')],
        [],
      );
      expect(payload.closingAt).toBeNull();
      expect(payload.plannedReturnAt).toBe('2026-10-29T14:30:00+07:00');
    });

    it('adds NO closingAt requirement for FCL and keeps the per-row appointment one', () => {
      const readiness = getShipmentCreateReadiness(fclForm(), [row(''), row('2026-10-30T09:00', 'row-2')]);
      expect(readiness.issues.map((item) => item.fieldId)).toContain('container-row-1-customer-appointment');
      expect(readiness.issues.map((item) => item.fieldId)).not.toContain('shipment-closing-at');
    });
  });

  // Helpdesk 2026-10-13 (ops Tiếp Vu): "hàng lẻ: phần thể tích (cbm) k bắt
  // buộc cần nhập" — CBM is optional on the LCL create path. A blank (or
  // whitespace-only) volume raises no validation issue and round-trips as
  // null, never 0. SIL-719 (id 839): an entered 0 is ALSO legal now — the
  // customer types 0 to mean "không có thể tích" and must be able to save
  // it; only a negative or malformed volume is an issue (the shared schema
  // owns that rule).
  it('treats LCL cargo volume (CBM) as optional and round-trips blank as null', () => {
    const lclWithoutCbm = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      cargoMode: 'LCL' as const,
      blNumber: 'BL-LCL-NO-CBM',
      tradeDirection: 'IMPORT' as const,
      cargoTypeId: '32',
      operationalSiteId: '41',
      pickupWarehouseSiteId: '42',
      packageType: 'Pallet',
      packageCount: '8',
      cargoWeightKg: '1200',
      cargoVolumeCbm: '',
      expectedDeliveryDate: '2026-08-14',
    };

    const readiness = getShipmentCreateReadiness(lclWithoutCbm, []);
    expect(readiness.issues).toEqual([]);
    expect(readiness.dispatchReady).toBe(true);
    expect(buildShipmentRootPayload(lclWithoutCbm, [], []).cargoVolumeCbm).toBeNull();

    // Whitespace-only is blank too — it must never reach the wire as a
    // string the backend would reject with 400 'Thể tích không hợp lệ.'.
    const whitespace = { ...lclWithoutCbm, cargoVolumeCbm: '   ' };
    expect(getShipmentCreateReadiness(whitespace, []).issues).toEqual([]);
    expect(buildShipmentRootPayload(whitespace, [], []).cargoVolumeCbm).toBeNull();
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
    // SIL-719 (id 839): the VOLUME is the one zero the customer may enter —
    // 0 CBM means "không có thể tích" and is legal (the shared contract
    // says "số không âm"). Số lượng kiện and trọng lượng still block at 0.
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
    ]);
    expect(buildShipmentRootPayload(form, [container], [{ id: 41, name: 'Nhà máy Long Minh' }])).toMatchObject({
      operationalSiteId: 41,
      factoryName: 'Nhà máy Long Minh',
      pickupWarehouseSiteId: 42,
    });
  });

  it('SIL-719 (id 839): CBM = 0 saves as a legal volume — only a negative one blocks', () => {
    // The customer types 0 to mean "không có thể tích" and must be able to
    // save the lot (the old "> 0" rule blocked it with "Nhập thể tích lớn
    // hơn 0."). The shared contract owns the rule: non-negative, and the
    // value reaches the wire unchanged so the API stores it.
    const base = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      routeId: '11',
      blNumber: 'BL-LCL-CBM-ZERO',
      tradeDirection: 'IMPORT' as const,
      cargoMode: 'LCL' as const,
      cargoTypeId: '32',
      operationalSiteId: '41',
      pickupWarehouseSiteId: '42',
      packageType: 'Pallet',
      packageCount: '10',
      cargoWeightKg: '5000',
      expectedDeliveryDate: '2026-08-14',
    };

    const zero = { ...base, cargoVolumeCbm: '0' };
    expect(getShipmentCreateReadiness(zero, []).issues).toEqual([]);
    expect(getShipmentCreateReadiness(zero, []).dispatchReady).toBe(true);
    expect(buildShipmentRootPayload(zero, [], []).cargoVolumeCbm).toBe('0');

    // A negative volume is still refused, and the message names the rule.
    const negative = { ...base, cargoVolumeCbm: '-1' };
    const negativeIssues = getShipmentCreateReadiness(negative, []).issues;
    expect(negativeIssues.map((item) => item.fieldId)).toEqual(['shipment-cargo-volume']);
    expect(negativeIssues[0]?.message).toMatch(/không âm/i);

    // A malformed value is refused too — the form never sends what the API
    // would answer with 400.
    const malformed = { ...base, cargoVolumeCbm: 'abc' };
    expect(getShipmentCreateReadiness(malformed, []).issues.map((item) => item.fieldId)).toEqual(['shipment-cargo-volume']);
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
// Card 261022093245: a shared-catalog kho belongs to ANOTHER customer — the
// payload builder must still resolve its display label from the sites list
// the caller passes (the workspace feeds the union of the customer's sites
// and the shared warehouse catalog), or pickup/delivery location would
// silently store null for a shared-kho pick.
describe('buildShipmentRootPayload — shared-catalog kho label resolution', () => {
  const sharedKhoForm = {
    ...EMPTY_SHIPMENT_CREATE_FORM,
    customerId: '25282',
    cargoMode: 'LCL' as const,
    tradeDirection: 'IMPORT' as const,
    routeId: '1',
    operationalSiteId: '3625',
    pickupWarehouseSiteId: '442',
    blNumber: 'BL-KHOCHUNG',
  };

  it('resolves pickup_location from a kho owned by another customer', () => {
    const payload = buildShipmentRootPayload(sharedKhoForm, [], [
      { id: 3625, name: 'Nhà máy Resolve', shortName: '' },
      { id: 442, name: 'ICD Hà Nội', shortName: 'ICD Hà Nội' },
    ]);
    expect(payload.pickupWarehouseSiteId).toBe(442);
    // Nhập khẩu: lấy tại Kho (CFS) giao tại Nhà máy.
    expect(payload.pickupLocation).toBe('ICD Hà Nội');
    expect(payload.deliveryLocation).toBe('Nhà máy Resolve');
  });

  it('resolves the label through the union even when the kho is NOT in the customer list alone', () => {
    // Only the customer's factory — the kho comes from the shared catalog.
    const customerOnly = [{ id: 3625, name: 'Nhà máy Resolve', shortName: '' }];
    const withShared = [...customerOnly, { id: 442, name: 'Kho ICD Hà Nội', shortName: 'ICD Hà Nội' }];
    const missing = buildShipmentRootPayload(sharedKhoForm, [], customerOnly);
    expect(missing.pickupLocation).toBeNull(); // documents why the union is required
    const resolved = buildShipmentRootPayload(sharedKhoForm, [], withShared);
    expect(resolved.pickupLocation).toBe('ICD Hà Nội');
  });
});

// SIL-660 (owner ruling 02/11): hàng lẻ được nhập Số tờ khai CẤP LÔ — bản
// hẹp hóa của máy declaration pre-SIL-521, chỉ cho LCL (SIL-601: lẻ = 1 lô
// 1 cont). Giá trị persist vào entity `shipment_declarations` qua
// POST/PUT /shipments/:id/declarations; root payload vẫn KHÔNG mang
// declarationNumber (SIL-521 giữ nguyên cho FCL — per-cont là luật).
describe('SIL-660 — buildShipmentDeclarationPayload (LCL-only tờ khai cấp lô)', () => {
  it('LCL: số đã nhập → { declarationNumber } (trim) cho entity declarations', () => {
    const form: ShipmentCreateFormState = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      cargoMode: 'LCL',
      declarationNumber: '  TK-660-001 ',
    };
    expect(buildShipmentDeclarationPayload(form)).toEqual({ declarationNumber: 'TK-660-001' });
  });

  it('LCL: để trống → { declarationNumber: null } (clear giá trị đã lưu)', () => {
    const form: ShipmentCreateFormState = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      cargoMode: 'LCL',
      declarationNumber: '   ',
    };
    expect(buildShipmentDeclarationPayload(form)).toEqual({ declarationNumber: null });
  });

  it('FCL → null: per-cont giữ luật SIL-600, workflow không đụng entity declarations', () => {
    const form: ShipmentCreateFormState = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      cargoMode: 'FCL',
      declarationNumber: 'TK-LEAK',
    };
    expect(buildShipmentDeclarationPayload(form)).toBeNull();
  });
});
