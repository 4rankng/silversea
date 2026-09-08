import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  shipmentCusContainerLineUpdateSchema,
  shipmentCusContainerQuerySchema,
  shipmentCusWorkspaceListItemSchema,
  shipmentCusWorkspaceQuerySchema,
  SHIPMENT_CUS_MISSING_FIELD_LABELS,
} from './cus-shipment-workspace';
import {
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  ShipmentStatus,
} from '../constants';

const directField = { mode: 'DIRECT' as const, reason: 'Bạn có thể cập nhật trực tiếp trường này.' };
const workspaceRaw = {
  customerId: 1, factoryName: null, routeId: null, deliveryLocation: null,
  blNumber: null, bookingRef: null, declarationNumber: null, tradeDirection: null,
  shippingLineName: null, packageCount: null, packageType: null, cargoWeightKg: null,
  cargoVolumeCbm: null, customsCutoffAt: null, closingAt: null, plannedReturnAt: null,
  customerNotes: null, operationalNotes: null, declarationId: null,
  declarationIssuedAt: null, declarationScope: null, declarationNote: null,
  isAdHoc: false,
};
const workspaceFieldAccess = {
  customerId: directField, factoryName: directField, routeId: directField,
  deliveryLocation: directField, blNumber: directField, bookingRef: directField,
  declarationNumber: directField, tradeDirection: directField, shippingLineName: directField,
  packageCount: directField, packageType: directField, cargoWeightKg: directField,
  cargoVolumeCbm: directField, customsCutoffAt: directField, closingAt: directField,
  plannedReturnAt: directField, customerNotes: directField, operationalNotes: directField,
};

test('CUS workspace query accepts 4-5 alphanumeric suffix search', () => {
  assert.equal(shipmentCusWorkspaceQuerySchema.safeParse({
    searchSuffix: 'aB12C',
    transportDateFrom: '2026-08-01',
    transportDateTo: '2026-08-11',
    customerId: 7,
    direction: 'IMPORT',
    bucket: ShipmentCusBucket.RUNNING,
  }).success, true);
});

test('CUS workspace query rejects invalid suffix search', () => {
  for (const suffix of ['A12', 'ABC123', 'AB$1']) {
    const result = shipmentCusWorkspaceQuerySchema.safeParse({ searchSuffix: suffix });
    assert.equal(result.success, false, `${suffix} must fail`);
    assert.match(result.error.issues[0]?.message ?? '', /4-5 ký tự chữ hoặc số/i);
  }
});

test('overview query rejects the detail-only informationStatus parameter', () => {
  const result = shipmentCusWorkspaceQuerySchema.safeParse({ informationStatus: 'MISSING' });
  assert.equal(result.success, false);
});

test('container query accepts informationStatus=MISSING and defaults are shared', () => {
  const result = shipmentCusContainerQuerySchema.safeParse({ informationStatus: 'MISSING' });
  assert.equal(result.success, true);
  assert.equal(result.data?.page, 1);
  assert.equal(result.data?.limit, 20);
});

test('container query rejects unknown informationStatus values', () => {
  for (const value of ['COMPLETE', 'missing', 'ALL', '']) {
    const result = shipmentCusContainerQuerySchema.safeParse({ informationStatus: value });
    assert.equal(result.success, false, `${value} must fail`);
  }
});

test('container query keeps the shared transport-date order refinement', () => {
  const result = shipmentCusContainerQuerySchema.safeParse({
    informationStatus: 'MISSING',
    transportDateFrom: '2026-08-10',
    transportDateTo: '2026-08-01',
  });
  assert.equal(result.success, false);
  assert.equal(result.error?.issues[0]?.path[0], 'transportDateTo');
});

test('every missing-field code has a non-empty Vietnamese label', () => {
  for (const label of Object.values(SHIPMENT_CUS_MISSING_FIELD_LABELS)) {
    assert.equal(typeof label, 'string');
    assert.ok(label.length > 0);
  }
});

