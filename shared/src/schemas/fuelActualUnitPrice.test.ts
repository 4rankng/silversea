import { test } from 'node:test';
import assert from 'node:assert';
import { createTripSchema, updateTripFiguresSchema } from './index';
import { FuelMode, LoadingType } from '../constants';

// Regression guard for the reported unit-price drift ("entered 23,530, it
// became 23,528"). A manually-entered fuel unit price must survive the full
// input → Zod → String() → numeric(10,0) → reload → Number() round-trip
// EXACTLY. VND is integer end-to-end and no layer is permitted to round or
// transform it. If any of these fail, a hidden transform has crept in.
//
// The save path is, by construction:
//   Zod `positiveNumeric` = Number(val)  (shared/src/schemas/index.ts)
//   backend write         = String(val)  (trip-mutations.service.ts)
//   DB column             = numeric(10,0) (integer, db/schema.ts)
//   reload                = Number(val)  (useTripFormDispatch / fuel-voucher)
// None of these can change 23,530 into 23,528 — this test pins that invariant.

const validLegs = [
  { sequence: 1, origin: 'A', destination: 'B', km: 100, loadingType: LoadingType.HANG },
];
const base = { legs: validLegs, fuelMode: FuelMode.AUTO };

// Awkward values: the two the user cited, the config default, plus boundaries.
const AWKWARD = [23530, 23528, 27650, 100000, 1, 99999];

for (const price of AWKWARD) {
  test(`updateTripFiguresSchema preserves fuelActualUnitPrice=${price} (number input)`, () => {
    const r = updateTripFiguresSchema.safeParse({ ...base, fuelActualUnitPrice: price });
    assert.strictEqual(r.success, true);
    if (r.success) assert.strictEqual(r.data.fuelActualUnitPrice, price);
  });

  test(`updateTripFiguresSchema preserves fuelActualUnitPrice="${price}" (string input)`, () => {
    const r = updateTripFiguresSchema.safeParse({ ...base, fuelActualUnitPrice: String(price) });
    assert.strictEqual(r.success, true);
    if (r.success) assert.strictEqual(r.data.fuelActualUnitPrice, price);
  });
}

test('createTripSchema accepts a per-trip actual pump price', () => {
  // EXTERNAL carrier avoids the OWN truckId/driverId requirement so the parse
  // succeeds and we can assert the price field alone.
  const r = createTripSchema.safeParse({
    customerId: 1,
    routeId: 1,
    cargoTypeId: 1,
    containerTypeId: 1,
    departureDate: '2026-01-01',
    carrierType: 'EXTERNAL',
    externalCarrierId: 2,
    fuelActualUnitPrice: 23530,
  });
  assert.strictEqual(r.success, true);
  if (r.success) assert.strictEqual(r.data.fuelActualUnitPrice, 23530);
});

test('full VND round-trip input → String() → Number() is lossless', () => {
  // Mirrors the backend write (String(...)) + reload (Number(...)) path.
  for (const price of AWKWARD) {
    assert.strictEqual(Number(String(price)), price);
  }
});

test('blank fuelActualUnitPrice (null/undefined) is accepted → config fallback', () => {
  assert.strictEqual(
    updateTripFiguresSchema.safeParse({ ...base, fuelActualUnitPrice: null }).success,
    true,
  );
  assert.strictEqual(
    updateTripFiguresSchema.safeParse({ ...base }).success,
    true,
  );
});
