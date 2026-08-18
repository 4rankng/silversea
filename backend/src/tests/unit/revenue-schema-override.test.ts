import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { updateTripFiguresSchema, FuelMode, LoadingType } from '@tingting/shared';

/**
 * Revenue override footgun — feedback202606 A3 §9.
 *
 * `updateTripFiguresSchema` carries a superRefine: when `revenue` is sent
 * TOGETHER with a split (`revenueEmptyReturn` or `revenueCombine`), the payload
 * is rejected, because splits are authoritative when present and a mixed payload
 * would silently discard `revenue`. Single-split payloads (revenue omitted)
 * remain legal, including an explicit-zero single split.
 *
 * Pure unit test — no DB. Uses `.safeParse` so each case asserts on
 * `success` + the issue message rather than throwing.
 */

// `fuelMode` and `legs` are required by the schema; every payload below
// spreads these defaults and only varies the revenue fields. The leg values
// are otherwise irrelevant to the revenue/splits refine under test.
const base = {
  fuelMode: FuelMode.AUTO,
  legs: [{
    sequence: 1,
    origin: 'Kho',
    destination: 'Cảng',
    km: 10,
    loadingType: LoadingType.HANG,
  }],
};

describe('updateTripFiguresSchema — revenue/splits mutual exclusion', () => {
  test('rejects when revenue is sent together with both splits', () => {
    const res = updateTripFiguresSchema.safeParse({
      ...base,
      revenue: 1_500_000,
      revenueEmptyReturn: 0,
      revenueCombine: 0,
    });
    assert.equal(res.success, false);
    assert.match(res.error.issues[0].message, /revenue.*HOẶC.*splits|splits.*revenue/);
  });

  test('accepts revenue-only payload (no splits)', () => {
    const res = updateTripFiguresSchema.safeParse({
      ...base,
      revenue: 1_500_000,
    });
    assert.equal(res.success, true);
  });

  test('accepts splits-only payload (revenue omitted)', () => {
    const res = updateTripFiguresSchema.safeParse({
      ...base,
      revenueEmptyReturn: 400,
      revenueCombine: 600,
    });
    assert.equal(res.success, true);
  });

  test('accepts a single explicit-zero split with revenue omitted', () => {
    const res = updateTripFiguresSchema.safeParse({
      ...base,
      revenueEmptyReturn: 0,
    });
    assert.equal(res.success, true);
  });

  test('rejects when revenue is sent with only ONE split', () => {
    const res = updateTripFiguresSchema.safeParse({
      ...base,
      revenue: 9999,
      revenueEmptyReturn: 100,
    });
    assert.equal(res.success, false);
    assert.match(res.error.issues[0].message, /revenue.*HOẶC.*splits|splits.*revenue/);
  });
});
