/**
 * SIL-753 — a dispatch row must never FABRICATE a carrier. QA 08/11 (staging
 * build c4cea6b6, dungnv): after Hủy phân xe the detailed-plan ĐIỀU PHỐI cell
 * read 'SilverSea / Chưa phân xe' — the read layer stamped the internal
 * fleet's name on every OWN fulfillment, including the stored shape of "chưa
 * phân xe" (OWN + no planned plate + no live trip; the cancel flow writes
 * exactly that shape, DispatchDetailPlanPage.savePlan clearVehicle).
 *
 * Law pinned here (source scan, BE unit-only owner ruling — the service
 * imports the db): the detailed-plan dispatch payload grants 'SilverSea' only
 * when the OWN row carries a real allocation (non-empty planned plate or a
 * live trip); an unassigned row reads carrierName null, and the grid cell
 * renders the state label once instead of an invented carrier.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const detailPlanRead = readFileSync(
  path.resolve(import.meta.dirname, '../../services/dispatch-planning-detail-plan-read.service.ts'),
  'utf8',
);
const detailPlanWrite = readFileSync(
  path.resolve(import.meta.dirname, '../../services/dispatch-planning-detail-plan.service.ts'),
  'utf8',
);

describe('SIL-753 — detailed-plan dispatch payload carrier identity', () => {
  const marker = "carrierName: row.plannedCarrierType === 'OWN'";
  const start = detailPlanRead.indexOf(marker);
  assert.ok(start > 0, 'dispatch payload must derive carrierName from the plan row');
  const block = detailPlanRead
    .slice(start, detailPlanRead.indexOf('externalCarrierId: row.plannedExternalCarrierId', start))
    .replace(/^\s*\/\/.*$/gm, '');

  it("grants 'SilverSea' only to a real OWN allocation; unassigned reads null", () => {
    // Non-empty planned plate OR a live trip — both halves of the allocation test.
    assert.match(block, /row\.plannedVehiclePlateNumber != null && row\.plannedVehiclePlateNumber !== ''/);
    assert.match(block, /row\.tripId != null/);
    assert.match(block, /\?\s*INTERNAL_FLEET_CARRIER_NAME\s*\n\s*:\s*null/);
  });

  it('the savePlan response (optimistic row patch) mirrors the same law', () => {
    const marker = "carrierName: input.carrierType === 'OWN'";
    const start = detailPlanWrite.indexOf(marker);
    assert.ok(start > 0, 'savePlan response must derive carrierName from the saved row');
    const block = detailPlanWrite
      .slice(start, detailPlanWrite.indexOf('externalCarrierId: plannedExternalCarrierId', start))
      .replace(/^\s*\/\/.*$/gm, '');
    assert.match(
      block,
      /updatedFulfillment\.plannedVehiclePlateNumber \? INTERNAL_FLEET_CARRIER_NAME : null/,
      'a plate-less OWN plan save must echo carrierName null, never the fleet label',
    );
  });
});
