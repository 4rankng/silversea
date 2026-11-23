// The dispatch freight freeze must validate the SAME weight the plan row
// displays. The read service wires `cargoWeightKg: containerCargoWeightKg ??
// cargoWeightKg` (container ?? lot), so a lot whose weight was declared at
// lot level shows its tấn số on /dispatch-detail — and the old container-only
// read refused the issue with "Thiếu trọng tải" on exactly those rows.
//
// deriveLotPricingGrounds does IO (tx.select), and backend tests are
// unit-only (2026-10-19 ruling), so this pins the law at the source the same
// way quote-engine-wiring.test.ts does; the live probe covers the behavior.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(
  resolve(process.cwd(), 'src/services/freight-rate-snapshot-lifecycle.service.ts'),
  'utf8',
);

const groundsBody = source.slice(
  source.indexOf('export async function deriveLotPricingGrounds'),
  source.indexOf('export async function lockShipmentFreightRate'),
);

describe('lot pricing grounds — the row-visible weight is the validated weight', () => {
  it('reads the lot-level weight alongside the anchor container weight', () => {
    assert.match(groundsBody, /cargoWeightKg:\s*s\.shipments\.cargoWeightKg/);
    assert.match(groundsBody, /cargoWeightKg:\s*s\.shipmentContainers\.cargoWeightKg/);
  });

  it('falls back to the declared lot weight only when the container row carries none', () => {
    // The fallback sits INSIDE the CONT20/CONT40 branch, guarded by a null
    // container weight and a positive finite lot weight — a zero/garbage lot
    // weight never silently prices the leg.
    assert.match(
      groundsBody,
      /containerCargoWeightKg == null && shipment\.cargoWeightKg != null[\s\S]*?Number\.isFinite\(lotWeightKg\) && lotWeightKg > 0[\s\S]*?containerCargoWeightKg = lotWeightKg;/,
    );
    // The pure classifier still blocks a genuinely weightless lot: null in,
    // MISSING_WEIGHT out — the fallback lives in the gather, never a default.
    const basis = readFileSync(resolve(process.cwd(), 'src/services/freight-lot-basis.ts'), 'utf8');
    assert.match(basis, /weightKg == null \|\| !Number\.isFinite\(weightKg\) \|\| weightKg <= 0/);
  });
});
