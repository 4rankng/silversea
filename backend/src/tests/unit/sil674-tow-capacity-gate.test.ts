/**
 * SIL-674 — the Kẹp pair weight gate refused EVERY second leg (409
 * KEP_WEIGHT_WARNING) for the master-data-imported fleet: the issue path
 * resolved the vehicle capacity ONLY from the mooc-type bucket
 * (TRAILER_CAPACITY_KG), and imports legitimately leave the mooc type blank
 * — so trips.vehicleCapacityKg stayed null and the gate ran 'unprovable'
 * on every attempt. QA staging 5b0bdad3: legs 5t+5t on a 33t tractor
 * (tow_capacity_tons 33.0) 409'd; GET /api/trips/222/223 carried
 * vehicleCapacityKg null.
 *
 * The fix resolves the capacity ONCE at the issue path (the shared owner of
 * the snapshot AND the gate arg): mooc-type bucket first, else the tractor's
 * spec-sheet tow rating in tons × 1000. Under capacity the pair issues clean
 * (201, no warning); over capacity stays the DOC warn-once (409 + confirmed
 * retry); a rig with NEITHER rating stays unprovable warn-once — the DOC's
 * "xe chưa cấu hình tải moóc" branch, deliberately kept (SIL-638 TC6(2) v2).
 *
 * Cause evidence (local repro, qa/2026-11-03-sil674/driver-before.log): the
 * identical manual-pair shape with a KNOWN bucket (40FT) already passed
 * pre-fix with no pair rows in existence (SIL-668 manual pairing removed the
 * auto pair) — the declared-share carve is pair-row-independent, so the
 * SIL-668 interaction hypothesis is rejected; the null capacity is the cause.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { kepPairWeightVerdict, kepWeightGuardOutcome } from '../../services/trip-pair-rules.service';
import { inferredVehicleCapacityKg, truckTowCapacityKg } from '../../services/dispatch-planning-utils.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsSource = readFileSync(
  path.join(here, '../../services/dispatch-planning-commands.service.ts'),
  'utf8',
);

describe('SIL-674 — the tractor tow rating fills the null-capacity hole', () => {
  it('converts the spec-sheet tow rating (tons) to a kg string', () => {
    assert.equal(truckTowCapacityKg('33.0'), '33000');
    assert.equal(truckTowCapacityKg(33), '33000');
    assert.equal(truckTowCapacityKg('33.5'), '33500');
    assert.equal(truckTowCapacityKg('40'), '40000');
  });

  it('an undeclared rating stays null — the unprovable law owns that shape', () => {
    assert.equal(truckTowCapacityKg(null), null);
    assert.equal(truckTowCapacityKg(undefined), null);
    assert.equal(truckTowCapacityKg(''), null);
    assert.equal(truckTowCapacityKg(0), null);
    assert.equal(truckTowCapacityKg(-5), null);
    assert.equal(truckTowCapacityKg('abc'), null);
  });

  it('the issue path reads the tow rating and chains it after the mooc bucket', () => {
    // The truck select carries the spec-sheet column.
    assert.match(commandsSource, /towCapacityTons: s\.trucks\.towCapacityTons/);
    // The resolution chains the fallback after the mooc-type bucket.
    assert.match(
      commandsSource,
      /vehicleCapacityKg = inferredVehicleCapacityKg\(resolvedTrailerType\)\s*\n\s*\?\? truckTowCapacityKg\(truck\.towCapacityTons\);/,
    );
  });

  it('QA shape: 5t + 5t under the 33t tow rating → pass → clean issue (no warning)', () => {
    const capacity = truckTowCapacityKg('33.0');
    assert.equal(kepPairWeightVerdict('5000', '5000', capacity), 'pass');
    assert.equal(kepWeightGuardOutcome('pass', false), 'allow');
  });

  it('over the tow rating → refuse once, confirmed retry proceeds (TC6(2) kept)', () => {
    const capacity = truckTowCapacityKg('33.0');
    assert.equal(kepPairWeightVerdict('25000', '10000', capacity), 'overload');
    assert.equal(kepWeightGuardOutcome('overload', false), 'refuse');
    assert.equal(kepWeightGuardOutcome('overload', true), 'allow');
  });

  it('no mooc bucket AND no tow rating → still warn-once confirmable (kept law)', () => {
    const capacity = inferredVehicleCapacityKg(null) ?? truckTowCapacityKg(null);
    assert.equal(capacity, null);
    assert.equal(kepPairWeightVerdict('5000', '5000', capacity), 'unprovable');
    assert.equal(kepWeightGuardOutcome('unprovable', false), 'refuse');
    assert.equal(kepWeightGuardOutcome('unprovable', true), 'allow');
  });

  it('precedence unchanged: a declared mooc bucket wins over the tow rating', () => {
    assert.equal(inferredVehicleCapacityKg('40FT') ?? truckTowCapacityKg('60'), '30000');
    assert.equal(inferredVehicleCapacityKg('20FT') ?? truckTowCapacityKg('60'), '18000');
  });
});
