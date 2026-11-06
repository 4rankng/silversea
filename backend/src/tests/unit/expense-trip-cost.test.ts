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
test('missing toll receipts retain estimate (toll null, caller falls back to station math)', () => {
  assert.deepEqual(reconciledDriverCosts([]), { toll: null, extra: 0 });
});
test('SIL-696: an approved lift fee enters the direct cost even when the lot bills the customer for it', () => {
  assert.deepEqual(reconciledDriverCosts([
    { costType: 'LIFT_FEE', costGroup: 'DRIVER_SHIPMENT', amount: '175000', customerChargeAmount: '175000' },
    { costType: 'TOLL', costGroup: 'DRIVER_ROAD', amount: '135000', customerChargeAmount: '0' },
  ]), { toll: 135000, extra: 175000 });
});
test('SIL-696: drop/warehouse/parking claims all count; negative rows behave as absent', () => {
  assert.deepEqual(reconciledDriverCosts([
    { costType: 'DROP_FEE', costGroup: 'DRIVER_SHIPMENT', amount: '120000', customerChargeAmount: null },
    { costType: 'WAREHOUSE_FEE', costGroup: 'DRIVER_SHIPMENT', amount: '30000', customerChargeAmount: '50000' },
    { costType: 'PARKING', costGroup: 'DRIVER_ROAD', amount: '20000', customerChargeAmount: '0' },
    { costType: 'LIFT_FEE', costGroup: 'DRIVER_SHIPMENT', amount: '-90000', customerChargeAmount: null },
  ]), { toll: null, extra: 170000 });
});
