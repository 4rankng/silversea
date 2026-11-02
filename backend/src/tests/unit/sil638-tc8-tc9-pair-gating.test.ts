/**
 * SIL-638 (id 742) TC4(BE) / TC8 / TC9 — the Kết hợp sequential gating law
 * (driver app lock + write-side sequencing + the e-POD-optional unlock).
 *
 * These laws live in three db-bound services (driver-journey-board's
 * pairLocked, driver-fulfillment's assertKetHopSequencingAllowedTx,
 * trip-pod's getDriverCompletionEvidenceStatus). Per the module's BE
 * unit-only convention the decision law is mirrored here as pure functions
 * wired into those services, so every QA-relevant behavior is unit-pinned:
 *
 * TC8 — thẻ Lệnh 2 of an ACTIVE Kết hợp pair is LOCKED (read-only, the DOC
 *       message "Cần hoàn thành trả hàng lệnh trước để mở khóa") while
 *       Lệnh 1 is unfinished; the write side refuses the start with the
 *       sequencing message.
 * TC9 — completing Lệnh 1's return UNLOCKS Lệnh 2 immediately; completion is
 *       gated by the delivered milestone ONLY — e-POD photos are optional
 *       (owner ruling card 261022213755a, reaffirmed by TC9's v2 spec:
 *       "KHÔNG chặn vì thiếu ảnh e-POD/phiếu hạ bãi").
 * TC4 — a Kẹp pair NEVER gates: both cards stay active and the driver may
 *       update either leg in any order (BE half: the write gate and the lock
 *       stay closed for KEP pairs — the app surface itself is ruled
 *       separately).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  completionEvidenceReady,
  driverBoardPairLocked,
  firstKetHopLegFinished,
  KET_HOP_SEQUENCE_BLOCK_MESSAGE,
  ketHopSequenceGateVerdict,
  PAIR_LOCKED_MESSAGE,
  type KetHopGateFacts,
} from '../../services/trip-pair-rules.service';

const facts = (over: Partial<KetHopGateFacts> = {}): KetHopGateFacts => ({
  pairStatus: 'ACTIVE',
  pairKind: 'KET_HOP',
  pairOrder: 2,
  hasFirstTrip: true,
  firstTripStatus: 'IN_TRANSIT',
  firstEvidenceReady: false,
  ...over,
});

describe('SIL-638 TC8 — Lệnh 2 of an ACTIVE Kết hợp pair is locked until Lệnh 1 finishes', () => {
  it('Lệnh 2 locked while Lệnh 1 is IN_TRANSIT — the board card and the message are the DOC verbatim text', () => {
    assert.equal(driverBoardPairLocked(facts()), true);
    assert.equal(PAIR_LOCKED_MESSAGE, 'Cần hoàn thành trả hàng lệnh trước để mở khóa');
  });

  it('the write gate refuses Lệnh 2\'s start with the sequencing message while Lệnh 1 runs', () => {
    assert.equal(ketHopSequenceGateVerdict(facts()), 'block');
    assert.equal(KET_HOP_SEQUENCE_BLOCK_MESSAGE, 'Đây là Lệnh 2 của cặp kết hợp: hãy hoàn thành trả hàng Lệnh 1 trước khi bắt đầu lệnh này.');
  });

  it('Lệnh 1 (order 1) and unpaired trips never lock — the lock is the order-2 side only', () => {
    assert.equal(driverBoardPairLocked(facts({ pairOrder: 1 })), false);
    assert.equal(ketHopSequenceGateVerdict(facts({ pairOrder: 1 })), 'allow');
    assert.equal(driverBoardPairLocked(facts({ pairStatus: null, pairKind: null, pairOrder: null })), false);
    assert.equal(ketHopSequenceGateVerdict(facts({ pairStatus: 'CANCELED', pairKind: null, pairOrder: null })), 'allow');
  });

  it('a non-ACTIVE pair (already dissolved) keeps Lệnh 2 open', () => {
    assert.equal(driverBoardPairLocked(facts({ pairStatus: 'COMPLETED' })), false);
    assert.equal(ketHopSequenceGateVerdict(facts({ pairStatus: 'COMPLETED' })), 'allow');
  });

  it('a missing first-trip row cannot lock the pair (board law: firstTripId is required)', () => {
    assert.equal(driverBoardPairLocked(facts({ hasFirstTrip: false })), false);
  });
});

describe('SIL-638 TC9 — completing Lệnh 1\'s return unlocks Lệnh 2 immediately, e-POD optional', () => {
  it('Lệnh 1 COMPLETED → the lock releases with NO e-POD evidence present', () => {
    assert.equal(firstKetHopLegFinished(facts({ firstTripStatus: 'COMPLETED', firstEvidenceReady: false })), true);
    assert.equal(driverBoardPairLocked(facts({ firstTripStatus: 'COMPLETED', firstEvidenceReady: false })), false);
    assert.equal(ketHopSequenceGateVerdict(facts({ firstTripStatus: 'COMPLETED', firstEvidenceReady: false })), 'allow');
  });

  it('evidence-ready Lệnh 1 unlocks too — the board\'s same readiness signal', () => {
    assert.equal(firstKetHopLegFinished(facts({ firstTripStatus: 'IN_TRANSIT', firstEvidenceReady: true })), true);
    assert.equal(driverBoardPairLocked(facts({ firstTripStatus: 'IN_TRANSIT', firstEvidenceReady: true })), false);
  });

  it('completion readiness is the delivered milestone ONLY — e-POD facts never gate (ruling 261022213755a)', () => {
    // 0 uploads ("Ảnh 0/3, Chứng từ 0/2" — the QA TC9 drive) still completes.
    assert.equal(completionEvidenceReady({ hasDeliveredMilestone: true }), true);
    // Missing the delivered milestone blocks completion no matter what was uploaded.
    assert.equal(completionEvidenceReady({ hasDeliveredMilestone: false }), false);
  });

  it('an unfinished Lệnh 1 keeps Lệnh 2 locked — "unfinished" is not COMPLETED and not evidence-ready', () => {
    assert.equal(firstKetHopLegFinished(facts()), false);
    assert.equal(driverBoardPairLocked(facts()), true);
  });
});

describe('SIL-638 TC4 (BE) — a Kẹp pair never gates: both legs stay active in any order', () => {
  it('the write gate allows Lệnh 2 of a KEP pair even while Lệnh 1 is unfinished', () => {
    assert.equal(ketHopSequenceGateVerdict(facts({ pairKind: 'KEP' })), 'allow');
  });

  it('the board never locks the order-2 Kẹp card (both cards active — no forced order)', () => {
    assert.equal(driverBoardPairLocked(facts({ pairKind: 'KEP' })), false);
  });
});