test('CUS workspace list item supports explicit unavailable custody state', () => {
  assert.equal(shipmentCusWorkspaceListItemSchema.safeParse({
    id: 1,
    version: 2,
    status: ShipmentStatus.READY_FOR_DISPATCH,
    cargoMode: 'FCL',
    bucket: ShipmentCusBucket.PENDING_LOCK,
    bucketLabel: 'Chờ khóa',
    customerName: 'Công ty A',
    factoryName: 'Nhà máy A',
    effectiveFactoryNames: ['Nhà máy A'],
    billOrBookNumber: 'BL12345',
    declarationNumber: null,
    shippingLineName: 'Maersk',
    routeName: 'Hải Phòng - Hà Nội',
    isCombined: false,
    direction: 'IMPORT',
    containerSummary: '1x40HC',
    packageCount: null,
    packageType: null,
    weightKg: '12500.00',
    volumeCbm: '32.500',
    transportDate: '2026-08-11',
    customsCutoffAt: '2026-08-10T08:00:00.000Z',
    closingAt: '2026-08-11T03:00:00.000Z',
    plannedReturnAt: null,
    deliveryLocation: 'Kho Hà Nội',
    liftSiteNames: ['Cảng Đình Vũ'],
    dropoffSiteNames: ['Bãi Tân Vũ'],
    customerAppointmentAts: ['2026-08-11T02:00:00.000Z'],
    appointmentGroups: [{ at: '2026-08-11T02:00:00.000Z', localDate: '2026-08-11', factoryName: 'Nhà máy A', factoryShortName: 'Nhà máy A', factoryFullName: 'Nhà máy A', containerSummary: '1x40HC' }],
    carrierAssignments: [{ carrierName: 'Nhà xe An Phát', plateNumber: '15C-123.45' }],
    customerNotes: null,
    operationalNotes: null,
    raw: { ...workspaceRaw, customerId: 1, factoryName: 'Nhà máy A', blNumber: 'BL12345', declarationNumber: null, tradeDirection: 'IMPORT', shippingLineName: 'Maersk', cargoWeightKg: '12500.00', cargoVolumeCbm: '32.500', customsCutoffAt: '2026-08-10T08:00:00.000Z', closingAt: '2026-08-11T03:00:00.000Z', deliveryLocation: 'Kho Hà Nội' },
    fieldAccess: workspaceFieldAccess,
    operational: {
      scheduleReadiness: 'SCHEDULED',
      vehicleReadiness: 'WAITING_PLATE',
      totalContainers: 1,
      assignedContainers: 1,
      externalContainers: 1,
      plateAssignedContainers: 0,
      missingCarrierContainers: 0,
      missingPlateContainers: 1,
      orderIssuedContainers: 0,
      transportDateEditable: true,
      deletable: true,
    },
    finance: {
      customerInvoiceTotal: null,
      customerNoInvoiceTotal: null,
      totalCost: '900000',
      isLoss: null,
      hasPendingRecovery: true,
      customerChargeTotalsAvailable: false,
      totalCostAvailable: true,
      customerTotalsAuthority: 'UNAVAILABLE',
    },
    debitNote: {
      available: false,
      billingDocumentId: null,
      documentNumber: null,
      issuedAt: null,
      debitNoteStatus: null,
      disabledReason: 'Chưa có Debit Note hiện hành đủ điều kiện.',
    },
    documentCustody: {
      status: ShipmentDocumentCustody.SUBMITTED_TO_ACCOUNTING,
      label: 'Đã nộp Kế toán',
      available: true,
      editable: false,
    },
    accountingConfirmation: {
      status: 'PENDING',
      confirmationId: null,
      checksum: null,
      billingDocumentId: null,
      confirmedAt: null,
      confirmedByName: null,
    },
    activeLock: null,
    action: {
      kind: 'LOCK',
      label: 'Khóa lô',
      enabled: false,
      disabledReason: 'Chờ xác nhận',
    },
  }).success, true);
});

