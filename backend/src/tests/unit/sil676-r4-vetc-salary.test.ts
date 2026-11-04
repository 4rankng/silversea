/**
 * SIL-676 r4 + SIL-638 TC3-T3 — QA pair 30 (staging e9afda3f, trips 324/325)
 * verdict fix points:
 *   1. driverSalary must NEVER stay NULL after a completion: the r3
 *      materializer's no-op gate (`!salary.applied && costDelta === 0`)
 *      skipped the write when staging had no configured salary, leaving the
 *      gap. r4 law: an unset stored field becomes the law's computed number —
 *      0 is a value (owner ruling D02), null is a gap.
 *   2. VETC record materializes ONCE per pair even on a route without toll
 *      stations: amount per config, or 0 + the `route_chua_cau_hinh_tram`
 *      marker + the owner warning — never a silent null, never doubled.
 *   3. Every completion path — driver close, POD close (TC9 zero-upload POD
 *      is the same driver-app complete endpoint), điều vận governed close,
 *      routine shipment close — funnels into the ONE materializer that runs
 *      before the completion posting.
 *
 * Pure laws + source scans only (BE unit-only owner ruling: no db/app boot).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  completedLegSalaryLaw,
  netTollForCompletedLeg,
  pairSettlementEconomics,
  tripCostBreakdown,
  VETC_ROUTE_UNCONFIGURED_REASON,
} from '../../services/trip-pair-rules.service';
import { completionEconomicsWrite } from '../../services/trip-completion-economics.service';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const statusMachine = read('../../services/trip-status-machine.service.ts');
const driverFulfillment = read('../../services/driver-fulfillment.service.ts');
const adjustmentGovernance = read('../../services/adjustment-governance.service.ts');
const shipmentLifecycle = read('../../services/shipment-lifecycle.service.ts');
const completionEconomics = read('../../services/trip-completion-economics.service.ts');

/** Staging pair-30 shape: route 6 tollsStations null, driver/route salary
 *  unset, pair surcharge settings absent — every law input at its unset. */
const stagingZeroConfig = {
  storedDriverSalary: null,
  storedTripWageDays: null,
  driverBaseSalary: null,
  routeDriverSalary: null,
  departureDate: '2026-11-04',
  completedAt: new Date('2026-11-04T10:00:00Z'),
};

