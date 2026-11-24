// SIL-945 (KB Ch.3 §3.1.7 / Ch.10 §10.1.4) — the three freight column groups
// ride the lot-detail DRAWER's container lines too, not just the workboard's
// flat rows. The durable guard stays pinned at the shared-schema boundary
// (BE tests are unit-only; the db behavior stays with the qa/scripts
// integration probes): shipmentCusWorkspaceContainerLineSchema must carry an
// OPTIONAL freightGroups so producers that predate the field keep parsing,
// and the group shape must be the exact one the drawer renders ('—' for a
// missing/null cell, never a fabricated 0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shipmentCusWorkspaceContainerLineSchema,
  shipmentCusWorkspaceDetailSchema,
} from '@tingting/shared';

const directField = { mode: 'DIRECT' as const, reason: 'writable' };

function minimalLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 21,
    ordinal: 1,
    operationalSiteId: null,
    containerNumber: 'RTAU8980080',
    declarationNumber: null,
    containerTypeId: 3,
    containerTypeLabel: '40HC',
    routeId: null,
    routeName: null,
    dispatchStatus: 'AWAITING_VEHICLE',
    tripId: 5,
    tripStatus: null,
    tripDepartureDate: null,
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
    raw: { containerNumber: 'RTAU8980080', containerTypeId: 3, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null },
    fieldAccess: {
      operationalSiteId: directField, containerNumber: directField, containerTypeId: directField,
      cargoWeightKg: directField, cargoVolumeCbm: directField, routeId: directField,
      carrierType: directField, externalCarrierId: directField, externalCarrierVehicleId: directField,
      plateNumber: directField, liftSiteId: directField, dropoffSiteId: directField,
      customerAppointmentAt: directField,
    },
    permissions: {
      carrierEditable: false, plateEditable: false, containerTypeEditable: false,
      routeEditable: false, liftSiteEditable: false, dropoffSiteEditable: false,
      customerAppointmentEditable: false,
    },
    shipmentVersion: 1,
    relatedTripVersion: null,
    ...overrides,
  };
}

test('the drawer container line parses WITH the freight groups (SIL-945)', () => {
  const parsed = shipmentCusWorkspaceContainerLineSchema.parse(minimalLine({
    freightGroups: {
      outbound: {
        transport: { amount: '3952000', invoiceNumbers: ['HD-1'] },
        handling: { amount: null },
        incidental: { amount: null },
        total: '3952000',
      },
      inbound: {
        transport: { amount: null },
        handling: { amount: null },
        incidental: { amount: null },
        total: null,
      },
      chiHo: {
        csht: { amount: '300000', invoiceNumbers: ['HD-C1'] },
        lift: { amount: null },
        drop: { amount: null },
        other: { amount: null },
      },
    },
  }));
  assert.equal(parsed.freightGroups?.outbound.transport.amount, '3952000');
  assert.deepEqual(parsed.freightGroups?.outbound.transport.invoiceNumbers, ['HD-1']);
  assert.equal(parsed.freightGroups?.chiHo.csht.amount, '300000');
  assert.equal(parsed.freightGroups?.inbound.total, null);
});

test('freightGroups stays OPTIONAL — a pre-SIL-945 line keeps parsing, absent renders — (never a 0)', () => {
  const parsed = shipmentCusWorkspaceContainerLineSchema.parse(minimalLine());
  assert.equal(parsed.freightGroups, undefined);
});

test('the drawer detail rides the same container-line contract', () => {
  assert.equal(shipmentCusWorkspaceDetailSchema.shape.containers.element, shipmentCusWorkspaceContainerLineSchema);
});
