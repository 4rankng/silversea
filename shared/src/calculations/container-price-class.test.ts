import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTAINER_PRICE_CLASS_LABELS,
  CONTAINER_WEIGHT_BOUNDARY_TONS,
  MISSING_WEIGHT_MESSAGE,
  resolveContainerPriceClass,
} from './container-price-class';

test('18t books the light class, 22t the heavy class — both container sizes', () => {
  assert.equal(resolveContainerPriceClass('CONT20', 18).ok, true);
  assert.deepEqual(resolveContainerPriceClass('CONT20', 18), { ok: true, code: 'CONT20.LIGHT' });
  assert.deepEqual(resolveContainerPriceClass('CONT20', 22), { ok: true, code: 'CONT20.HEAVY' });
  assert.deepEqual(resolveContainerPriceClass('CONT40', 18), { ok: true, code: 'CONT40.LIGHT' });
  assert.deepEqual(resolveContainerPriceClass('CONT40', 22), { ok: true, code: 'CONT40.HEAVY' });
});

test('exactly 20.0t is HEAVY (ruling a) — pinned at the boundary', () => {
  assert.deepEqual(resolveContainerPriceClass('CONT20', 20), { ok: true, code: 'CONT20.HEAVY' });
  assert.deepEqual(resolveContainerPriceClass('CONT40', 20.0), { ok: true, code: 'CONT40.HEAVY' });
});

test('19.999t stays light; 20.001t goes heavy', () => {
  assert.deepEqual(resolveContainerPriceClass('CONT20', 19.999), { ok: true, code: 'CONT20.LIGHT' });
  assert.deepEqual(resolveContainerPriceClass('CONT20', 20.001), { ok: true, code: 'CONT20.HEAVY' });
});

test('missing weight blocks: null / undefined / NaN / 0 / negative → MISSING_WEIGHT, message "Thiếu trọng tải"', () => {
  for (const w of [null, undefined, NaN, 0, -5]) {
    assert.deepEqual(resolveContainerPriceClass('CONT20', w), {
      ok: false,
      reason: 'MISSING_WEIGHT',
      message: MISSING_WEIGHT_MESSAGE,
      message: MISSING_WEIGHT_MESSAGE,
    });
  }
});

test('labels are the customer sheet verbatim', () => {
  assert.deepEqual(CONTAINER_PRICE_CLASS_LABELS, {
    'CONT20.LIGHT': 'Cont 20 - Trọng tải < 20 tấn',
    'CONT20.HEAVY': 'Cont 20 - Trọng tải > 20 tấn',
    'CONT40.LIGHT': 'Cont 40 nhẹ - Trọng tải < 20 tấn',
    'CONT40.HEAVY': 'Cont 40 nặng - Trọng tải > 20 tấn',
  });
});

test('codes fit the vehicleSizeClassSchema code contract (A-Z, 0-9, dot, ≤20)', () => {
  for (const code of Object.keys(CONTAINER_PRICE_CLASS_LABELS)) {
    assert.match(code, /^[A-Z0-9.]{1,20}$/);
  }
  assert.equal(CONTAINER_WEIGHT_BOUNDARY_TONS, 20);
});
