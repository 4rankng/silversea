import test from 'node:test';
import assert from 'node:assert/strict';
import { reconciledDriverCosts } from '../../services/expense-trip-cost.service';

test('toll actuals replace estimate; SIL-722 approved road money joins the direct cost', () => {
  assert.deepEqual(reconciledDriverCosts([
    { costType: 'TOLL', costGroup: 'DRIVER_ROAD', amount: '80000', customerChargeAmount: '0' },
    { costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD', amount: '200000', customerChargeAmount: '0' },
    { costType: 'OTHER', costGroup: 'DRIVER_ROAD', amount: '30000', customerChargeAmount: '0' },
  ]), { toll: 80000, extra: 230000 });
});
test('SIL-722: an approved road claim enters extra while the route allowance stays a separate figure', () => {
  // Trả đêm 100.000₫ fee-norm row (driver-fulfillment seeds ROAD_ALLOWANCE
  // for norms) — the route allowance lives in trips.totalRoadAllowance
  // (computeTripTotals), so the claim adds on top without double-counting.
  assert.deepEqual(reconciledDriverCosts([
    { costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD', amount: '100000', customerChargeAmount: '0' },
  ]), { toll: null, extra: 100000 });
});
test('SIL-722: a negative road row behaves as absent, like every other signed row', () => {
  assert.deepEqual(reconciledDriverCosts([
    { costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD', amount: '-50000', customerChargeAmount: '0' },
    { costType: 'PARKING', costGroup: 'DRIVER_ROAD', amount: '20000', customerChargeAmount: '0' },
  ]), { toll: null, extra: 20000 });
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
