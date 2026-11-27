/**
 * SIL-1137 — QA retest 4 (staging build 6398dfbc, trips 591+592) verdict fix.
 *
 * A pair MAIN leg closed through the driver app carried totalCost/grossProfit
 * NULL forever: trip creation writes neither field, the pairing transaction
 * writes the cost/profit pair on the SECOND leg only, and the completion
 * materializer skipped its cost/profit rewrite whenever the salary/toll
 * delta was 0 (salary unset-and-computing-0 and an unchanged VETC net delta
 * exactly 0). The trip surfaces then fabricated "0 ₫ / 0,0%" from the gap
 * while the partner leg — whose profit the pairing write had materialized —
 * showed the correct "3.800.000 ₫ / 100,0%".
 *
 * Law (extends the r4 never-a-null-gap rule to the cost/profit pair): a
 * COMPLETED OWN leg always materializes its own P&L — profit = revenue −
 * cost on EACH leg independently (KB rule 6: the shared pair cost books 100%
 * on the carrying leg, the partner leg books 0, revenue stays per-lot). A
 * stored value always wins, so a governed correction or the pairing write
 * (trip 592's "3.800.000 ₫") is never second-guessed.
 *
 * Pure laws only (BE unit-only owner ruling: no db/app boot).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  completedLegSalaryLaw,
  netTollForCompletedLeg,
  VETC_ROUTE_UNCONFIGURED_REASON,
} from '../../services/trip-pair-rules.service';
import { completionEconomicsWrite } from '../../services/trip-completion-economics.service';

/** Zero-config staging shape: driver/route salary unset, no pair surcharge. */
const zeroSalaryConfig = {
  storedDriverSalary: null,
  storedTripWageDays: null,
  driverBaseSalary: null,
  routeDriverSalary: null,
  departureDate: '2026-11-26',
  completedAt: new Date('2026-11-26T10:00:00Z'),
};

/** The pair MAIN leg at completion: creation wrote the VETC net ('0') but
 *  neither P&L field; the pairing transaction never touches leg 1's money. */
const mainLegFacts = {
  storedDriverSalary: null,
  storedTollCost: '0',
  storedTotalCost: null,
  storedGrossProfit: null,
  storedRevenue: '3800000',
};

const unconfiguredToll = netTollForCompletedLeg({
  tollsStations: 0,
  tollPerStationApplied: '0',
  tollDeduction: '0',
  reconciledTollCost: null,
});

describe('SIL-1137 — a completed OWN leg never leaves its P&L a null gap', () => {
  test('pair MAIN leg (591): NULL totalCost/grossProfit materialize at delta 0 — profit = revenue − 0', () => {
    const salary = completedLegSalaryLaw({ ...zeroSalaryConfig, pair: null });
    assert.equal(salary.applied, false);       // no configured wage → honest 0
    assert.equal(salary.driverSalary, 0);

    const write = completionEconomicsWrite({ ...mainLegFacts, salary, toll: unconfiguredToll });

    assert.equal(write.changed, true);
    assert.equal(write.patch.driverSalary, '0');
    assert.equal(write.patch.tripWageDays, salary.tripWageDays);
    assert.equal(write.patch.tollCost, undefined);   // VETC net unchanged
    assert.equal(write.patch.totalCost, '0');
    assert.equal(write.patch.grossProfit, '3800000'); // revenue − own cost, never a fabricated 0
  });

  test('pair PARTNER leg (592): pairing-written P&L is a stored value — untouched', () => {
    const write = completionEconomicsWrite({
      storedDriverSalary: '0',
      storedTollCost: '0',
      storedTotalCost: '0',
      storedGrossProfit: '3800000',
      storedRevenue: '3800000',
      salary: { applied: false, source: 'stored', driverSalary: 0, tripWageDays: 1, surchargeApplied: 0 },
      toll: { tollCost: 0, grossToll: 0, tollDeduction: 0, reconciled: false, tollZeroReason: VETC_ROUTE_UNCONFIGURED_REASON },
    });

    assert.equal(write.changed, false);
    assert.deepEqual(write.patch, {});
  });

  test('governed stored figures win: set cost/profit at delta 0 stays a no-op', () => {
    const write = completionEconomicsWrite({
      storedDriverSalary: '800000',
      storedTollCost: '110000',
      storedTotalCost: '1200000',
      storedGrossProfit: '2600000',
      storedRevenue: '3800000',
      salary: { applied: false, source: 'stored', driverSalary: 800000, tripWageDays: 1, surchargeApplied: 0 },
      toll: { tollCost: 110000, grossToll: 110000, tollDeduction: 0, reconciled: false, tollZeroReason: null },
    });

    assert.equal(write.changed, false);
    assert.deepEqual(write.patch, {});
  });

  test('a real salary delta still moves totalCost/grossProfit together with the gap fallback', () => {
    const write = completionEconomicsWrite({
      ...mainLegFacts,
      salary: { applied: true, source: 'base_allocation', driverSalary: 500000, tripWageDays: 1, surchargeApplied: 0 },
      toll: unconfiguredToll,
    });

    assert.equal(write.changed, true);
    assert.equal(write.patch.driverSalary, '500000');
    assert.equal(write.patch.totalCost, '500000');
    assert.equal(write.patch.grossProfit, '3300000'); // 3.800.000 − 500.000
  });

  test('half-written row (grossProfit NULL, totalCost set) reconstructs profit from the stored cost', () => {
    const write = completionEconomicsWrite({
      ...mainLegFacts,
      storedTollCost: '55000',
      storedTotalCost: '300000',
      salary: { applied: false, source: 'none', driverSalary: 0, tripWageDays: 1, surchargeApplied: 0 },
      toll: { tollCost: 55000, grossToll: 55000, tollDeduction: 0, reconciled: false, tollZeroReason: null },
    });

    assert.equal(write.changed, true);
    assert.equal(write.patch.totalCost, '300000');
    assert.equal(write.patch.grossProfit, '3500000'); // revenue − stored cost
  });
});
