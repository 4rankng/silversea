/**
 * SIL-638 (id 742) đợt 2 — AUTO-PAIR at the dispatch issue path (QA 01/11:
 * guards đợt 1 nằm ở pair-creation gate nhưng dispatch assign/issue không
 * bao giờ tự tạo pair → đường dispatch bypass toàn bộ; TC3/TC7 FAIL).
 *
 * Pinned here (BE unit-only ruling 2026-10-19):
 *  - `autoPairKindForClassification` — DOUBLE→KEP, COMBINED→KET_HOP, plain
 *    ĐƠN/LCL never pairs.
 *  - `selectAutoPairPartnerCandidate` — the candidate law: same declared
 *    classification, same tractor, same driver, same Vietnam business day,
 *    internal fleet, unpaired partner; idempotent and race-convergent
 *    (lowest trip id wins).
 *  - the WIRING lock — the issue path (`issueOrderCreateOrUpdate`) must call
 *    `autoPairIssuedTripInTx` inside its transaction, and the auto-pair must
 *    run through the SAME core the manual dialog uses (`createTripPairCoreInTx`)
 *    so every đợt-1 gate (DOC 40' text, same-size, shell number, snapshot)
 *    and the VETC/salary/inheritance hooks run for real on the dispatch path.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import {
  autoPairKindForClassification,
  selectAutoPairPartnerCandidate,
  type AutoPairLegFacts,
} from '../../services/trip-pair-rules.service';

function vnInstant(day: number, hour: number): Date {
  return new Date(Date.UTC(2026, 9, day, hour, 0, 0));
}

function leg(overrides: Partial<AutoPairLegFacts>): AutoPairLegFacts {
  return {
    tripId: 2,
    classification: 'DOUBLE',
    truckId: 7,
    driverId: 11,
    plannedStartAt: vnInstant(31, 1), // 08:00 VN
    activeTripPairId: null,
    status: 'CREATED',
    carrierType: 'OWN',
    ...overrides,
  };
}

const issuing = {
  tripId: 9,
  classification: 'DOUBLE',
  truckId: 7,
  driverId: 11,
  plannedStartAt: vnInstant(31, 6), // 13:00 VN — cùng ngày business 31/10
};

describe('autoPairKindForClassification (SIL-638 đợt 2 — pair kind theo classification)', () => {
  it('DOUBLE → KEP (kẹp)', () => {
    assert.equal(autoPairKindForClassification('DOUBLE'), 'KEP');
  });

  it('COMBINED → KET_HOP (kết hợp)', () => {
    assert.equal(autoPairKindForClassification('COMBINED'), 'KET_HOP');
  });

  it('ĐƠN/LCL/null không bao giờ auto-pair', () => {
    assert.equal(autoPairKindForClassification('SINGLE'), null);
    assert.equal(autoPairKindForClassification('LCL'), null);
    assert.equal(autoPairKindForClassification(null), null);
    assert.equal(autoPairKindForClassification(undefined), null);
  });
});

describe('selectAutoPairPartnerCandidate (SIL-638 đợt 2 — điều kiện cặp tại issue)', () => {
  it('chọn partner cùng DOUBLE, cùng xe + tài xế + ngày business (TC3)', () => {
    const partner = selectAutoPairPartnerCandidate(issuing, [leg({})]);
    assert.equal(partner?.tripId, 2);
  });

  it('chọn partner COMBINED khi leg phát khai COMBINED (TC7)', () => {
    const partner = selectAutoPairPartnerCandidate(
      { ...issuing, classification: 'COMBINED' },
      [leg({ classification: 'COMBINED' })],
    );
    assert.equal(partner?.tripId, 2);
  });

  it('từ chối lệch classification (DOUBLE phát gặp COMBINED giữ — không auto-pair)', () => {
    assert.equal(selectAutoPairPartnerCandidate(issuing, [leg({ classification: 'COMBINED' })]), null);
  });

  it('từ chối khác xe / khác tài xế', () => {
    assert.equal(selectAutoPairPartnerCandidate(issuing, [leg({ truckId: 8 })]), null);
    assert.equal(selectAutoPairPartnerCandidate(issuing, [leg({ driverId: 12 })]), null);
  });

  it('từ chối khác ngày business (leg 1 30/10 vs leg 2 31/10)', () => {
    assert.equal(selectAutoPairPartnerCandidate(issuing, [leg({ plannedStartAt: vnInstant(30, 1) })]), null);
  });

  it('idempotent: partner đã nằm trong pair ACTIVE → không pair lại', () => {
    assert.equal(selectAutoPairPartnerCandidate(issuing, [leg({ activeTripPairId: 55 })]), null);
  });

  it('partner COMPLETED/CANCELED không đủ điều kiện', () => {
    assert.equal(selectAutoPairPartnerCandidate(issuing, [leg({ status: 'COMPLETED' })]), null);
    assert.equal(selectAutoPairPartnerCandidate(issuing, [leg({ status: 'CANCELED' })]), null);
    assert.equal(selectAutoPairPartnerCandidate(issuing, [leg({ status: null })]), null);
  });

  it('partner xe ngoài (EXTERNAL) không pair — pair law chỉ chuyến nội bộ', () => {
    assert.equal(selectAutoPairPartnerCandidate(issuing, [leg({ carrierType: 'EXTERNAL' })]), null);
  });

  it('issuing là ĐƠN / thiếu xe / thiếu tài xế / thiếu giờ chạy → null', () => {
    assert.equal(selectAutoPairPartnerCandidate({ ...issuing, classification: 'SINGLE' }, [leg({})]), null);
    assert.equal(selectAutoPairPartnerCandidate({ ...issuing, truckId: null }, [leg({})]), null);
    assert.equal(selectAutoPairPartnerCandidate({ ...issuing, driverId: null }, [leg({})]), null);
    assert.equal(selectAutoPairPartnerCandidate({ ...issuing, plannedStartAt: null }, [leg({})]), null);
  });

  it('chính leg phát (same tripId) không tự chọn mình', () => {
    assert.equal(selectAutoPairPartnerCandidate(issuing, [leg({ tripId: 9 })]), null);
  });

  it('carrierType null (sidecar thiếu) coalesce về OWN như trips-split default', () => {
    const partner = selectAutoPairPartnerCandidate(issuing, [leg({ carrierType: null })]);
    assert.equal(partner?.tripId, 2);
  });

  it('race convergence: 2 candidate hợp lệ → loweest trip id thắng (cả 2 issue chạy về một pair)', () => {
    const partner = selectAutoPairPartnerCandidate(issuing, [
      leg({ tripId: 5 }),
      leg({ tripId: 3 }),
      leg({ tripId: 4 }),
    ]);
    assert.equal(partner?.tripId, 3);
  });

  it('ngày business theo Asia/Ho_Chi_Minh — 17:00Z (00:00 VN hôm sau) là NGÀY KHÁC', () => {
    const nextDayMidnight = new Date('2026-11-01T00:30:00+07:00');
    assert.equal(selectAutoPairPartnerCandidate(issuing, [leg({ plannedStartAt: nextDayMidnight })]), null);
  });
});

describe('SIL-638 đợt 2 wiring lock — issue path tự tạo pair qua core pair thủ công', () => {
  const servicesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../services');
  const commandsSource = readFileSync(path.join(servicesDir, 'dispatch-planning-commands.service.ts'), 'utf8');
  const pairsSource = readFileSync(path.join(servicesDir, 'trip-pairs.service.ts'), 'utf8');

  it('issueOrderCreateOrUpdate gọi autoPairIssuedTripInTx trong transaction của nó', () => {
    assert.match(commandsSource, /import \{ autoPairIssuedTripInTx \} from '\.\/trip-pairs\.service';/);
    assert.match(commandsSource, /autoPairIssuedTripInTx\(tx, \{\s*\n\s*tripId: trip\.id,/);
  });

  it('autoPairIssuedTripInTx chạy qua createTripPairCoreInTx — gates đợt 1 + VETC/lương/kế thừa chạy thật', () => {
    assert.match(pairsSource, /export async function autoPairIssuedTripInTx/);
    assert.match(pairsSource, /createTripPairCoreInTx\(tx, \{\s*\n\s*firstTripId: partner\.tripId,/);
    // every pair gate stays inside the shared core (not bypassed by the auto path)
    assert.match(pairsSource, /kepContainerSizeBlockMessage\(/);
    assert.match(pairsSource, /combinedContainerSizeBlockMessage\(/);
    assert.match(pairsSource, /containerNumberToInherit\(/);
    assert.match(pairsSource, /backhaulTollDeductionForSecond\(/);
  });

  it('driver accept path (SIL-634/631 exempt) không bị đụng vào — status machine không gọi auto-pair', () => {
    const statusMachine = readFileSync(path.join(servicesDir, 'trip-status-machine.service.ts'), 'utf8');
    assert.doesNotMatch(statusMachine, /autoPair/);
  });
});