test('CUS accounting confirmation response includes the Debit Note identity', () => {
  const parsed = shipmentCusWorkspaceListItemSchema.safeParse({
    id: 1,
    version: 1,
    status: ShipmentStatus.PENDING_DATE,
    cargoMode: null,
    bucket: ShipmentCusBucket.PENDING_LOCK,
    bucketLabel: 'Chờ khóa',
    customerName: null,
    factoryName: null,
    effectiveFactoryNames: [],
    billOrBookNumber: null,
    declarationNumber: null,
    shippingLineName: null,
    routeName: null,
    isCombined: false,
    direction: null,
    containerSummary: '',
    packageCount: null,
    packageType: null,
    weightKg: null,
    volumeCbm: null,
    transportDate: null,
    customsCutoffAt: null,
    closingAt: null,
    plannedReturnAt: null,
    deliveryLocation: null,
    liftSiteNames: [],
    dropoffSiteNames: [],
    customerAppointmentAts: [],
    appointmentGroups: [],
    carrierAssignments: [],
    customerNotes: null,
    operationalNotes: null,
    raw: workspaceRaw,
    fieldAccess: workspaceFieldAccess,
    operational: {
      scheduleReadiness: 'WAITING_DATE',
      vehicleReadiness: 'NO_CONTAINERS',
      totalContainers: 0,
      assignedContainers: 0,
      externalContainers: 0,
      plateAssignedContainers: 0,
      missingCarrierContainers: 0,
      missingPlateContainers: 0,
      orderIssuedContainers: 0,
      transportDateEditable: true,
      deletable: true,
    },
    finance: {
      customerInvoiceTotal: null,
      customerNoInvoiceTotal: null,
      totalCost: null,
      isLoss: null,
      hasPendingRecovery: false,
      customerChargeTotalsAvailable: false,
      totalCostAvailable: false,
      customerTotalsAuthority: 'UNAVAILABLE',
    },
    debitNote: {
      available: true,
      billingDocumentId: 42,
      documentNumber: 'Debit Note #42',
      issuedAt: '2026-08-12T00:00:00.000Z',
      debitNoteStatus: 'SENT',
      disabledReason: null,
    },
    documentCustody: { status: null, label: null, available: false, editable: false },
    accountingConfirmation: {
      status: 'CONFIRMED',
      confirmationId: 9,
      checksum: 'checksum',
      billingDocumentId: 42,
      confirmedAt: '2026-08-12T00:00:00.000Z',
      confirmedByName: 'Kế toán',
    },
    activeLock: null,
    action: { kind: 'NONE', label: 'Đã xác nhận', enabled: false, disabledReason: null },
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.accountingConfirmation.billingDocumentId, 42);
});

test('CUS container-line update accepts inline new external carrier input', () => {
  assert.equal(shipmentCusContainerLineUpdateSchema.safeParse({
    expectedShipmentVersion: 3,
    carrierType: 'EXTERNAL',
    newExternalCarrier: {
      name: 'Nhà xe Minh Phát',
      plateNumber: '51H-123.45',
    },
  }).success, true);
});

test('CUS container-line update accepts a container-specific customer appointment', () => {
  const appointment = '2026-08-14T03:30:00.000Z';
  const parsed = shipmentCusContainerLineUpdateSchema.safeParse({
    expectedShipmentVersion: 3,
    customerAppointmentAt: appointment,
  });

  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.customerAppointmentAt, appointment);
  assert.equal(shipmentCusContainerLineUpdateSchema.safeParse({
    expectedShipmentVersion: 3,
    closeOrReturnAt: appointment,
  }).success, false);
});

// The ledger's schedule editor sends Vietnam-offset ISO (localDateTimeToIso),
// not a Z instant. Bare `.datetime()` rejected it and leaked the raw Zod
// message "Invalid datetime (customerAppointmentAt)" into the CUS dialog.
test('CUS container-line update accepts the +07:00 offset appointment the ledger editor sends', () => {
  const parsed = shipmentCusContainerLineUpdateSchema.safeParse({
    expectedShipmentVersion: 3,
    customerAppointmentAt: '2026-09-08T08:00:00+07:00',
  });

  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.customerAppointmentAt, '2026-09-08T08:00:00+07:00');
});

test('CUS container-line update rejects a malformed appointment with a Vietnamese message', () => {
  const parsed = shipmentCusContainerLineUpdateSchema.safeParse({
    expectedShipmentVersion: 3,
    customerAppointmentAt: '08/09/2026 08:00',
  });

  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.equal(parsed.error.errors[0]?.message, 'Ngày giờ đóng/trả hàng không hợp lệ.');
  }
});

test('CUS container-line update accepts only normalized container identity and cargo fields', () => {
  const parsed = shipmentCusContainerLineUpdateSchema.safeParse({
    expectedShipmentVersion: 3,
    containerNumber: 'MSCU6639870',
    cargoWeightKg: '1200.5',
    cargoVolumeCbm: '21.4',
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.cargoWeightKg, '1200.50');
    assert.equal(parsed.data.cargoVolumeCbm, '21.400');
  }
});

test('CUS container-line update rejects every finance field at the strict operational boundary', () => {
  for (const financeInput of [
    { outboundCharges: { transportAmount: '1200000' } },
    { inboundCharges: { handlingAmount: '45000' } },
    { expectedFactVersion: 0 },
  ]) {
    assert.equal(shipmentCusContainerLineUpdateSchema.safeParse({
      expectedShipmentVersion: 3,
      ...financeInput,
    }).success, false);
  }
});

test('CUS container-line update rejects mixed existing and new external carrier input', () => {
  const result = shipmentCusContainerLineUpdateSchema.safeParse({
    expectedShipmentVersion: 3,
    carrierType: 'EXTERNAL',
    externalCarrierId: 88,
    newExternalCarrier: {
      name: 'Nhà xe Minh Phát',
      plateNumber: '51H-123.45',
    },
  });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0]?.message ?? '', /không được gửi đồng thời/i);
});

test('CUS container-line update rejects inline external carrier for OWN carrier type', () => {
  const result = shipmentCusContainerLineUpdateSchema.safeParse({
    expectedShipmentVersion: 3,
    carrierType: 'OWN',
    newExternalCarrier: {
      name: 'Nhà xe Minh Phát',
      plateNumber: '51H-123.45',
    },
  });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0]?.message ?? '', /chỉ dùng khi loại nhà xe là EXTERNAL/i);
});
