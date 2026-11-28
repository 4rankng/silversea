// SIL-1244 (KB §2.3.5) — "lái xe nhận lệnh trong lúc Điều vận đang sửa": bản
// sửa cũ không được lưu VÀ người sửa phải được báo là công việc vừa được nhận,
// nội dung giữ để đối chiếu. The race signal is the dialog-load acceptance
// snapshot (expectedDriverAccepted) — the route-guard wiring has no db-free
// runtime seam (owner ruling 2026-10-19, source-scan pattern), so the guard is
// pinned here while the schema contract and the FE snapshot ride behavior
// tests of their own.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { atomicDispatchPlanEditSchema } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(join(here, '..', '..', 'services', 'dispatch-planning-detail-plan.service.ts'), 'utf8');

const BASE_PLAN = {
  expectedFulfillmentVersion: 1,
  expectedShipmentVersion: 1,
  carrierType: 'OWN',
  plannedRevenue: null,
  plannedCarrierCost: null,
};

describe('SIL-1244 — mid-edit reception race', () => {
  test('the wire contract carries the optional acceptance snapshot (old callers omit it)', () => {
    assert.equal(atomicDispatchPlanEditSchema.parse({ ...BASE_PLAN, expectedDriverAccepted: false }).expectedDriverAccepted, false);
    assert.equal(atomicDispatchPlanEditSchema.parse({ ...BASE_PLAN, expectedDriverAccepted: true }).expectedDriverAccepted, true);
    assert.equal('expectedDriverAccepted' in atomicDispatchPlanEditSchema.parse(BASE_PLAN), false);
  });

  test('the plan-save guard arms only on an unaccepted snapshot and names the reception', () => {
    assert.ok(serviceSource.includes('input.expectedDriverAccepted === false'),
      'the race check must key on the editor\'s unaccepted snapshot only');
    assert.ok(serviceSource.includes('Lái xe vừa nhận lệnh công việc này trong lúc bạn đang sửa'),
      'the refusal must tell the editor the work was just received');
    // The race refusal must sit in front of the terminal-state refusals so the
    // editor never reads a generic post-issuance message for a mid-edit race.
    const raceGate = serviceSource.indexOf('input.expectedDriverAccepted === false');
    const terminalGate = serviceSource.indexOf("throw new ApiError(409, 'Không thể sửa kế hoạch sau khi đã phát hành lệnh điều xe.')");
    assert.ok(raceGate > -1 && terminalGate > raceGate, 'the reception race must refuse before the generic issued-order message');
  });
});
