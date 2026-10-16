/**
 * Pricing-table selector axis guard (FB-090 regression).
 *
 * The vehicle-class selector and the rateKey field are ONE price axis: the
 * write path denormalizes rateKey = the class code, so the canonical
 * class-linked payload — and every governed apply that re-runs beforeCreate
 * on already-normalized data — carries both fields together. The guard used
 * to reject that pair, which blocked all "Bảng giá cước" creates/updates by
 * vehicle class (staging ticket 161026095800). Container vs class (and
 * container vs rateKey) stay mutually exclusive; a rateKey that disagrees
 * with the class code is denormalizeVehicleClassSelector's job to reject.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validatePricingSelector } from '../routes/config/catalog-crud.routes';

describe('validatePricingSelector — price axis law', () => {
  test('class-only payload passes', () => {
    assert.deepEqual(
      validatePricingSelector({ vehicleSizeClassId: 4 }),
      { vehicleSizeClassId: 4 },
    );
  });

  test('canonical denormalized pair (class + matching rateKey) passes — governed double-run shape', () => {
    const denormalized = { vehicleSizeClassId: 4, rateKey: '5T' };
    assert.deepEqual(validatePricingSelector(denormalized), denormalized);
  });

  test('general row (no selector) passes', () => {
    assert.deepEqual(validatePricingSelector({}), {});
  });

  test('container-only payload passes', () => {
    assert.deepEqual(
      validatePricingSelector({ containerTypeId: 4 }),
      { containerTypeId: 4 },
    );
  });

  test('class + container together are rejected', () => {
    assert.throws(
      () => validatePricingSelector({ vehicleSizeClassId: 4, containerTypeId: 4 }),
      /một trục giá/,
    );
  });

  test('container + rateKey together are rejected', () => {
    assert.throws(
      () => validatePricingSelector({ containerTypeId: 4, rateKey: '5T' }),
      /một trong hai/,
    );
  });
});
