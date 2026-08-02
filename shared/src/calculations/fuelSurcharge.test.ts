import assert from 'node:assert/strict';
import test from 'node:test';

import { computeFuelSurcharge } from './fuelSurcharge';

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
