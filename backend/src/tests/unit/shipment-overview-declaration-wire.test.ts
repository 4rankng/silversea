// SIL-502 (spec comment 1886) as amended by SIL-521 (owner 26/10): "tạo lô
// có tờ khai → Tổng quan vẫn hiện 'Chưa có tờ khai'" was fixed by keeping the
// READ wire intact; the WRITE half is now REVERSED — tờ khai is per-cont only,
// so quick-create must NO LONGER accept a lot-level declarationNumber while
// containers still ride the combined save. The durable guard stays pinned at
// the shared-schema boundary: the quick-create key list must have dropped
// declarationNumber, and the CUS list/summary item must keep carrying
// declarationNumber plus the declarationNumbers array — the exact keys the
// Chứng từ column join and the drawer's "Số tờ khai (N)" count read (legacy
// lots keep rendering). The DB behavior itself stays with the qa/scripts
// integration probes (BE tests are unit-only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_CREATE_SHIPMENT_KEYS,
  shipmentCusWorkspaceListItemSchema,
  shipmentCusWorkspaceDetailSchema,
  ShipmentCusBucket,
  ShipmentStatus,
} from '@tingting/shared';

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

function minimalListItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    version: 1,
    status: ShipmentStatus.PENDING_DATE,
    cargoMode: 'FCL',
    bucket: ShipmentCusBucket.NEW,
    bucketLabel: 'Mới tạo',
    customerName: 'Công ty A',
    factoryName: null,
    effectiveFactoryNames: [],
    billOrBookNumber: 'BL12345',
    declarationNumber: null,
    shippingLineName: null,
    routeName: null,
    isCombined: false,
    direction: 'IMPORT',
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
      billingDocumentId: null,
      documentNumber: null,
      issuedAt: null,
      debitNoteStatus: null,
      disabledReason: null,
    },
    documentCustody: { status: null, label: null, available: false, editable: false },
    accountingConfirmation: {
      status: 'PENDING',
      confirmationId: null,
      checksum: null,
      billingDocumentId: null,
      confirmedAt: null,
      confirmedByName: null,
    },
    activeLock: null,
    action: { kind: 'NONE', label: '—', enabled: false, disabledReason: null },
    ...overrides,
  };
}

test('quick-create no longer takes a lot-level declarationNumber; containers still ride combined save (SIL-521)', () => {
  // SIL-521: tờ khai hết nhập cấp lô — key list phải đã drop declarationNumber
  // để assertKnownShipmentKeys chặn; containers vẫn đi combined save.
  const extra = QUICK_CREATE_SHIPMENT_KEYS.filter((key) => key === 'declarationNumber');
  assert.deepEqual(extra, []);
  assert.equal(QUICK_CREATE_SHIPMENT_KEYS.includes('containers'), true);
});

test('CUS list item carries the declaration numbers the Chứng từ column joins', () => {
  const parsed = shipmentCusWorkspaceListItemSchema.parse(minimalListItem({
    declarationNumber: '502-TK-2026',
    declarationNumbers: ['502-TK-2026', '502-TK-2027'],
  }));
  assert.deepEqual(parsed.declarationNumbers, ['502-TK-2026', '502-TK-2027']);
});

test('declarationNumbers stays optional with declarationNumber as the fallback source', () => {
  const parsed = shipmentCusWorkspaceListItemSchema.parse(minimalListItem({
    declarationNumber: '502-TK-LEGACY',
  }));
  assert.equal(parsed.declarationNumbers, undefined);
  assert.equal(parsed.declarationNumber, '502-TK-LEGACY');
});

test('the drawer summary rides the same item contract as the workboard row', () => {
  // One schema identity — the drawer's "Số tờ khai (N)" and the workboard
  // column can never read two different declaration sources.
  assert.equal(shipmentCusWorkspaceDetailSchema.shape.summary, shipmentCusWorkspaceListItemSchema);
});
