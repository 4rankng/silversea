import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freightRateTermSchema } from './index';

const terms = { customerId: 1, routeId: 2, billingKmOneWay: 100, baseFuelPrice: 20000 };

test('new freight terms require an explicit agreed lag without coercing unknown values to zero', () => {
  for (const fuelLagDays of [undefined, null, '', '  ', false, true, -1, 1.5, 'invalid']) {
    const result = freightRateTermSchema.safeParse({ ...terms, fuelLagDays });
    assert.equal(result.success, false, `lag ${String(fuelLagDays)} must be rejected`);
    if (!result.success) assert.deepEqual(result.error.issues[0].path, ['fuelLagDays']);
  }
  for (const fuelLagDays of [0, '0', ' 0 ', 1, '2']) {
    const parsed = freightRateTermSchema.parse({ ...terms, fuelLagDays });
    assert.equal(parsed.fuelLagDays, Number(fuelLagDays));
  }
});

test('partial freight terms updates preserve the omitted existing lag and reject explicit unknown lag', () => {
  assert.deepEqual(freightRateTermSchema.partial().parse({ note: 'Điều chỉnh ghi chú' }), { note: 'Điều chỉnh ghi chú' });
  assert.deepEqual(freightRateTermSchema.partial().parse({ fuelLagDays: '0' }), { fuelLagDays: 0 });
  for (const fuelLagDays of [null, '', ' ', false]) {
    assert.equal(freightRateTermSchema.partial().safeParse({ fuelLagDays }).success, false);
  }
});
