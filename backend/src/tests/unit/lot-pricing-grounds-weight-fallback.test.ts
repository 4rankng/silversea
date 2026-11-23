// SIL-898 — the dispatch freight freeze must price the weight the plan row
// displays. The declared weight is ONE chain shared by the freeze and the
// /dispatch-detail row read (`resolveDeclaredCargoWeightKg`):
//   1. the anchor container's own column — a stored 0.00 is NOT a declaration
//      (staging 07/11: a lot declared 5000, issued fine, then the line was
//      zeroed and the same row began 409ing "Thiếu trọng tải" it did not have
//      the day before — the zero must never shadow the next source),
//   2. the declared lot weight (the 9b0b855f fallback),
//   3. the lot's own last issued trip weight (canceled retries keep it),
//   4. the booking family's unanimous declared weight ("trọng tải hàng theo
//      booking" — R3Q-676-2 inherits R3Q-676's single declared weight; a
//      disagreeing family inherits nothing).
// deriveLotPricingGrounds does IO (tx.select), and backend tests are
// unit-only (2026-10-19 ruling), so the chain is pinned at the source the
// same way the 9b0b855f law was; the pure halves are unit-tested directly.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { bookingFamilyRoot, positiveWeightKg } from '../../services/freight-lot-basis';

const lifecycleSource = readFileSync(
  resolve(process.cwd(), 'src/services/freight-rate-snapshot-lifecycle.service.ts'),
  'utf8',
);
const readSource = readFileSync(
  resolve(process.cwd(), 'src/services/dispatch-planning-detail-plan-read.service.ts'),
  'utf8',
);

const groundsBody = lifecycleSource.slice(
  lifecycleSource.indexOf('export async function deriveLotPricingGrounds'),
  lifecycleSource.indexOf('export async function lockShipmentFreightRate'),
);

describe('lot pricing grounds — the row-visible weight is the validated weight', () => {
  it('reads the lot-level weight alongside the anchor container weight', () => {
    assert.match(groundsBody, /cargoWeightKg:\s*s\.shipments\.cargoWeightKg/);
    assert.match(groundsBody, /cargoWeightKg:\s*s\.shipmentContainers\.cargoWeightKg/);
  });

  it('resolves the weight through the shared chain inside the CONT20/CONT40 branch', () => {
    assert.match(groundsBody, /\/\^\(CONT20\|CONT40\)\$\/\.test\(rateKey\)/);
    assert.match(
      groundsBody,
      /resolveDeclaredCargoWeightKg\(tx,\s*\{[\s\S]*?anchorContainerId:\s*args\.shipmentContainerId \?\? null,[\s\S]*?lotWeightKg:\s*shipment\.cargoWeightKg,[\s\S]*?reference:\s*shipment\.blNumber \?\? shipment\.bookingRef,[\s\S]*?\}\);/,
    );
  });

  it('walks the chain in one exported resolver the row read shares', () => {
    // Container first — through positiveWeightKg, so a stored zero never
    // shadows the lot column (the 0.00 wipe that started SIL-898 round 8).
    assert.match(
      lifecycleSource,
      /const fromContainer = positiveWeightKg\(probe\.containerWeightKg\);\s*\n\s*if \(fromContainer != null\) return fromContainer;/,
    );
    // The lot's own last issued trip weight — the canceled-retry snapshot.
    assert.match(
      lifecycleSource,
      /from\(s\.tripContainers\)\s*\n\s*\.innerJoin\(s\.trips,[\s\S]*?orderBy\(desc\(s\.tripContainers\.id\)\)\s*\n\s*\.limit\(1\);/,
    );
    // The booking family inherits ONLY a unanimous declared weight — never a
    // default: disagreeing siblings leave the lot weightless and the dispatch
    // stays loudly blocked (card _58 law).
    assert.match(lifecycleSource, /distinct\.size === 1 \? votes\[0\]! : null/);
    // The /dispatch-detail row displays the same chain, keyed by the same
    // shipment + anchor probe the freeze builds.
    assert.match(readSource, /resolveDeclaredCargoWeightKg\(tx,\s*\{/);
    assert.match(readSource, /effectiveWeights\.get\(`\$\{row\.shipmentId\}:\$\{row\.shipmentContainerId \?\? 0\}`\)/);
  });
});

describe('positiveWeightKg — a stored zero is not a declaration', () => {
  it('accepts only positive finite kilograms', () => {
    assert.equal(positiveWeightKg('5000.00'), 5000);
    assert.equal(positiveWeightKg(5000), 5000);
    assert.equal(positiveWeightKg('5'), 5);
    assert.equal(positiveWeightKg(0.5), 0.5);
  });

  it('rejects null, blank, zero, negatives and garbage', () => {
    assert.equal(positiveWeightKg(null), null);
    assert.equal(positiveWeightKg(undefined), null);
    assert.equal(positiveWeightKg(''), null);
    assert.equal(positiveWeightKg('0.00'), null);
    assert.equal(positiveWeightKg(0), null);
    assert.equal(positiveWeightKg(-5), null);
    assert.equal(positiveWeightKg('abc'), null);
  });
});

describe('bookingFamilyRoot — the booking behind a per-container lot', () => {
  it('strips one trailing lot segment', () => {
    assert.equal(bookingFamilyRoot('R3Q-676-2'), 'R3Q-676');
    assert.equal(bookingFamilyRoot('R3Q-680-B'), 'R3Q-680');
  });

  it('keeps a single-lot booking whole instead of collapsing the family', () => {
    // 'R3Q-676' has no lot suffix — stripping '-676' would leave 'R3Q', a
    // mega-family that could inherit a stranger's weight.
    assert.equal(bookingFamilyRoot('R3Q-676'), 'R3Q-676');
    assert.equal(bookingFamilyRoot('ABC-12'), 'ABC-12');
  });

  it('is null-safe and trims', () => {
    assert.equal(bookingFamilyRoot(null), null);
    assert.equal(bookingFamilyRoot(undefined), null);
    assert.equal(bookingFamilyRoot('  '), null);
    assert.equal(bookingFamilyRoot(' R3Q-676-2 '), 'R3Q-676');
  });
});
