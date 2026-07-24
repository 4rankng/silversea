import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCustomerCommissionWithinRevenue } from '../services/trip-mutations.service';

test('accepts commission at the ex-VAT revenue boundary', () => {
  assert.doesNotThrow(() =>
    assertCustomerCommissionWithinRevenue(10_800_000, 0.08, 10_000_000),
  );
});

test('rejects commission above ex-VAT revenue', () => {
  assert.throws(
    () => assertCustomerCommissionWithinRevenue(10_800_000, 0.08, 10_000_001),
    /Hoa hồng khách hàng không được lớn hơn doanh thu chưa VAT/,
  );
});
