/**
 * SIL-939 — LCL xe tải 100% xe ngoài trong "Sửa điều phối" từng lô
 * (/dispatch-detail, KB §9.2 K9.9, FB-090 sourcing law).
 *
 * QA fail staging df7b2a73: the per-lot dispatch editor accepted the
 * internal fleet (SilverSea — xe nội bộ) for an LCL cost group on a truck
 * tonnage class (5T) — through the carrier pick, the save AND (for legacy
 * data) the issue step. The group dialog (Gán xe nhóm, SIL-545) already
 * refuses this in lcl-grouping.service.ts; the atomic plan save had no
 * guard.
 *
 * Pinned here as source-wiring scans in the unit-only tree (2026-10-19
 * owner ruling: the db-bound guards cannot boot); the behavioral half runs
 * against the staging build by QA.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const detailPlanWrite = readFileSync(
  path.resolve(import.meta.dirname, '../../services/dispatch-planning-detail-plan.service.ts'),
  'utf8',
);

describe('SIL-939 — atomic plan save refuses the internal fleet on LCL truck classes', () => {
  const marker = 'export async function updateDispatchDetailPlanInTx';
  const start = detailPlanWrite.indexOf(marker);
  assert.ok(start > 0, 'the atomic plan save must exist');

  it('guards OWN carrier assignment with the FB-090 sourcing rule', () => {
    const guardStart = detailPlanWrite.indexOf("if (input.carrierType === 'OWN' && shipment.cargoMode === 'LCL'", start);
    assert.ok(guardStart > 0, 'the save must gate OWN on LCL lots through the cost vehicle class');
    const block = detailPlanWrite
      .slice(guardStart, detailPlanWrite.indexOf('const [fulfillment]', guardStart))
      .replace(/^\s*\/\/.*$/gm, '');
    // The class must resolve through the shared rule — never an ad-hoc guess.
    assert.match(block, /lclVehicleSourcingRule\(\s*costClass\.isContainer\s*\) === LclVehicleSourcing\.EXTERNAL_ONLY/);
    // The refusal fires BEFORE any write (all-or-nothing): an ApiError, not a warning.
    assert.match(block, /throw new ApiError\(400, `Hàng lẻ xe tải 100% xe ngoài — không thể chọn Đội xe nội bộ/);
  });

  it('the guard runs inside the transaction before the fulfillment lock', () => {
    // All-or-nothing law: the guard must sit before the fulfillment row lock
    // (the first write-adjacent step) so a refused save changes nothing.
    const guardStart = detailPlanWrite.indexOf("if (input.carrierType === 'OWN' && shipment.cargoMode === 'LCL'", start);
    const fulfillmentLock = detailPlanWrite.indexOf('.for(\'update\')', guardStart);
    assert.ok(fulfillmentLock > guardStart, 'the sourcing guard precedes the fulfillment lock');
  });

  it('a lot without a cost class is not judged (never guess the kind)', () => {
    const guardStart = detailPlanWrite.indexOf("if (input.carrierType === 'OWN' && shipment.cargoMode === 'LCL'", start);
    const block = detailPlanWrite.slice(guardStart, guardStart + 900);
    assert.match(block, /costVehicleClassId != null/, 'the class link is required before the rule fires');
  });
});
