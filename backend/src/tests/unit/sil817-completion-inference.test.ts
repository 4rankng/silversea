// SIL-817 (id 946, PROD 13/11) — the acceptance-inference law for the driver's
// completion path. PROD trip 13 TRP-202609-0011 ran from 21/09 with no
// recorded ORDER_RECEIVED (ops "Điều phối" start + handoff UNSEEN/handler
// NULL) and the completion evidence check refused it forever — the driver had
// no reachable Hoàn tất anywhere. The law: completing an ALREADY RUNNING trip
// infers the acceptance (completionInfersAcceptance → true only for
// IN_TRANSIT); a CREATED trip is not running, so its completion still
// requires the explicit sticky-bar accept and the evidence check refuses it
// with "Còn thiếu: Nhận lệnh…". The FE complete sticky bar mirrors the same
// trip-status rule (DriverTripDetailPage SIL-817 block, component-tested).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TripStatus } from '@tingting/shared';

import { completionInfersAcceptance } from '../../services/driver-fulfillment.service';

describe('SIL-817 — completion infers acceptance exactly on a RUNNING trip', () => {
  test('an IN_TRANSIT trip infers the acceptance on completion', () => {
    assert.equal(completionInfersAcceptance(TripStatus.IN_TRANSIT), true);
  });

  test('a CREATED trip does not — the driver must accept explicitly first', () => {
    assert.equal(completionInfersAcceptance(TripStatus.CREATED), false);
  });

  test('closed statuses never infer', () => {
    assert.equal(completionInfersAcceptance(TripStatus.COMPLETED), false);
    assert.equal(completionInfersAcceptance(TripStatus.CANCELED), false);
  });
});
