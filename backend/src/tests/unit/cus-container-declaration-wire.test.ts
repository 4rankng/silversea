// Card 261013200312 (dev-lead ruling): per-container tờ khai wire contract —
// the container-line command's declarationNumber field and the copy command's
// request/result shapes, pinned at the shared-schema boundary so the FE editor
// and the BE writer can never drift apart silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shipmentCusContainerLineUpdateSchema,
  shipmentCusContainerDeclarationCopySchema,
  shipmentCusContainerDeclarationCopyResultSchema,
  shipmentCusWorkspaceContainerLineSchema,
} from '@tingting/shared';

test('container-line update accepts a trimmed per-cont declaration number', () => {
  const parsed = shipmentCusContainerLineUpdateSchema.parse({
    expectedShipmentVersion: 3,
    declarationNumber: '  TK-0000042  ',
  });
  assert.equal(parsed.declarationNumber, 'TK-0000042');
});

test('container-line update treats null as a clear and absence as untouched', () => {
  assert.equal(shipmentCusContainerLineUpdateSchema.parse({
    expectedShipmentVersion: 3,
    declarationNumber: null,
  }).declarationNumber, null);
  assert.equal(shipmentCusContainerLineUpdateSchema.parse({
    expectedShipmentVersion: 3,
  }).declarationNumber, undefined);
});

test('container-line update rejects an over-length number with the field label', () => {
  const result = shipmentCusContainerLineUpdateSchema.safeParse({
    expectedShipmentVersion: 3,
    declarationNumber: 'X'.repeat(51),
  });
  assert.equal(result.success, false);
  assert.ok(!result.success && result.error.issues[0].message.includes('Số tờ khai'));
});

test('the declaration copy command carries only the optimistic version', () => {
  assert.deepEqual(shipmentCusContainerDeclarationCopySchema.parse({
    expectedShipmentVersion: 7,
  }), { expectedShipmentVersion: 7 });
  assert.equal(shipmentCusContainerDeclarationCopySchema.safeParse({}).success, false);
});

test('the copy result reports exactly the written container ids and the new version', () => {
  const result = shipmentCusContainerDeclarationCopyResultSchema.parse({
    updatedContainerIds: [12, 13],
    shipmentVersion: 8,
  });
  assert.deepEqual(result.updatedContainerIds, [12, 13]);
  assert.equal(result.shipmentVersion, 8);
  // The written ids are real container ids — never the source, never a dup.
  assert.equal(new Set(result.updatedContainerIds).size, result.updatedContainerIds.length);
});

test('the workspace container line carries the per-cont number for sibling counting', () => {
  const direct = { mode: 'DIRECT' as const, reason: 'trường kiểm thử' };
  const line = shipmentCusWorkspaceContainerLineSchema.parse({
    id: 11,
    ordinal: 1,
    operationalSiteId: null,
    containerNumber: 'MSKU1234567',
    declarationNumber: 'TK-SHARED-1',
    containerTypeId: null,
    containerTypeLabel: null,
    routeId: null,
    routeName: null,
    dispatchStatus: 'AWAITING_VEHICLE',
    tripId: null,
    tripStatus: null,
    carrierType: null,
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    carrierName: null,
    plateNumber: null,
    liftSiteId: null,
    liftSite: null,
    dropoffSiteId: null,
    dropoffSite: null,
    customerAppointmentAt: null,
    raw: { containerNumber: 'MSKU1234567', containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null },
    fieldAccess: Object.fromEntries([
      'operationalSiteId', 'containerNumber', 'containerTypeId', 'cargoWeightKg', 'cargoVolumeCbm', 'routeId',
      'carrierType', 'externalCarrierId', 'externalCarrierVehicleId', 'plateNumber', 'liftSiteId', 'dropoffSiteId', 'customerAppointmentAt',
    ].map((key) => [key, direct])),
    permissions: Object.fromEntries([
      'carrierEditable', 'plateEditable', 'containerTypeEditable', 'routeEditable',
      'liftSiteEditable', 'dropoffSiteEditable', 'customerAppointmentEditable',
    ].map((key) => [key, true])),
    shipmentVersion: 2,
    relatedTripVersion: null,
  });
  assert.equal(line.declarationNumber, 'TK-SHARED-1');
});
