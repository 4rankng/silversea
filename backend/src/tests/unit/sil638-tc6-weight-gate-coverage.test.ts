/**
 * SIL-638 (id 742) TC6(2) — the soft weight warning must actually fire on the
 * path QA used. QA 01/11: 2 legs of 20ft at 60,000 kg on 28/12 SAVED with only
 * the success toast — the 409 KEP_WEIGHT_WARNING and its confirmation never
 * appeared, because the guard evaluated the weight law only inside the
 * window-overlap carves and read weights from surfaces QA's data left null
 * (container-linked legs ignore the lot declaration; the partner read only its
 * trip-container row).
 *
 * Fixes pinned here (guard: dispatch-resource-availability.service):
 *  - the co-rider gate: a declared Kẹp pair on ONE rig runs the weight guard
 *    even when the two windows do not overlap — the clamp carries both boxes
 *    simultaneously, the same same-rig same-day law the auto-pair pairs by;
 *  - the incoming leg's weight falls back to the lot declaration
 *    (cargoWeightKg ?? shipment.cargoWeightKg) at the issue-path call;
 *  - the partner's weight falls back to its lot declaration
 *    (containers[0].weight ?? partnerShipmentWeight) at every carve site.
 * The soft contract itself (refuse once, confirmed retry proceeds) stays
 * pinned in sil638-tc6-kep-weight-soft-warning.test.ts.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const availabilitySource = readFileSync(
  path.join(here, '../../services/dispatch-resource-availability.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  path.join(here, '../../services/dispatch-planning-commands.service.ts'),
  'utf8',
);

describe('TC6(2) — the co-rider weight gate without window overlap', () => {
  it('runs only for a declared KẸP leg with no overlap blocking row', () => {
    assert.match(
      availabilitySource,
      /if \(declaredMode === 'KEP' && !kepWeightGateRan && blocking\.length === 0 && args\.truckId != null\) \{/,
    );
  });

  it('scans same-rig LIVE trips of the same business day', () => {
    const gateBlock = availabilitySource.match(/const coRiderRows = await tx\.select\(\{[\s\S]*?\)\.from\(s\.trips\)[\s\S]*?\}\);/);
    assert.ok(gateBlock, 'the co-rider scan must exist');
    assert.match(gateBlock[0], /eq\(s\.trips\.truckId, args\.truckId\)/);
    assert.match(gateBlock[0], /inArray\(s\.trips\.status, \[TripStatus\.CREATED, TripStatus\.IN_TRANSIT\]\)/);
    assert.match(gateBlock[0], /isNull\(s\.trips\.deletedAt\)/);
  });

  it('admits only the declared share partner or the mixed-declaration candidate', () => {
    assert.match(
      availabilitySource,
      /isDeclaredKepSharePartner\(shareRequest, row, 'KEP'\)\s*\n\s*\|\| isMixedDeclarationKepCandidate\(shareRequest, row\)/,
    );
  });

  it('refuses with the KEP_WEIGHT_WARNING 409 and honors the confirmed retry', () => {
    const gateBlock = availabilitySource.match(/const coRiders = coRiderRows[\s\S]*?\n  \}\n/);
    assert.ok(gateBlock, 'the co-rider gate body must exist');
    assert.match(gateBlock[0], /kepWeightGuardOutcome\(/);
    assert.match(gateBlock[0], /KEP_WEIGHT_WARNING_MESSAGE, undefined, \{ code: KEP_WEIGHT_WARNING_CODE \}/);
    assert.match(gateBlock[0], /args\.kepWeightWarningConfirmed === true/);
  });

  it('Kết hợp never runs the weight gate (sequential reuse, no simultaneous load)', () => {
    // The co-rider gate is gated on declaredMode === 'KEP' only — KET_HOP legs
    // reach neither the carves' KEP branch nor this gate.
    assert.ok(!/declaredMode === 'KET_HOP'[\s\S]*?kepWeightGuardOutcome/.test(availabilitySource));
  });
});

describe('TC6(2) — weight evidence falls back to the lot declaration', () => {
  it('the issue path passes the lot-level weight as fallback (gate only, storage untouched)', () => {
    assert.match(
      commandsSource,
      /cargoWeightKg: cargoWeightKg \?\? shipment\.cargoWeightKg,/,
    );
    // trips.cargoWeightKg storage keeps authoritativeCargoWeightKg — the
    // fallback feeds only the gate arg of assertResourceAvailability.
    const gateCall = commandsSource.match(/await assertResourceAvailability\(tx, \{[\s\S]*?\}\);/);
    assert.ok(gateCall);
    assert.equal(gateCall[0].match(/cargoWeightKg: cargoWeightKg \?\? shipment\.cargoWeightKg,/g)?.length, 1);
  });

  it('every partner carve site reads the lot fallback when the trip container weight is null', () => {
    const fallbackUses = availabilitySource.match(/containers\[0\]\.weight \?\? (?:partner|coRider)\.partnerShipmentWeight/g) ?? [];
    assert.ok(fallbackUses.length >= 4, `all weight sites must fall back, found ${fallbackUses.length}`);
  });

  it('the conflict select carries the partner lot weight', () => {
    assert.match(availabilitySource, /partnerShipmentWeight: s\.shipments\.cargoWeightKg/);
  });
});
