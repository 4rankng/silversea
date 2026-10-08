import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyTripRun,
  computeProductivityBreakdown,
  getDailyFleetProductivity,
  getMonthlyFleetProductivity,
  exportMonthlyFleetProductivityXlsx,
} from '../services/internal-fleet-productivity.service';

test('classifyTripRun categorizes operational runs correctly', () => {
  // Kẹp
  assert.equal(classifyTripRun({ pairKind: 'KEP' }), 'KEP');
  assert.equal(classifyTripRun({ dispatchClassification: 'DOUBLE' }), 'KEP');
  assert.equal(classifyTripRun({ pairKind: 'KEP', dispatchClassification: 'DOUBLE' }), 'KEP');

  // Kết hợp
  assert.equal(classifyTripRun({ pairKind: 'KET_HOP' }), 'KET_HOP');
  assert.equal(classifyTripRun({ dispatchClassification: 'COMBINED' }), 'KET_HOP');

  // Lấy lẻ chuyển kho
  assert.equal(classifyTripRun({ dispatchClassification: 'LCL' }), 'LAY_LE');
  assert.equal(classifyTripRun({ dispatchClassification: 'LCL_PICKUP' }), 'LAY_LE');
  assert.equal(classifyTripRun({ fulfillmentType: 'LCL_SHIPMENT' }), 'LAY_LE');

  // Chuyến đơn
  assert.equal(classifyTripRun({ dispatchClassification: 'SINGLE' }), 'DON');
  assert.equal(classifyTripRun({}), 'DON');
  assert.equal(classifyTripRun({ pairKind: null, dispatchClassification: null }), 'DON');
});

test('computeProductivityBreakdown handles empty trip set cleanly', () => {
  const result = computeProductivityBreakdown([]);
  assert.equal(result.totalTrips, 0);
  assert.equal(result.kepTrips, 0);
  assert.equal(result.ketHopTrips, 0);
  assert.equal(result.layLeTrips, 0);
  assert.equal(result.donTrips, 0);
  assert.equal(result.pctKep, 0);
  assert.equal(result.pctKetHop, 0);
  assert.equal(result.pctLayLe, 0);
  assert.equal(result.pctDon, 0);
  assert.equal(result.highEfficiencyPct, 0);
});

test('computeProductivityBreakdown calculates percentages accurately with round2dp', () => {
  // 10 trips: 3 KEP (30%), 2 KET_HOP (20%), 1 LAY_LE (10%), 4 DON (40%)
  const trips = [
    'KEP', 'KEP', 'KEP',
    'KET_HOP', 'KET_HOP',
    'LAY_LE',
    'DON', 'DON', 'DON', 'DON',
  ] as const;

  const result = computeProductivityBreakdown([...trips]);
  assert.equal(result.totalTrips, 10);
  assert.equal(result.kepTrips, 3);
  assert.equal(result.ketHopTrips, 2);
  assert.equal(result.layLeTrips, 1);
  assert.equal(result.donTrips, 4);

  assert.equal(result.pctKep, 30);
  assert.equal(result.pctKetHop, 20);
  assert.equal(result.pctLayLe, 10);
  assert.equal(result.pctDon, 40);
  assert.equal(result.highEfficiencyPct, 60);
});

test('computeProductivityBreakdown handles non-integer ratios properly', () => {
  // 3 trips: 1 KEP (33.33%), 1 KET_HOP (33.33%), 1 DON (33.33%)
  const trips = ['KEP', 'KET_HOP', 'DON'] as const;
  const result = computeProductivityBreakdown([...trips]);
  assert.equal(result.totalTrips, 3);
  assert.equal(result.pctKep, 33.33);
  assert.equal(result.pctKetHop, 33.33);
  assert.equal(result.pctDon, 33.33);
  assert.equal(result.highEfficiencyPct, 66.66);
});

test('getDailyFleetProductivity returns expected structure for a given date', async () => {
  const result = await getDailyFleetProductivity('2026-10-01');
  assert.equal(result.date, '2026-10-01');
  assert.ok(typeof result.totalInternalTrucks === 'number');
  assert.ok(typeof result.activeInternalTrucks === 'number');
  assert.ok(result.fleetBreakdown);
  assert.ok(Array.isArray(result.trucks));

  if (result.trucks.length > 0) {
    const truck = result.trucks[0];
    assert.ok(truck.truckId > 0);
    assert.ok(typeof truck.licensePlate === 'string');
    assert.ok(truck.breakdown);
    assert.ok(Array.isArray(truck.tripCodes));
  }
});

test('getMonthlyFleetProductivity returns monthly metrics per internal truck', async () => {
  const result = await getMonthlyFleetProductivity(2026, 10);
  assert.equal(result.year, 2026);
  assert.equal(result.month, 10);
  assert.ok(typeof result.totalInternalTrucks === 'number');
  assert.ok(result.fleetBreakdown);
  assert.ok(Array.isArray(result.trucks));

  if (result.trucks.length > 0) {
    const truck = result.trucks[0];
    assert.ok(truck.truckId > 0);
    assert.ok(typeof truck.licensePlate === 'string');
    assert.ok(typeof truck.breakdown.totalTrips === 'number');
    assert.ok(typeof truck.breakdown.pctKep === 'number');
    assert.ok(typeof truck.breakdown.pctKetHop === 'number');
    assert.ok(typeof truck.breakdown.pctLayLe === 'number');
    assert.ok(typeof truck.breakdown.pctDon === 'number');
  }
});

test('exportMonthlyFleetProductivityXlsx produces a valid Excel workbook buffer', async () => {
  const buffer = await exportMonthlyFleetProductivityXlsx(2026, 10);
  assert.ok(buffer instanceof Buffer);
  assert.ok(buffer.length > 1000, `buffer size should be substantial, got ${buffer.length}`);
  // Check ZIP signature for XLSX (PK\x03\x04)
  assert.equal(buffer[0], 0x50);
  assert.equal(buffer[1], 0x4b);
  assert.equal(buffer[2], 0x03);
  assert.equal(buffer[3], 0x04);
});
