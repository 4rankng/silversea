import assert from 'node:assert/strict';
import test from 'node:test';

import { computeFuelSurcharge, computeFreightRate } from './fuelSurcharge';

test('computeFuelSurcharge applies the configured delta, liters, and share percent', () => {
  const result = computeFuelSurcharge({
    currentPrice: 50,
    basePrice: 0,
    sharePct: 50,
    quotaLiters: 100,
  });
  assert.deepEqual(result, { amount: 2500, applicable: true });
});

test('computeFuelSurcharge returns zero when share percent is null', () => {
  const result = computeFuelSurcharge({
    currentPrice: 25000,
    basePrice: 20000,
    sharePct: null,
    quotaLiters: 100,
  });
  assert.deepEqual(result, { amount: 0, applicable: false });
});

test('computeFuelSurcharge returns zero when base price is unset', () => {
  const result = computeFuelSurcharge({
    currentPrice: 25000,
    basePrice: null,
    sharePct: 50,
    quotaLiters: 100,
  });
  assert.deepEqual(result, { amount: 0, applicable: false });
});

test('computeFuelSurcharge returns zero when current price does not exceed base price', () => {
  const result = computeFuelSurcharge({
    currentPrice: 20000,
    basePrice: 20000,
    sharePct: 50,
    quotaLiters: 100,
  });
  assert.deepEqual(result, { amount: 0, applicable: false });
});

test('computeFuelSurcharge handles 100 percent customer share', () => {
  const result = computeFuelSurcharge({
    currentPrice: 1010,
    basePrice: 1000,
    sharePct: 100,
    quotaLiters: 50,
  });
  assert.deepEqual(result, { amount: 500, applicable: true });
});

test('computeFuelSurcharge uses round2dp then roundInt', () => {
  const result = computeFuelSurcharge({
    currentPrice: 3334,
    basePrice: 1,
    sharePct: 33,
    quotaLiters: 33,
  });
  assert.deepEqual(result, { amount: 36296, applicable: true });
});


// ─── computeFreightRate tests (correct formula) ────────────────────────────

test('computeFreightRate: NEWEB CONT40, fuel 27620 (parity with Excel)', () => {
  // Excel §6.1: basePrice=4100000, sharePct=2, fuelPrice=27620, baseFuel=17842.5926, liters=91
  // Expected: freight=4182000, surcharge=889744, total=5071744
  const result = computeFreightRate({
    basePrice: 4100000,
    sharePct: 2,
    fuelPrice: 27620,
    baseFuelPrice: 17842.5926,
    liters: 91,
  });
  assert.equal(result.freight, 4182000);
  assert.equal(result.surcharge, 889744);
  assert.equal(result.total, 5071744);
});

test('computeFreightRate: NEWEB CONT40, fuel 21740 (parity with Excel)', () => {
  // Excel §6.2: basePrice=4100000, sharePct=2, fuelPrice=21740, baseFuel=17842.5926, liters=91
  // Expected: freight=4182000, surcharge=354664, total=4536664
  const result = computeFreightRate({
    basePrice: 4100000,
    sharePct: 2,
    fuelPrice: 21740,
    baseFuelPrice: 17842.5926,
    liters: 91,
  });
  assert.equal(result.freight, 4182000);
  assert.equal(result.surcharge, 354664);
  assert.equal(result.total, 4536664);
});

test('computeFreightRate: clamp to 0 when fuel below base', () => {
  // Câu 1 = B: fuel 16000 < base 17842.5926 ⇒ surcharge = 0
  const result = computeFreightRate({
    basePrice: 4100000,
    sharePct: 2,
    fuelPrice: 16000,
    baseFuelPrice: 17842.5926,
    liters: 91,
  });
  assert.equal(result.freight, 4182000);
  assert.equal(result.surcharge, 0);
  assert.equal(result.total, 4182000);
});

test('computeFreightRate: fuel exactly at base ⇒ surcharge = 0', () => {
  const result = computeFreightRate({
    basePrice: 4100000,
    sharePct: 2,
    fuelPrice: 17842.5926,
    baseFuelPrice: 17842.5926,
    liters: 91,
  });
  assert.equal(result.surcharge, 0);
  assert.equal(result.total, 4182000);
});

test('computeFreightRate: ASKEY 1.25T, fuel 27620 (parity with Excel)', () => {
  // Excel §6.1 ASKEY: basePrice=1200000, sharePct=4, fuelPrice=27620, baseFuel=17842.5926, liters=20
  // Expected: freight=1248000, surcharge=195548, total=1443548
  const result = computeFreightRate({
    basePrice: 1200000,
    sharePct: 4,
    fuelPrice: 27620,
    baseFuelPrice: 17842.5926,
    liters: 20,
  });
  assert.equal(result.freight, 1248000);
  assert.equal(result.surcharge, 195548);
  assert.equal(result.total, 1443548);
});

test('computeFreightRate: fuelDelta is not rounded', () => {
  const result = computeFreightRate({
    basePrice: 4100000,
    sharePct: 2,
    fuelPrice: 27620,
    baseFuelPrice: 17842.5926,
    liters: 91,
  });
  // fuelDelta = 27620 - 17842.5926 = 9777.4074
  assert.ok(Math.abs(result.fuelDelta - 9777.4074) < 0.0001);
});
