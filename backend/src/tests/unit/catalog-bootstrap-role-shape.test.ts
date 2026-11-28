// Unit tests — bootstrapForRole decision table (SIL-1266, id 1548).
// Pure shape policy: no db, no app bootstrap — the blob argument is a fixture.
//
// Regression: GET /catalogs/bootstrap stripped OPS into the portal subset
// (FORWARDER-era policy kept through the FORWARDER→OPS rename), so the
// /shipments/:id review workspace (SIL-481 view mode) rendered with an empty
// customer catalog and surfaced the create form's "Chưa có khách hàng"
// precondition on the detail route. OPS is internal staff with shipment-read
// across every lot (`p, OPS, shipments, read`) and reads the FULL catalog;
// only DRIVER keeps the portal subset.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootstrapForRole } from '../../services/config.service';
import { Role } from '@tingting/shared';

/** Minimal stand-in for the getBootstrapData blob — the keys the strip list
 *  owns plus a kept key, enough to pin the shape decision. */
function blob() {
  return {
    customers: [{ id: 1, name: 'KH A' }],
    externalCarriers: [{ id: 2, name: 'Nhà xe B' }],
    trucks: [{ id: 3, licensePlate: '51A-123.45' }],
    drivers: [{ id: 4, name: 'Lái D' }],
    routes: [{ id: 5, name: 'Tuyến E' }],
    cargoTypes: [{ id: 6, name: 'Hàng FCL' }],
    expenseCategories: [{ id: 7, name: 'Cầu đường' }],
    suppliers: [{ id: 8, name: 'Hãng tàu G' }],
    trailers: [{ id: 9, licensePlate: '51H-678.90' }],
    // Kept by the portal subset — must survive the strip by reference.
    containerTypes: [{ id: 10, code: '40HC', name: '40 High Cube' }],
    ports: [{ id: 11, name: 'Cảng Cát Lái' }],
    forwarderExpenseTypes: [{ id: 12, code: 'CAU_DUONG', name: 'Cầu đường' }],
  };
}

const STRIPPED_KEYS = [
  'customers',
  'externalCarriers',
  'trucks',
  'drivers',
  'routes',
  'cargoTypes',
  'expenseCategories',
  'suppliers',
  'trailers',
] as const;

test('DRIVER keeps the portal subset — operational catalogs strip to []', () => {
  const data = blob();
  const result = bootstrapForRole(data, Role.DRIVER);
  for (const key of STRIPPED_KEYS) {
    assert.deepEqual(result[key], [], `${key} must be an empty array for DRIVER`);
  }
  assert.deepEqual(result.containerTypes, data.containerTypes);
  assert.deepEqual(result.ports, data.ports);
  assert.deepEqual(result.forwarderExpenseTypes, data.forwarderExpenseTypes);
});

test('OPS reads the FULL catalog — no strip, same blob reference', () => {
  const data = blob();
  const result = bootstrapForRole(data, Role.OPS);
  assert.equal(result, data, 'OPS bootstrap must be the unstripped blob itself');
  assert.equal(result.customers.length, 1);
});

test('staff roles (ADMIN, CUS, DISPATCHER, MANAGER, ACCOUNTANT) read the full catalog', () => {
  for (const role of [Role.ADMIN, Role.CUS, Role.DISPATCHER, Role.MANAGER, Role.ACCOUNTANT]) {
    const data = blob();
    const result = bootstrapForRole(data, role);
    assert.equal(result, data, `${role} bootstrap must be the unstripped blob itself`);
  }
});
