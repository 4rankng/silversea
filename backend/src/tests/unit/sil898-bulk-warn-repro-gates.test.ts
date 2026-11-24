/**
 * SIL-898 (QA fail 24/11 12:37, staging 13e93679) — the two warn-tier gates
 * that blocked the bulk-release repro rows, pinned to the REAL staging data
 * (read-only DB investigation 24/11):
 *
 * Row 1 — R3M-KQ1 / RTAU4000119 (05/11 08:00→10:00 planned, truck 15H-104.03
 *         + trailer 15RM-107.28): COMPLETED trips TRP-202611-0092/0093
 *         (R4Q-676-1/2, same rig, 07:00→09:00) genuinely overlap the new
 *         window → the RIG_OVERLAP_COMPLETED warn-once is CORRECT behaviour
 *         (chạy gối đầu onto a finished trip is legal after confirm), not a
 *         false positive: the gate's status filter (COMPLETED only, not
 *         deleted) never counts the bill's own 'Đã hủy' trips.
 *
 * Row 2 — R15-DRV-KEP / RTAU4012151 (06/11 08:00, DOUBLE): the same-day
 *         SINGLE co-rider TRP-202611-0112 carries 15,000 kg; 5,000 + 15,000 =
 *         20,000 kg > the 20FT moóc bucket 18,000 kg → the KEP_WEIGHT_WARNING
 *         is the DOC's TC6(2) soft warning (each leg reads its OWN container —
 *         no DOUBLE double-count). Confirmable by design.
 *
 * Both rows therefore need the bulk confirm path (parity with the per-row
 * 'Vẫn lưu?' flow), not a gate change — the FE bulkIssueOrders suite pins the
 * retry flags; these tests pin the gate laws on the repro numbers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  kepPairWeightVerdict,
  kepWeightGuardOutcome,
  tripClaimWindowOverlaps,
  KEP_WEIGHT_WARNING_CODE,
  KEP_WEIGHT_WARNING_MESSAGE,
} from '../../services/trip-pair-rules.service';
import { inferredVehicleCapacityKg } from '../../services/dispatch-planning-utils.service';

describe('SIL-898 repro — R15-DRV-KEP Kẹp weight warn (5t + 15t vs the 18t 20FT moóc)', () => {
  it('the 20FT trailer bucket is the capacity the dispatch path resolved (18,000 kg)', () => {
    assert.equal(inferredVehicleCapacityKg('20FT'), '18000');
  });

  it('5,000 + 15,000 > 18,000 proves overload — the warn is a true positive', () => {
    assert.equal(kepPairWeightVerdict('5000.00', '15000.00', '18000'), 'overload');
  });

  it('the guard refuses once and the confirmed retry proceeds (TC6(2) contract)', () => {
    assert.equal(kepWeightGuardOutcome(kepPairWeightVerdict('5000.00', '15000.00', '18000'), false), 'refuse');
    assert.equal(kepWeightGuardOutcome(kepPairWeightVerdict('5000.00', '15000.00', '18000'), true), 'allow');
  });

  it('a 5t + 5t DOUBLE on the same rig does NOT warn — no double count', () => {
    assert.equal(kepPairWeightVerdict('5000.00', '5000.00', '18000'), 'pass');
  });

  it('the DOC warn text + code stay verbatim (the FE confirm dialog keys on them)', () => {
    assert.equal(KEP_WEIGHT_WARNING_MESSAGE, 'Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại');
    assert.equal(KEP_WEIGHT_WARNING_CODE, 'KEP_WEIGHT_WARNING');
  });
});

describe('SIL-898 repro — R3M-KQ1 completed-trip overlap warn', () => {
  // Wall times as stored on staging (naive HCM), anchored with +07:00 — the
  // same instants the gate compares.
  const incomingStart = new Date('2026-11-05T08:00:00+07:00'); // runAt
  const incomingEnd = new Date('2026-11-05T10:00:00+07:00');   // draftIssueTimesFor: runAt + 2h

  it('the completed pair TRP-202611-0092/0093 (07:00→09:00) overlaps the new window', () => {
    assert.equal(tripClaimWindowOverlaps('2026-11-05T07:00:00+07:00', '2026-11-05T09:00:00+07:00', incomingStart, incomingEnd), true);
  });

  it('the same-day canceled trip (18:00→21:22) never matches — the gate reads COMPLETED only', () => {
    assert.equal(tripClaimWindowOverlaps('2026-11-05T18:00:00+07:00', '2026-11-05T21:22:00+07:00', incomingStart, incomingEnd), false);
  });

  it('a later same-day completed trip (20:30→22:30) is not an overlap either', () => {
    assert.equal(tripClaimWindowOverlaps('2026-11-05T20:30:00+07:00', '2026-11-05T22:30:00+07:00', incomingStart, incomingEnd), false);
  });
});
