/**
 * SIL-668 (id 781) — pairing is MANUAL only: the automatic pairing trigger at
 * the dispatch issue path is REMOVED (owner ruling 03/11, verbatim "bỏ auto
 * pair" — ghép là tính năng THỦ CÔNG theo customer doc 2026.9.6_Logic_
 * nghiep_vu.docx Phần 2: "Cho phép Điều vận CHỌN 2 lệnh cont riêng biệt và
 * gán chung 1 xe/tài xế trong cùng 1 ngày").
 *
 * The SIL-638-BE2 auto-pair wiring (`autoPairIssuedTripInTx` +
 * `autoPairKindForClassification` + `selectAutoPairPartnerCandidate`, commit
 * cf289a89) must stay REMOVED: issuing two qualifying KẸP legs on one
 * rig/day with no dispatcher pairing action must NOT create a pair row, no
 * shared Trip_ID, no tag — the DB-level proof lives in
 * qa/2026-11-03-sil668/after.log (PHASE=after driver).
 *
 * What SURVIVES (pinned here by source-scan so the removal cannot silently
 * delete the manual feature): the manual pairing dialog (`createTripPair`)
 * keeps running through the shared core with every gate — DOC 40' Kẹp text
 * (TC6/TC2 hard block), COMBINED same-size (TC7), shell-number rule, VETC
 * toll dedup, pair salary, TC7(2) inheritance — and the preserved guard laws
 * (TC1 windows, TC2 symmetric refusal, TC8/TC9 gating) stay exported.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import {
  CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE,
  classificationMismatchShareBlockMessage,
} from '../../services/trip-pair-rules.service';

const servicesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../services');
const readService = (name: string) => readFileSync(path.join(servicesDir, name), 'utf8');

describe('SIL-668 — automatic pairing trigger removed', () => {
  it('trip-pairs.service không còn autoPairIssuedTripInTx (điểm trigger tự ghép)', () => {
    const pairsSource = readService('trip-pairs.service.ts');
    assert.doesNotMatch(pairsSource, /autoPairIssuedTripInTx/);
    assert.doesNotMatch(pairsSource, /autoPair/i);
  });

  it('trip-pair-rules.service không còn luật chọn partner tự động', () => {
    const rulesSource = readService('trip-pair-rules.service.ts');
    assert.doesNotMatch(rulesSource, /selectAutoPairPartnerCandidate/);
    assert.doesNotMatch(rulesSource, /autoPairKindForClassification/);
    assert.doesNotMatch(rulesSource, /AutoPairLegFacts/);
    assert.doesNotMatch(rulesSource, /AUTO_PAIR/);
  });

  it('issue path (dispatch-planning-commands.service) không gọi bất kỳ auto-pair nào', () => {
    const commandsSource = readService('dispatch-planning-commands.service.ts');
    assert.doesNotMatch(commandsSource, /autoPair/i);
    // The issue result no longer carries the auto-pair echo.
    assert.doesNotMatch(commandsSource, /autoPairedTrip/);
  });

  it('driver accept path vẫn sạch (trip-status-machine không gọi auto-pair)', () => {
    const statusMachine = readService('trip-status-machine.service.ts');
    assert.doesNotMatch(statusMachine, /autoPair/i);
  });
});

describe('SIL-668 — manual pairing path GIỮ NGUYÊN (ghép thủ công của Điều vận)', () => {
  it('createTripPair (dialog thủ công) chạy qua createTripPairCoreInTx', () => {
    const pairsSource = readService('trip-pairs.service.ts');
    assert.match(pairsSource, /export async function createTripPair\(/);
    assert.match(pairsSource, /createTripPairCoreInTx\(tx, \{/);
  });

  it('mọi gate đợt 1 vẫn nằm trong core — pair thủ công chạy đủ luật', () => {
    const pairsSource = readService('trip-pairs.service.ts');
    // TC6(1) — 40' Kẹp hard block, DOC text.
    assert.match(pairsSource, /kepContainerSizeBlockMessage\(/);
    // TC7(1) — kết hợp same-size.
    assert.match(pairsSource, /combinedContainerSizeBlockMessage\(/);
    // TC7(2) — kế thừa số cont từ Lệnh 1.
    assert.match(pairsSource, /containerNumberToInherit\(/);
    // TC3/TC7 — VETC 1 lần cho cả cặp (dedup lệnh 2).
    assert.match(pairsSource, /backhaulTollDeductionForSecond\(/);
    // Lương phụ phí cặp (settings-driven).
    assert.match(pairsSource, /pairSurchargeFor\(/);
    assert.match(pairsSource, /getPairSalarySettingsFrom\(/);
  });

  it('route POST /api/trips/pairs (ghép thủ công) còn mount', () => {
    const routesSource = readFileSync(
      path.resolve(servicesDir, '../routes/trips/crud.ts'),
      'utf8',
    );
    assert.match(routesSource, /router\.post\('\/pairs'/);
    assert.match(routesSource, /createTripPair\(payload/);
  });
});

describe('SIL-668 — các luật bảo toàn khác vẫn export (không regress)', () => {
  it('TC2 — từ chối đồng nhất 2 chiều (KẸP+ĐƠN cùng xe bị chặn cả 2 hướng)', () => {
    assert.equal(
      classificationMismatchShareBlockMessage('SINGLE', 'DOUBLE'),
      CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE,
    );
    assert.equal(
      classificationMismatchShareBlockMessage('DOUBLE', 'SINGLE'),
      CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE,
    );
    assert.equal(classificationMismatchShareBlockMessage('DOUBLE', 'DOUBLE'), null);
  });

  it('luật Kết hợp tuần tự (TC8/TC9) và khai báo pair carve (TC7) vẫn export', async () => {
    const rules = await import('../../services/trip-pair-rules.service');
    assert.equal(typeof rules.declaredCombinedPairCarve, 'function');
    assert.equal(typeof rules.ketHopSequenceGateVerdict, 'function');
    assert.equal(typeof rules.driverBoardPairLocked, 'function');
    assert.equal(typeof rules.declaredKepShareMode, 'function');
    assert.equal(typeof rules.isMixedDeclarationKepCandidate, 'function');
  });
});
