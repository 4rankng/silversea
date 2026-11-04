/**
 * Wave 7 — SIL-676 + SIL-638 TC3-T3 pair economics (the 4 QA FAIL points on
 * build e92f508b):
 *   1. VETC once per pair — the carrying leg holds the toll, the other 0.
 *   2. driverSalary materialized on EVERY completed leg (base cuốc law).
 *   3. Exactly one settlements record per fully-completed pair.
 *   4. Phụ phí Kẹp = the configured app_settings surcharge; 0 when
 *      unconfigured is an explicit honest value, never an invented formula.
 *
 * The laws are pure and live in trip-pair-rules.service (db-free, BE
 * unit-only ruling). The tx writers/readers are pinned here as source scans
 * because a unit test may not boot the app or the database.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  netTollForCompletedLeg,
  completedLegSalaryLaw,
  completedTripWageDays,
  tripCostBreakdown,
  pairSettlementEconomics,
  pairSurchargeFor,
} from '../../services/trip-pair-rules.service';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const statusMachine = read('../../services/trip-status-machine.service.ts');
const opsRoutes = read('../../routes/ops.ts');
const tripsCrud = read('../../routes/trips/crud.ts');
const driverService = read('../../services/driver.service.ts');
const completionEconomics = read('../../services/trip-completion-economics.service.ts');

const VND_BASE_SALARY = 5_000_000;
const DAY_ALLOCATION = Math.round(VND_BASE_SALARY / 26);

describe('Wave 7 — once-per-pair VETC net toll (TC3)', () => {
  const rate = 50_000;
  const leg1 = { tollsStations: 6, tollPerStationApplied: rate, tollDeduction: 0, reconciledTollCost: null };
  const leg2 = { tollsStations: 6, tollPerStationApplied: rate, tollDeduction: 6 * rate, reconciledTollCost: null };

  test('the carrying leg holds the full gross toll', () => {
    const law = netTollForCompletedLeg(leg1);
    assert.equal(law.tollCost, 300_000);
    assert.equal(law.grossToll, 300_000);
    assert.equal(law.reconciled, false);
  });

  test('the partner leg nets out to 0 — never doubled', () => {
    assert.equal(netTollForCompletedLeg(leg2).tollCost, 0);
  });

  test('a route without stations reads an honest 0, not null', () => {
    const law = netTollForCompletedLeg({ ...leg1, tollsStations: null, tollPerStationApplied: null });
    assert.equal(law.tollCost, 0);
    assert.equal(law.grossToll, 0);
  });

  test('a reconciled driver TOLL claim wins verbatim', () => {
    const law = netTollForCompletedLeg({ ...leg1, reconciledTollCost: '250000' });
    assert.equal(law.tollCost, 250_000);
    assert.equal(law.reconciled, true);
  });
});

describe('Wave 7 — completion salary law (lương cơ bản on every completed leg)', () => {
  const completedAt = new Date('2026-11-04T10:00:00Z');

  test('leg 1 takes the standard base allocation (base/26 × days)', () => {
    const law = completedLegSalaryLaw({
      storedDriverSalary: null,
      driverBaseSalary: VND_BASE_SALARY,
      routeDriverSalary: 3_000_000,
      storedTripWageDays: null,
      departureDate: '2026-11-04',
      completedAt,
      pair: null,
    });
    assert.equal(law.applied, true);
    assert.equal(law.source, 'base_allocation');
    assert.equal(law.driverSalary, DAY_ALLOCATION);
  });

  test('leg 2 of a configured ACTIVE pair carries exactly the phụ phí', () => {
    const law = completedLegSalaryLaw({
      storedDriverSalary: null,
      driverBaseSalary: VND_BASE_SALARY,
      routeDriverSalary: 0,
      storedTripWageDays: null,
      departureDate: '2026-11-04',
      completedAt,
      pair: { order: 2, active: true, surcharge: 200_000 },
    });
    assert.equal(law.source, 'pair_surcharge');
    assert.equal(law.driverSalary, 200_000);
    assert.equal(law.surchargeApplied, 200_000);
  });

  test('an unconfigured phụ phí (0) leaves the standard allocation — never a zeroed wage', () => {
    const law = completedLegSalaryLaw({
      storedDriverSalary: null,
      driverBaseSalary: VND_BASE_SALARY,
      routeDriverSalary: 0,
      storedTripWageDays: null,
      departureDate: '2026-11-04',
      completedAt,
      pair: { order: 2, active: true, surcharge: 0 },
    });
    assert.equal(law.source, 'base_allocation');
    assert.equal(law.driverSalary, DAY_ALLOCATION);
    assert.equal(law.surchargeApplied, 0);
  });

  test('a stored salary wins (no silent overwrite), pair component still reported', () => {
    const law = completedLegSalaryLaw({
      storedDriverSalary: 180_000,
      driverBaseSalary: VND_BASE_SALARY,
      routeDriverSalary: 0,
      storedTripWageDays: 2,
      departureDate: '2026-11-03',
      completedAt,
      pair: { order: 2, active: true, surcharge: 200_000 },
    });
    assert.equal(law.applied, false);
    assert.equal(law.driverSalary, 180_000);
    assert.equal(law.surchargeApplied, 200_000);
  });

  test('no driver base and no route default → law reports none, never fabricates', () => {
    const law = completedLegSalaryLaw({
      storedDriverSalary: null,
      driverBaseSalary: 0,
      routeDriverSalary: 0,
      storedTripWageDays: null,
      departureDate: '2026-11-04',
      completedAt,
      pair: null,
    });
    assert.equal(law.applied, false);
    assert.equal(law.source, 'none');
    assert.equal(law.driverSalary, 0);
  });

  test('wage days: same-day morning completion = 1, overnight adds the started day', () => {
    assert.equal(completedTripWageDays(null, '2026-11-04', new Date('2026-11-04T10:00:00Z')), 1);
    assert.equal(completedTripWageDays(null, '2026-11-03', completedAt), 2);
    assert.equal(completedTripWageDays(3, '2026-11-03', completedAt), 3);
  });

  test('the route default applies only without a driver base salary', () => {
    const law = completedLegSalaryLaw({
      storedDriverSalary: null,
      driverBaseSalary: 0,
      routeDriverSalary: 1_500_000,
      storedTripWageDays: null,
      departureDate: '2026-11-04',
      completedAt,
      pair: null,
    });
    assert.equal(law.source, 'route_default');
    assert.equal(law.driverSalary, 1_500_000);
  });
});

describe('Wave 7 — explicit cost breakdown (tolls: 0 is honest, surcharge line exists)', () => {
  test('every number present on a no-station route with unconfigured phụ phí', () => {
    const breakdown = tripCostBreakdown({
      revenue: '3952000',
      driverSalary: null,
      totalFuelCost: '97',
      totalRoadAllowance: '1100000',
      totalCost: null,
      tollsStations: null,
      tollPerStationApplied: null,
      tollDeduction: null,
      reconciledTollCost: null,
      pair: { order: 1, active: true, surcharge: 0 },
    });
    assert.deepEqual(breakdown, {
      freight: 3_952_000,
      tolls: 0,
      tollZeroReason: 'route_chua_cau_hinh_tram',
      salary: 0,
      surcharge: 0,
      fuel: 97,
      allowance: 1_100_000,
      totalCost: 0,
    });
  });

  test('leg 2 of a configured pair surfaces its phụ phí line', () => {
    const breakdown = tripCostBreakdown({
      revenue: null,
      driverSalary: '200000',
      totalFuelCost: null,
      totalRoadAllowance: null,
      totalCost: null,
      tollsStations: 6,
      tollPerStationApplied: 50_000,
      tollDeduction: 300_000,
      reconciledTollCost: null,
      pair: { order: 2, active: true, surcharge: 200_000 },
    });
    assert.equal(breakdown.surcharge, 200_000);
    assert.equal(breakdown.salary, 200_000);
    assert.equal(breakdown.tolls, 0);
  });
});

describe('Wave 7 — pair settlement economics (exactly-one-record facts)', () => {
  test('VETC once + base + phụ phí; carrying leg identified', () => {
    const first = tripCostBreakdown({
      revenue: '3952000', driverSalary: '192308', totalFuelCost: null, totalRoadAllowance: null,
      totalCost: null, tollsStations: 6, tollPerStationApplied: 50_000, tollDeduction: 0,
      reconciledTollCost: null, pair: { order: 1, active: true, surcharge: 0 },
    });
    const second = tripCostBreakdown({
      revenue: '3952000', driverSalary: '200000', totalFuelCost: null, totalRoadAllowance: null,
      totalCost: null, tollsStations: 6, tollPerStationApplied: 50_000, tollDeduction: 300_000,
      reconciledTollCost: null, pair: { order: 2, active: true, surcharge: 200_000 },
    });
    const economics = pairSettlementEconomics(first, second);
    assert.equal(economics.tollOnceLeg, 1);
    assert.equal(economics.tollAmount, 300_000);
    assert.equal(economics.baseSalary, 192_308);
    assert.equal(economics.surcharge, 200_000);
    assert.equal(economics.totalSalary, 392_308);
    assert.equal(economics.totalAmount, 692_308);
  });

  test('a route without stations keeps the record on leg 1 — 0 + reason, never null', () => {
    const noToll = tripCostBreakdown({
      revenue: null, driverSalary: null, totalFuelCost: null, totalRoadAllowance: null,
      totalCost: null, tollsStations: null, tollPerStationApplied: null, tollDeduction: null,
      reconciledTollCost: null, pair: null,
    });
    const economics = pairSettlementEconomics(noToll, noToll);
    assert.equal(economics.tollOnceLeg, 1);
    assert.equal(economics.tollAmount, 0);
    assert.equal(economics.tollZeroReason, 'route_chua_cau_hinh_tram');
  });
});

describe('Wave 7 — wiring pins (source scans; unit tests never boot db/app)', () => {
  test('every completion path materializes economics before the composite read/posting', () => {
    assert.match(statusMachine, /import \{ materializeCompletedTripEconomics \} from '\.\/trip-completion-economics\.service'/);
    // The call sits between the financial-state write and the composite read
    // the completion posting consumes, so the ledger posts materialized money.
    const beforePost = statusMachine.indexOf('materializeCompletedTripEconomics(tx, tripId, completedAt)');
    const compositeRead = statusMachine.indexOf('const updated = await getTripCompositeInTx(tx, tripId)', beforePost);
    assert.ok(beforePost > 0, 'materializer call present');
    assert.ok(compositeRead > beforePost, 'composite read (and the posting after it) must follow the materializer');
  });

  test('the materializer applies salary + toll through the composite patch', () => {
    // The write decision is the db-free completionEconomicsWrite (r4): an
    // unset stored field always rides the patch — 0 is a value, null a gap.
    assert.match(completionEconomics, /driverSalary: String\(facts\.salary\.driverSalary\)/);
    assert.match(completionEconomics, /tollCost: String\(facts\.toll\.tollCost\)/);
    assert.match(completionEconomics, /tripWageDays: facts\.salary\.tripWageDays/);
    assert.match(completionEconomics, /const salaryUnset = facts\.storedDriverSalary == null/);
    assert.match(completionEconomics, /const tollUnset = facts\.storedTollCost == null/);
    // External carriers have no driver wage in this model.
    assert.match(completionEconomics, /!== 'OWN'\) return null/);
  });

  test('GET /api/settlements admin read carries the derived pair records', () => {
    assert.match(opsRoutes, /import \{ listCompletedPairSettlements \} from '\.\.\/services\/trip-completion-economics\.service'/);
    assert.match(opsRoutes, /\[\.\.\.batches\.map\(\(batch\) => \(\{ \.\.\.batch, source: 'OPS_BATCH' as const \}\)\), \.\.\.pairRecords\]/);
    // Manual batches stay untouched; pair records ride the office-wide read only.
    assert.match(completionEconomics, /export async function listCompletedPairSettlements/);
    assert.match(completionEconomics, /code: `OS-PAIR-\$\{row\.id\}`/);
  });

  test('costBreakdown rides both economics surfaces', () => {
    assert.match(tripsCrud, /costBreakdown: breakdown \}/);
    assert.match(driverService, /costBreakdown: breakdown,/);
  });

  test('the phụ phí law stays the configured setting — no invented formula', () => {
    assert.equal(pairSurchargeFor('KEP', { kepSurcharge: 0, ketHopSurcharge: 0 }), 0);
    assert.equal(pairSurchargeFor('KEP', { kepSurcharge: 150_000, ketHopSurcharge: 0 }), 150_000);
  });
});
