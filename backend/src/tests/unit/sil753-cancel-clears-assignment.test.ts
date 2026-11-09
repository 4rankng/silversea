/**
 * SIL-753 (id 873) r4 — Hủy phân xe returns the lot to TRUE 'Chưa phân xe'
 * by clearing the fulfillment's planned carrier assignment (product decision
 * 09/11: every shape — external carrier, vehicle, placeholder plate).
 *
 * QA 09/11 (staging e6db602f, dungnv, lô QA1109-753B / QA1109-753B id 1112):
 * both cancel paths (ĐIỀU PHỐI cell button, ⋯ menu) only un-issued the order
 * and the row kept reading '4GS / Chờ bổ sung biển'. Root cause: the FE's
 * follow-up savePlan(OWN + clearVehicle) 409'd — the SIL-751 status rewind
 * bumps `shipments.version` inside the same cancel, so the save's
 * expectedShipmentVersion was stale ('Lô hàng đã thay đổi').
 *
 * r4 law: the CANCELED branch of the trip status machine releases the
 * fulfillment's plan assignment in the cancel's own transaction (before the
 * rewind), so every cancel surface lands the same unassigned shape the
 * plan-read law renders as 'Chưa phân xe'; the FE handler only cancels and
 * refreshes.
 *
 * Unit pins only (no app boot, no DB — 2026-10-19 owner ruling, source-scan
 * contract style).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const machine = fs.readFileSync(
  path.resolve(process.cwd(), 'src/services/trip-status-machine.service.ts'),
  'utf8',
);
const page = fs.readFileSync(
  path.resolve(process.cwd(), '../frontend/src/pages/DispatchDetailPlanPage.tsx'),
  'utf8',
);

function canceledBranch(): string {
  const start = machine.indexOf('} else if (targetStatus === TripStatus.CANCELED)');
  const end = machine.indexOf('const completedAt = targetStatus === TripStatus.COMPLETED');
  assert.ok(start >= 0, 'the CANCELED branch must exist');
  assert.ok(end > start, 'the CANCELED branch must close before the generic transition');
  return machine.slice(start, end);
}

describe('SIL-753 r4 — the cancel clears the carrier assignment atomically', () => {
  const branch = canceledBranch();

  it('the CANCELED branch releases the fulfillment plan assignment', () => {
    const clear = branch.match(/if \(trip\.fulfillmentId != null\) \{[\s\S]*?\n      \}/)?.[0] ?? '';
    assert.notEqual(clear, '', 'a fulfillment-sourced trip must release its plan assignment');
    assert.ok(clear.includes('plannedCarrierType: \'OWN\''), "the stored shape lands on 'OWN'");
    assert.ok(clear.includes('plannedExternalCarrierId: null'), 'the external carrier id is cleared');
    assert.ok(clear.includes('plannedExternalCarrierVehicleId: null'), 'the external vehicle is cleared');
    assert.ok(clear.includes('plannedVehiclePlateNumber: null'), 'the placeholder plate (Bổ sung sau) is cleared');
    assert.ok(clear.includes('version: sql`${s.shipmentFulfillments.version} + 1`'),
      'the assignment write bumps the row version like every plan write');
  });

  it('the clear runs in the cancel transaction, before the SIL-751 rewind', () => {
    const clearIndex = branch.indexOf('SIL-753 r4');
    const rewindIndex = branch.indexOf('rewindShipmentAfterLastLiveTripCancel');
    assert.ok(clearIndex >= 0 && rewindIndex > clearIndex,
      'assignment release + status rewind share the cancel transaction, clear first');
    assert.ok(branch.includes('rewindShipmentAfterLastLiveTripCancel'),
      'the SIL-751 rewind stays in place');
  });

  it('the plate-less clear drops the stale COST-group identity (SIL-494 parity)', () => {
    assert.ok(branch.includes('planLot.costGroupId == null && planLot.actualTruckNo != null'),
      'same condition as the plan save lotIdentityReset');
    assert.ok(branch.includes('actualTruckNo: null'), 'the stale truck identity goes with the plate');
  });

  it('the FE cancel handler no longer fights the cancel with a plan save', () => {
    const handler = page.match(/const handleCancelDispatch = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
    assert.notEqual(handler, '', 'the cancel handler must exist');
    assert.ok(handler.includes('tripClient.cancelTrip'), 'the cancel still cancels the trip');
    assert.ok(handler.includes('detailPlan.refresh()'), 'the grid re-reads the cleared row');
    assert.ok(!handler.includes('savePlan'), 'no second write: the savePlan that 409’d on the rewound version is gone');
    assert.ok(!handler.includes('clearVehicle'), 'the OWN + clearVehicle cancel payload is gone with it');
  });
});
