import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  allocateIntegerAmountByRevenue,
  computeMonthlyDepreciationForReportMonth,
  recordedTripRevenue,
  type ActiveTruckFinancialProfile,
} from '../services/pnl.service';

function mkProfile(input: {
  profileVersionId: number;
  truckId?: number;
  effectiveFrom: string;
  acquisitionCost: bigint;
  residualValue: bigint;
  inServiceDate: string;
  usefulLifeMonths: number;
  monthlyFixedCost?: bigint;
}): ActiveTruckFinancialProfile {
  return {
    profileVersionId: input.profileVersionId,
    truckId: input.truckId ?? 1,
    truckLabel: '51H-12345',
    effectiveFrom: input.effectiveFrom,
    acquisitionCost: input.acquisitionCost,
    residualValue: input.residualValue,
    inServiceDate: input.inServiceDate,
    usefulLifeMonths: input.usefulLifeMonths,
    monthlyFixedCost: input.monthlyFixedCost ?? 0n,
    source: 'APPROVED_GOVERNANCE',
  };
}

describe('fleet fixed-cost allocation helpers', () => {
  test('keeps one immutable service origin when profile version changes', () => {
    const profileHistory = [
      mkProfile({
        profileVersionId: 11,
        effectiveFrom: '2041-01-01',
        acquisitionCost: 120_000n,
        residualValue: 0n,
        inServiceDate: '2041-01-01',
        usefulLifeMonths: 12,
      }),
      mkProfile({
        profileVersionId: 12,
        effectiveFrom: '2041-06-01',
        acquisitionCost: 120_000n,
        residualValue: 0n,
        inServiceDate: '2041-01-01',
        usefulLifeMonths: 12,
      }),
    ];

    const may = computeMonthlyDepreciationForReportMonth(profileHistory, '2041-05-01');
    const june = computeMonthlyDepreciationForReportMonth(profileHistory, '2041-06-01');

    assert.equal(may.serviceMonthStart, '2041-01-01');
    assert.equal(june.serviceMonthStart, '2041-01-01');
    assert.equal(may.amount, 10_000);
    assert.equal(june.amount, 10_000);
    assert.equal(june.reason, null);
  });

  test('caps depreciation at lifetime base and never restarts after fully depreciated', () => {
    const profileHistory = [
      mkProfile({
        profileVersionId: 21,
        effectiveFrom: '2041-01-01',
        acquisitionCost: 100_000n,
        residualValue: 40_000n,
        inServiceDate: '2041-01-01',
        usefulLifeMonths: 3,
      }),
      mkProfile({
        profileVersionId: 22,
        effectiveFrom: '2041-04-01',
        acquisitionCost: 100_000n,
        residualValue: 40_000n,
        inServiceDate: '2041-01-01',
        usefulLifeMonths: 3,
      }),
    ];

    const january = computeMonthlyDepreciationForReportMonth(profileHistory, '2041-01-01');
    const february = computeMonthlyDepreciationForReportMonth(profileHistory, '2041-02-01');
    const march = computeMonthlyDepreciationForReportMonth(profileHistory, '2041-03-01');
    const april = computeMonthlyDepreciationForReportMonth(profileHistory, '2041-04-01');

    assert.equal(january.amount, 20_000);
    assert.equal(february.amount, 20_000);
    assert.equal(march.amount, 20_000);
    assert.equal(april.amount, 0);
    assert.equal(april.reason, 'FULLY_DEPRECIATED');
  });

  test('allocates integer whole-money amounts by revenue share deterministically', () => {
    const allocations = allocateIntegerAmountByRevenue(14_000n, [
      { tripId: 101, revenue: 9_000 },
      { tripId: 102, revenue: 21_000 },
    ]);

    assert.equal(allocations.get(101), 4_200n);
    assert.equal(allocations.get(102), 9_800n);
  });

  test('ignores zero and negative revenue when building the denominator', () => {
    const allocations = allocateIntegerAmountByRevenue(14_000n, [
      { tripId: 201, revenue: 9_000 },
      { tripId: 202, revenue: 0 },
      { tripId: 203, revenue: -7_000 },
      { tripId: 204, revenue: 21_000 },
    ]);

    assert.equal(allocations.get(201), 4_200n);
    assert.equal(allocations.get(204), 9_800n);
    assert.equal(allocations.has(202), false);
    assert.equal(allocations.has(203), false);
  });

  test('rejects unsafe recorded-revenue values at the public number boundary', () => {
    assert.throws(
      () => recordedTripRevenue({
        revenue: '9007199254740993',
        vatRate: '0.000',
        customerCommission: '0',
      }),
      /safe integer range/i,
    );
  });
});
