/**
 * SIL-1079 — Ghép chuyến: ô "Lệnh ghép cùng" trống, không tạo được cặp Kẹp
 * (K4.27, KB Ch.3 §3.3.1/§3.3.4 + Ch.4 §4.1.6).
 *
 * Root cause: the pair dialog's "Lệnh ghép cùng" lists only ISSUED orders
 * (dispatch.tripId != null — card 353 contract, unchanged), but the issue
 * gate (assertResourceAvailability) answered the clamp-forming shape — the
 * second plain 20' Phát lệnh onto the rig that holds ONE other plain,
 * un-paired 20' leg, same truck+driver, same business day — with a bare
 * 409 'Xe đầu kéo đã bị trùng lịch kế hoạch.' and NO confirm code. The
 * second leg could never be issued, so POST /trips/pairs never had its two
 * trips and the dropdown was empty in every QA configuration. (The declared
 * twins — kep share declared on the incoming leg — already rode the
 * confirmable MIXED_DECLARATION_KEP_WARN tier, dis-03 card 211026131857;
 * the plan-save path already warns once cross-lot, SIL-1048.)
 *
 * Fix: isKepFormingPrecursor admits exactly that one shape and the issue
 * gate refuses once with KEP_FORMING_OVERLAP_WARN_MESSAGE +
 * RIG_OVERLAP_COMPLETED — the same contract useIssueOrder already answers
 * with a confirm + retry (rigOverlapCompletedConfirmed). Guards from
 * SIL-1020 (pair stamps classification) and SIL-1021 (serialize unpair +
 * partial ACTIVE unique index) are untouched: a holder riding an ACTIVE
 * pair is a third load and keeps the hard tier (SIL-638 TC2's contract).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isKepFormingPrecursor,
  KEP_FORMING_OVERLAP_WARN_MESSAGE,
} from '../../services/trip-pair-rules.service';
import type { KepFormingHolderRow, KepFormingRequest } from '../../services/trip-pair-rules.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const availabilitySource = readFileSync(
  path.join(here, '../../services/dispatch-resource-availability.service.ts'),
  'utf8',
);
const issueOrderSource = readFileSync(
  path.join(here, '../../../../frontend/src/features/dispatch/detailed-plan/useIssueOrder.ts'),
  'utf8',
);

function req(overrides: Partial<KepFormingRequest> = {}): KepFormingRequest {
  return {
    truckId: 7,
    trailerId: 11,
    driverId: 21,
    issuingContainerIsTwentyFoot: true,
    departureDate: '2026-11-27',
    ...overrides,
  };
}

function holder(overrides: Partial<KepFormingHolderRow> = {}): KepFormingHolderRow {
  return {
    truckId: 7,
    trailerId: 11,
    driverId: 21,
    plannedStartAt: new Date('2026-11-27T01:00:00.000Z'), // 27/11 08:00 Asia/Ho_Chi_Minh
    pairStatus: null,
    ...overrides,
  };
}

describe('SIL-1079 — isKepFormingPrecursor admits exactly the clamp being assembled', () => {
  it('admits the plain 2×20\' same-rig same-day un-paired shape', () => {
    assert.equal(isKepFormingPrecursor(req(), holder()), true);
  });

  it('admits when either side leaves the mooc unset (SIL-602 pair law)', () => {
    assert.equal(isKepFormingPrecursor(req({ trailerId: null }), holder()), true);
    assert.equal(isKepFormingPrecursor(req({ trailerId: null }), holder({ trailerId: null })), true);
  });

  it('never admits a holder riding an ACTIVE pair (third load — TC2 keeps the hard tier)', () => {
    assert.equal(isKepFormingPrecursor(req(), holder({ pairStatus: 'ACTIVE' })), false);
  });

  it('never admits a different truck, driver, or two declared different moocs', () => {
    assert.equal(isKepFormingPrecursor(req({ truckId: 8 }), holder()), false);
    assert.equal(isKepFormingPrecursor(req({ driverId: 22 }), holder()), false);
    assert.equal(isKepFormingPrecursor(req({ trailerId: 12 }), holder()), false);
    assert.equal(isKepFormingPrecursor(req({ truckId: null }), holder()), false);
    assert.equal(isKepFormingPrecursor(req({ driverId: null }), holder()), false);
  });

  it('never admits a cross-day holder or one without a staged start', () => {
    assert.equal(isKepFormingPrecursor(
      req({ departureDate: '2026-11-28' }),
      holder(),
    ), false);
    assert.equal(isKepFormingPrecursor(req(), holder({ plannedStartAt: null })), false);
  });

  it('never admits a non-20\' incoming leg or a missing departure date', () => {
    assert.equal(isKepFormingPrecursor(req({ issuingContainerIsTwentyFoot: false }), holder()), false);
    assert.equal(isKepFormingPrecursor(req({ departureDate: null }), holder()), false);
  });

  it('carries the family confirm copy verbatim (warn-once, KB K4.27)', () => {
    assert.match(KEP_FORMING_OVERLAP_WARN_MESSAGE, /20 feet/);
    assert.match(KEP_FORMING_OVERLAP_WARN_MESSAGE, /Vẫn lưu\?$/);
  });
});

describe('SIL-1079 — the issue gate wires the precursor into the warn-once contract', () => {
  it('carves the precursor BEFORE the hard "trùng lịch kế hoạch" tier', () => {
    const carveAt = availabilitySource.indexOf('isKepFormingPrecursor(');
    const hardTierAt = availabilitySource.indexOf("throw new ApiError(409, 'Xe đầu kéo đã bị trùng lịch kế hoạch.')");
    assert.ok(carveAt > 0, 'precursor carve present');
    assert.ok(hardTierAt > 0, 'hard tier present');
    assert.ok(carveAt < hardTierAt, 'carve precedes the hard truck throw');
  });

  it('probes the holder for a proven 20\' box before carving', () => {
    const carve = availabilitySource.slice(
      availabilitySource.indexOf('isKepFormingPrecursor('),
      availabilitySource.indexOf("throw new ApiError(409, 'Xe đầu kéo đã bị trùng lịch kế hoạch.')"),
    );
    assert.match(carve, /tripContainers[\s\S]*containerTypes/);
    assert.match(carve, /code\?\.startsWith\('20'\)/);
  });

  it('runs the family weight gate inside the carve (overweight clamp refused-once)', () => {
    const carve = availabilitySource.slice(
      availabilitySource.indexOf('isKepFormingPrecursor('),
      availabilitySource.indexOf('kepFormingWarn = true'),
    );
    assert.match(carve, /kepWeightGuardOutcome\(/);
    assert.match(carve, /KEP_WEIGHT_WARNING_CODE/);
  });

  it('warns once with RIG_OVERLAP_COMPLETED and proceeds on the confirmed retry', () => {
    assert.match(availabilitySource, /if \(kepFormingWarn && args\.rigOverlapCompletedConfirmed !== true\) \{[\s\S]*?KEP_FORMING_OVERLAP_WARN_MESSAGE[\s\S]*?code: 'RIG_OVERLAP_COMPLETED'/);
  });

  it('keeps the carve scoped to a SINGLE holder (never a third load)', () => {
    assert.match(availabilitySource, /if \(blocking\.length === 1 && isKepFormingPrecursor\(/);
  });

  it('the FE issue hook answers RIG_OVERLAP_COMPLETED with confirm + confirmed retry via dispatchSoftConfirm', () => {
    const softConfirmSource = readFileSync(
      path.join(here, '../../../../frontend/src/features/dispatch/detailed-plan/dispatchSoftConfirm.ts'),
      'utf8',
    );
    assert.match(softConfirmSource, /rawCode === 'RIG_OVERLAP_COMPLETED'/);
    assert.match(softConfirmSource, /flag: 'rigOverlapCompletedConfirmed'/);
    assert.match(issueOrderSource, /detectIssueSoftConfirm\(issueOrderError\)/);
    assert.match(issueOrderSource, /attempt\(confirmedFlags\)/);
  });
});
