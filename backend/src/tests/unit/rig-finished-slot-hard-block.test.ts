/**
 * Rig-slot law (QA 26/11): a COMPLETED trip still occupies its staged rig
 * slot — a second lot assigned onto that slot is a real double-booking. The
 * refusal is the HARD RIG_OVERLAP_FINISHED_TRIP tier: the copy explains the
 * collision and never ends in 'Vẫn lưu?', and no rig gate honors the confirm
 * flag for it (the old warn-once invitation was answered by the same 409 on
 * every confirm — the slot could never be written). The date-only day claims
 * and driver-only finished overlaps keep the family's confirmable contract
 * (RIG_OVERLAP_COMPLETED + '. Vẫn lưu?'), which the soft overlap suites
 * (SIL-1032 / SIL-1048) already pin.
 *
 * BE unit-only ruling: the DB-bound gates are pinned by source-scan (same
 * idiom as sil1032-same-day-soft-overlap) plus the shared message helper
 * directly — the gate bodies run on the integration path.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  finishedTripSlotBlockedMessage,
  RIG_OVERLAP_FINISHED_TRIP_CODE,
} from '../../services/trip-pair-rules.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceSource = (name: string) =>
  readFileSync(path.join(here, '../../services', name), 'utf8');

describe('Rig-slot law — a finished trip staged slot is a hard, non-overridable refusal', () => {
  it('the code stays outside the FE soft-confirm family', () => {
    assert.equal(RIG_OVERLAP_FINISHED_TRIP_CODE, 'RIG_OVERLAP_FINISHED_TRIP');
  });

  it('the hard copy explains the real double-booking and never invites a confirm', () => {
    const withPlate = finishedTripSlotBlockedMessage(2, '15H-052.82');
    assert.match(withPlate, /Đầu xe 15H-052\.82 có 2 chuyến đã hoàn thành trùng khung giờ phân công này/);
    assert.match(withPlate, /không thể ghi đè/);
    assert.match(withPlate, /Vui lòng chọn khung giờ phân công khác\.$/);
    assert.ok(!withPlate.includes('Vẫn lưu'), 'a hard refusal never offers the confirm');
    assert.match(finishedTripSlotBlockedMessage(1, null), /^Có 1 chuyến đã hoàn thành trùng khung giờ phân công này/);
  });

  it('every rig gate (availability, plan-row guard, trip guard) throws the hard slot tier', () => {
    for (const name of [
      'dispatch-resource-availability.service.ts',
      'dispatch-planning-detail-plan.service.ts',
      'dispatch-plan-conflict-scan.service.ts',
    ]) {
      const source = serviceSource(name);
      assert.ok(source.includes('RIG_OVERLAP_FINISHED_TRIP_CODE'), `${name} must throw the hard slot tier`);
      assert.ok(source.includes('finishedTripSlotBlockedMessage'), `${name} must use the shared hard copy`);
    }
    // The availability gate keys the hard tier on the truck/trailer identity
    // inline; the plate-scoped guards partition the finished holders on their
    // staged start before the confirm guard.
    assert.ok(
      serviceSource('dispatch-resource-availability.service.ts').includes('const rigSlotConflict'),
      'the availability gate must split the finished overlap on the rig identity',
    );
    for (const name of [
      'dispatch-planning-detail-plan.service.ts',
      'dispatch-plan-conflict-scan.service.ts',
    ]) {
      assert.ok(
        serviceSource(name).includes('stagedFinishedConflicts'),
        `${name} must split the finished holders on their staged start`,
      );
    }
  });

  it('the date-only and driver-only finished overlaps keep the confirmable warn-once copy', () => {
    for (const name of [
      'dispatch-resource-availability.service.ts',
      'dispatch-planning-detail-plan.service.ts',
      'dispatch-plan-conflict-scan.service.ts',
    ]) {
      const source = serviceSource(name);
      assert.ok(
        source.includes('chuyến đã hoàn thành trùng khung giờ phân công này. Vẫn lưu?'),
        `${name} must keep the confirmable tier for the weak finished claims`,
      );
    }
    const availability = serviceSource('dispatch-resource-availability.service.ts');
    assert.match(
      availability,
      /const rigSlotConflict = completedConflicts\.some\(\(row\) =>\s*\n\s*\(args\.truckId != null && row\.truckId === args\.truckId\)/,
      'the hard tier keys on the truck/trailer identity, never on a driver-only match',
    );
  });
});
