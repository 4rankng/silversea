import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createShipmentSchema, quickCreateShipmentSchema, updateShipmentSchema } from './index';

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

test('shipment schemas carry the explicit consolidation flag', () => {
  const created = createShipmentSchema.parse({ customerId: 1, isCombined: true });
  assert.equal(created.isCombined, true);
  const updated = updateShipmentSchema.parse({ expectedVersion: 1, isCombined: false });
  assert.equal(updated.isCombined, false);
});

test('shipment write schemas accept recipient-specific driver notes', () => {
  const created = createShipmentSchema.parse({ customerId: 1, driverNotes: 'Gọi trước khi vào cổng' });
  const updated = updateShipmentSchema.parse({ expectedVersion: 1, driverNotes: null });

  assert.equal(created.driverNotes, 'Gọi trước khi vào cổng');
  assert.equal(updated.driverNotes, null);
});

test('shipment schemas reject a Bill and Booking on the same shipment', () => {
  assert.equal(createShipmentSchema.safeParse({
    customerId: 1,
    tradeDirection: 'IMPORT',
    blNumber: 'BL-IMPORT-01',
    bookingRef: 'BOOK-EXPORT-01',
  }).success, false);
  assert.equal(updateShipmentSchema.safeParse({
    expectedVersion: 1,
    tradeDirection: 'EXPORT',
    blNumber: 'BL-IMPORT-01',
    bookingRef: 'BOOK-EXPORT-01',
  }).success, false);
});

test('VID-CUS-04: quick intake accepts an initial declaration with the declaration length limit', () => {
  const parsed = quickCreateShipmentSchema.parse({ customerId: 1, declarationNumber: '  TK-01  ' });
  assert.equal(parsed.declarationNumber, 'TK-01');
  assert.equal(quickCreateShipmentSchema.safeParse({ customerId: 1, declarationNumber: 'A'.repeat(51) }).success, false);
});
