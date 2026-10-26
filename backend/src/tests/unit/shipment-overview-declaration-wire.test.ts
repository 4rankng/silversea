// SIL-502 (spec comment 1886): "tạo lô có tờ khai → Tổng quan vẫn hiện
// 'Chưa có tờ khai'". Local repro on trunk proved the DB wire intact
// (shipment_declarations row + container fan-out on create, list/detail
// union read, workboard render), so the durable guard is the CONTRACT both
// ends share, pinned at the shared-schema boundary where no refactor can
// silently drift it: the quick-create schema must keep accepting
// declarationNumber next to containers (combined save), and the CUS
// list/summary item must keep carrying declarationNumber plus the
// declarationNumbers array — the exact keys the Chứng từ column join and
// the drawer's "Số tờ khai (N)" count read. The DB behavior itself stays
// with the qa/scripts integration probes (BE tests are unit-only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quickCreateShipmentSchema,
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

test('quick-create keeps accepting declarationNumber beside containers (combined save)', () => {
  // The trim/max pin alone lives in shared/src/schemas/shipment-schema.test.ts;
  // this case adds the combined-save half: containers ride beside the number.
  const parsed = quickCreateShipmentSchema.parse({
    customerId: 1,
    declarationNumber: '  502-TK-2026  ',
    containers: [{ containerNumber: 'SILU5001013', containerTypeId: 1 }],
  });
  assert.equal(parsed.declarationNumber, '502-TK-2026');
  assert.equal(parsed.containers?.length, 1);
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
