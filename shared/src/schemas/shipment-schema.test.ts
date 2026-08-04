import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createShipmentSchema, updateShipmentSchema } from './index';

test('shipment schemas accept canonical calendar dates', () => {
  assert.equal(createShipmentSchema.safeParse({
    customerId: 1,
    expectedDeliveryDate: '2026-08-04',
  }).success, true);
  assert.equal(updateShipmentSchema.safeParse({
    expectedVersion: 1,
    expectedDeliveryDate: '2026-08-04',
  }).success, true);
});

test('shipment schemas reject malformed and impossible delivery dates', () => {
  for (const expectedDeliveryDate of ['04/08/2026', '2026-8-4', '2026-02-30', '2026-13-01']) {
    assert.equal(createShipmentSchema.safeParse({
      customerId: 1,
      expectedDeliveryDate,
    }).success, false);
    assert.equal(updateShipmentSchema.safeParse({
      expectedVersion: 1,
      expectedDeliveryDate,
    }).success, false);
  }
});

test('shipment schemas preserve nullable delivery-date compatibility', () => {
  assert.equal(createShipmentSchema.safeParse({ customerId: 1, expectedDeliveryDate: null }).success, true);
  assert.equal(updateShipmentSchema.safeParse({ expectedVersion: 1, expectedDeliveryDate: null }).success, true);
});
