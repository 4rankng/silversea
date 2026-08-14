import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  shipmentCusContainerLineUpdateSchema,
  shipmentCusWorkspaceListItemSchema,
  shipmentCusWorkspaceQuerySchema,
} from './cus-shipment-workspace';
import {
  ShipmentCusBucket,
  ShipmentDocumentCustody,
} from '../constants';

test('CUS workspace query accepts 4-5 alphanumeric suffix search', () => {
  assert.equal(shipmentCusWorkspaceQuerySchema.safeParse({
    searchSuffix: 'aB12C',
    transportDateFrom: '2026-08-01',
    transportDateTo: '2026-08-11',
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

test('CUS workspace list item supports explicit unavailable custody state', () => {
  assert.equal(shipmentCusWorkspaceListItemSchema.safeParse({
    id: 1,
    version: 2,
    bucket: ShipmentCusBucket.PENDING_LOCK,
    bucketLabel: 'Chờ khóa',
    customerName: 'Công ty A',
    factoryName: 'Nhà máy A',
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
    carrierAssignments: [{ carrierName: 'Nhà xe An Phát', plateNumber: '15C-123.45' }],
    note: null,
    operational: {
      scheduleReadiness: 'SCHEDULED',
      vehicleReadiness: 'WAITING_PLATE',
      totalContainers: 1,
      assignedContainers: 1,
      externalContainers: 1,
      plateAssignedContainers: 0,
      missingCarrierContainers: 0,
      missingPlateContainers: 1,
      transportDateEditable: true,
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
    bucket: ShipmentCusBucket.PENDING_LOCK,
    bucketLabel: 'Chờ khóa',
    customerName: null,
    factoryName: null,
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
    carrierAssignments: [],
    note: null,
    operational: {
      scheduleReadiness: 'WAITING_DATE',
      vehicleReadiness: 'NO_CONTAINERS',
      totalContainers: 0,
      assignedContainers: 0,
      externalContainers: 0,
      plateAssignedContainers: 0,
      missingCarrierContainers: 0,
      missingPlateContainers: 0,
      transportDateEditable: true,
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
