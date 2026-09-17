import test from 'node:test';
import assert from 'node:assert/strict';
import { reconciledDriverCosts } from '../../services/expense-trip-cost.service';

test('toll actuals replace estimate; agreed road/shift is not charged again', () => {
  assert.deepEqual(reconciledDriverCosts([
    { costType: 'TOLL', costGroup: 'DRIVER_ROAD', amount: '80000', customerChargeAmount: '0' },
    { costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD', amount: '200000', customerChargeAmount: '0' },
    { costType: 'OTHER', costGroup: 'DRIVER_ROAD', amount: '30000', customerChargeAmount: '0' },
  ]), { toll: 80000, extra: 30000 });
});
test('missing toll receipts retain estimate and recoverable pass-through is separate', () => {
  assert.deepEqual(reconciledDriverCosts([{ costType: 'LIFT_FEE', costGroup: 'DRIVER_SHIPMENT', amount: '500000', customerChargeAmount: '500000' }]), { toll: null, extra: 0 });
});