describe('r4 — salary materializes on EVERY completion path (never a null gap)', () => {
  test('driver close, POD close, điều vận governed close and routine close all funnel into the one materializer', () => {
    // Driver-app close AND the TC9 zero-upload POD close share this endpoint.
    assert.match(driverFulfillment, /export async function completeOwnedFulfillmentTrip/);
    assert.match(driverFulfillment, /driverOwnedFulfillmentClose: \{/);
    // Điều vận governed completion rides the governance apply path.
    assert.match(adjustmentGovernance, /await transitionTripStatus\(/);
    assert.match(adjustmentGovernance, /TripStatus\.COMPLETED/);
    // Routine shipment close (Kế toán/CUS direct) rides the lifecycle path.
    assert.match(shipmentLifecycle, /await transitionTripStatus\(/);
    // All of them land in the machine that materializes before the posting.
    assert.match(statusMachine, /if \(completedAt != null\) \{\s*await materializeCompletedTripEconomics\(tx, tripId, completedAt\);/);
  });

  test('staging zero-config shape: unset salary becomes the explicit computed 0, never null', () => {
    const salary = completedLegSalaryLaw({ ...stagingZeroConfig, pair: null });
    assert.equal(salary.applied, false);
    assert.equal(salary.driverSalary, 0);
    const write = completionEconomicsWrite({
      storedDriverSalary: null,
      storedTollCost: null,
      storedTotalCost: null,
      storedGrossProfit: null,
      storedRevenue: null,
      salary,
      toll: netTollForCompletedLeg({ tollsStations: null, tollPerStationApplied: null, tollDeduction: null, reconciledTollCost: null }),
    });
    assert.equal(write.changed, true);
    assert.equal(write.patch.driverSalary, '0');
    assert.equal(write.patch.tripWageDays, 1);
    assert.equal(write.patch.tollCost, '0');
    // Nothing else moved — no totalCost delta on an all-zero economics.
    assert.equal(write.patch.totalCost, undefined);
    assert.equal(write.patch.grossProfit, undefined);
  });

  test('configured driver base salary allocates through on a driver close', () => {
    const salary = completedLegSalaryLaw({ ...stagingZeroConfig, driverBaseSalary: 5_000_000, pair: null });
    assert.equal(salary.applied, true);
    assert.equal(salary.source, 'base_allocation');
    assert.equal(salary.driverSalary, 192_308);
    const write = completionEconomicsWrite({
      storedDriverSalary: null, storedTollCost: '0', storedTotalCost: '0',
      storedGrossProfit: null, storedRevenue: null, salary,
      toll: netTollForCompletedLeg({ tollsStations: 2, tollPerStationApplied: 55_000, tollDeduction: 0, reconciledTollCost: null }),
    });
    assert.equal(write.patch.driverSalary, '192308');
    assert.equal(write.patch.totalCost, '302308');
    assert.equal(write.patch.grossProfit, '-302308');
  });

  test('leg 2 of a configured pair writes the settings phụ phí, not two single cuốc', () => {
    const salary = completedLegSalaryLaw({ ...stagingZeroConfig, pair: { order: 2, active: true, surcharge: 200_000 } });
    assert.equal(salary.applied, true);
    assert.equal(salary.source, 'pair_surcharge');
    assert.equal(salary.driverSalary, 200_000);
    assert.equal(salary.surchargeApplied, 200_000);
  });

  test('a stored wage wins and an agreeing re-run writes nothing (idempotent)', () => {
    const salary = completedLegSalaryLaw({ ...stagingZeroConfig, storedDriverSalary: '192308', driverBaseSalary: 5_000_000, pair: null });
    assert.equal(salary.applied, false);
    assert.equal(salary.driverSalary, 192_308);
    const write = completionEconomicsWrite({
      storedDriverSalary: '192308', storedTollCost: '110000', storedTotalCost: '302308',
      storedGrossProfit: '-302308', storedRevenue: null, salary,
      toll: netTollForCompletedLeg({ tollsStations: 2, tollPerStationApplied: 55_000, tollDeduction: 0, reconciledTollCost: null }),
    });
    assert.equal(write.changed, false);
    assert.deepEqual(write.patch, {});
  });
});

describe('r4 — VETC materializes once per pair on any route (0 + marker when unconfigured)', () => {
  const stations2Rate55k = { tollsStations: 2, tollPerStationApplied: 55_000 };

  test('route WITH stations: the carrying leg holds the configured amount, no marker', () => {
    const law = netTollForCompletedLeg({ ...stations2Rate55k, tollDeduction: 0, reconciledTollCost: null });
    assert.equal(law.tollCost, 110_000);
    assert.equal(law.tollZeroReason, null);
    const partner = netTollForCompletedLeg({ ...stations2Rate55k, tollDeduction: 110_000, reconciledTollCost: null });
    assert.equal(partner.tollCost, 0);
    // The pair never doubles: amount = carrying leg + 0.
    const first = tripCostBreakdown({ revenue: null, driverSalary: null, totalFuelCost: null, totalRoadAllowance: null, totalCost: null, reconciledTollCost: null, pair: null, ...stations2Rate55k, tollDeduction: 0 });
    const second = tripCostBreakdown({ revenue: null, driverSalary: null, totalFuelCost: null, totalRoadAllowance: null, totalCost: null, reconciledTollCost: null, pair: null, ...stations2Rate55k, tollDeduction: 110_000 });
    const economics = pairSettlementEconomics(first, second);
    assert.equal(economics.tollAmount, 110_000);
    assert.equal(economics.tollOnceLeg, 1);
    assert.equal(economics.tollZeroReason, null);
  });

  test('route WITHOUT stations: amount 0 + route_chua_cau_hinh_tram, never a silent null, never doubled', () => {
    const law = netTollForCompletedLeg({ tollsStations: null, tollPerStationApplied: null, tollDeduction: null, reconciledTollCost: null });
    assert.equal(law.tollCost, 0);
    assert.equal(law.tollZeroReason, VETC_ROUTE_UNCONFIGURED_REASON);
    assert.equal(VETC_ROUTE_UNCONFIGURED_REASON, 'route_chua_cau_hinh_tram');
    const leg = tripCostBreakdown({ revenue: null, driverSalary: null, totalFuelCost: null, totalRoadAllowance: null, totalCost: null, tollsStations: null, tollPerStationApplied: null, tollDeduction: null, reconciledTollCost: null, pair: null });
    const economics = pairSettlementEconomics(leg, leg);
    assert.equal(economics.tollOnceLeg, 1);
    assert.equal(economics.tollAmount, 0);
    assert.equal(economics.tollZeroReason, 'route_chua_cau_hinh_tram');
    // No doubling: both legs 0 sum to the once-per-pair 0.
    assert.equal(economics.tollAmount, leg.tolls + leg.tolls);
  });

  test('a reconciled driver claim wins verbatim and carries no unconfigured marker', () => {
    const law = netTollForCompletedLeg({ tollsStations: null, tollPerStationApplied: null, tollDeduction: null, reconciledTollCost: '90000' });
    assert.equal(law.tollCost, 90_000);
    assert.equal(law.reconciled, true);
    assert.equal(law.tollZeroReason, null);
  });

  test('the settlement read carries the record + the warning on the note', () => {
    assert.match(completionEconomics, /const economics = pairSettlementEconomics\(firstBreakdown, secondBreakdown\)/);
    assert.match(completionEconomics, /tollOnceLeg: economics\.tollOnceLeg/);
    assert.match(completionEconomics, /tollZeroReason: economics\.tollZeroReason/);
    assert.match(completionEconomics, /VETC_ROUTE_UNCONFIGURED_WARNING/);
    // The writer materializes tollCost even when the computed net is 0.
    assert.match(completionEconomics, /export function completionEconomicsWrite/);
    assert.match(completionEconomics, /const tollUnset = facts\.storedTollCost == null/);
    // An unset salary always rides the patch (computed 0 is a value).
    assert.match(completionEconomics, /const salaryUnset = facts\.storedDriverSalary == null/);
    assert.match(completionEconomics, /const salaryWrites = facts\.salary\.applied \|\| salaryUnset/);
  });
});
