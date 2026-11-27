/**
 * SIL-753 / SIL-708 / HOT-03 (27/11):
 * - Unassign ("Hủy phân xe") now persists `plannedCarrierType = null` (SIL-708),
 *   so unassigned rows never carry `'OWN'` and always return `carrierName: null`.
 * - An explicit `'OWN'` allocation (assigned to SilverSea fleet on `/dispatch`
 *   before a specific plate is picked, or with a plate/live trip) returns
 *   `INTERNAL_FLEET_CARRIER_NAME` ('SilverSea') so `/dispatch-detail` renders
 *   'SilverSea' + 'Chờ chọn xe' rather than dropping the fleet identity.
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

describe('detailed-plan dispatch payload carrier identity (SIL-708 + HOT-03)', () => {
  const marker = "carrierName: row.plannedCarrierType === 'OWN'";
  const start = detailPlanRead.indexOf(marker);
  assert.ok(start > 0, 'dispatch payload must derive carrierName from the plan row');
  const block = detailPlanRead
    .slice(start, detailPlanRead.indexOf('externalCarrierId: row.plannedExternalCarrierId', start))
    .replace(/^\s*\/\/.*$/gm, '');

  it("grants 'SilverSea' to explicit OWN allocations while null carrierType reads null", () => {
    assert.match(block, /carrierName: row\.plannedCarrierType === 'OWN'\s*\n\s*\?\s*INTERNAL_FLEET_CARRIER_NAME/);
    assert.match(block, /row\.plannedExternalCarrierId/);
    assert.match(block, /:\s*null,/);
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
      /carrierName: input\.carrierType === 'OWN'\s*\n\s*\?\s*INTERNAL_FLEET_CARRIER_NAME\s*\n\s*:\s*carrierName/,
      'explicit OWN plan save echoes INTERNAL_FLEET_CARRIER_NAME; null carrierType echoes null',
    );
  });
});
