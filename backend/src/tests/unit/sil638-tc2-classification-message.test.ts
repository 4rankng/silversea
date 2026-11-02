/**
 * SIL-638 (id 742) TC2 — the classification-mismatch refusal. QA 01/11: a
 * ĐƠN assigned onto a vehicle already carrying a KẸP leg was rejected with
 * ONLY the generic "trùng lịch" toast — the DOC message never appeared,
 * because the plan-row guard checked the mismatch over dispatched-trip
 * conflicts only, while the Kẹp holder is ALSO a plan-row holder (the holder
 * scan keeps issued rows until completion).
 *
 * Pinned here:
 *  - the verbatim copy: "Cần cả 2 cont cùng khai báo KẸP mới cho đi chung xe";
 *  - the pure law: fires when the holder leg is a declared pair leg
 *    (DOUBLE/COMBINED) and the issuing leg is a plain ĐƠN — one direction
 *    only; the reverse (Kẹp onto a ĐƠN holder) stays the confirmable tier;
 *  - the reverse tier's copy carries the DOC wording + "Vẫn lưu?"
 *    (MIXED_DECLARATION_KEP_WARN_MESSAGE), not the generic toast;
 *  - the wiring: BOTH guards check plan-row holders' classification
 *    (crossLotConflicts) ahead of the generic overlap throw, and both warn
 *    tiers use the DOC-based warn message.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import {
  CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE,
  classificationMismatchShareBlockMessage,
  MIXED_DECLARATION_KEP_WARN_MESSAGE,
} from '../../services/trip-pair-rules.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string): string =>
  readFileSync(path.join(here, '../../services', name), 'utf8');

describe('TC2 — verbatim copy', () => {
  it('the hard refusal is the DOC text', () => {
    assert.equal(
      CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE,
      'Cần cả 2 cont cùng khai báo KẸP mới cho đi chung xe',
    );
  });

  it('the confirmable reverse direction is the DOC text + "Vẫn lưu?"', () => {
    assert.equal(MIXED_DECLARATION_KEP_WARN_MESSAGE, `${CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE} Vẫn lưu?`);
  });
});

describe('TC2 — pure mismatch law (classificationMismatchShareBlockMessage)', () => {
  it('ĐƠN issuing onto a Kẹp holder → refusal', () => {
    assert.equal(classificationMismatchShareBlockMessage('SINGLE', 'DOUBLE'), CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE);
  });

  it('ĐƠN issuing onto a Kết hợp holder → refusal', () => {
    assert.equal(classificationMismatchShareBlockMessage('SINGLE', 'COMBINED'), CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE);
  });

  it('Kẹp issuing onto a ĐƠN holder → null (confirmable tier owns that direction)', () => {
    assert.equal(classificationMismatchShareBlockMessage('DOUBLE', 'SINGLE'), null);
    assert.equal(classificationMismatchShareBlockMessage('COMBINED', 'SINGLE'), null);
  });

  it('two declared pair legs → null (their own gates)', () => {
    assert.equal(classificationMismatchShareBlockMessage('DOUBLE', 'DOUBLE'), null);
    assert.equal(classificationMismatchShareBlockMessage('COMBINED', 'COMBINED'), null);
    assert.equal(classificationMismatchShareBlockMessage('DOUBLE', 'COMBINED'), null);
  });

  it('undetermined holder classification → null (no mismatch provable)', () => {
    assert.equal(classificationMismatchShareBlockMessage('SINGLE', null), null);
    assert.equal(classificationMismatchShareBlockMessage('SINGLE', 'SINGLE'), null);
    assert.equal(classificationMismatchShareBlockMessage('SINGLE', 'LCL'), null);
  });
});

describe('TC2 — wiring: the message surfaces ahead of the generic overlap toast', () => {
  it('trip-side guard (assertResourceAvailability) throws the mismatch before the generic copy', () => {
    const source = read('dispatch-resource-availability.service.ts');
    const guardBody = source.match(/if \(blocking\.some\(\(row\) => args\.truckId != null && row\.truckId === args\.truckId\)\)[\s\S]*?\n  \}\n/);
    assert.ok(guardBody, 'truck-conflict throw block must exist');
    const mismatchIndex = guardBody[0].indexOf('CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE');
    const genericIndex = guardBody[0].indexOf("'Xe đầu kéo đã bị trùng lịch kế hoạch.'");
    assert.ok(mismatchIndex >= 0, 'the mismatch refusal must fire on the truck conflict');
    assert.ok(genericIndex >= 0, 'the generic copy stays for non-mismatch conflicts');
    assert.ok(mismatchIndex < genericIndex, 'the mismatch answers BEFORE the generic toast');
  });

  it('plan-row guard checks the holder PLAN ROWS classification too (QA path)', () => {
    const source = read('dispatch-planning-detail-plan.service.ts');
    assert.match(
      source,
      /\?\? crossLotConflicts\.find\(\(conflict\) =>\s*\n\s*classificationMismatchShareBlockMessage\(args\.classification \?\? null, conflict\.classification\) != null\)/,
      'the ĐƠN-vs-Kẹp plan-row holder must answer the DOC message, not the generic overlap',
    );
  });

  it('BOTH mixed-declaration warn tiers carry the DOC wording + "Vẫn lưu?"', () => {
    const availabilitySource = read('dispatch-resource-availability.service.ts');
    const detailPlanSource = read('dispatch-planning-detail-plan.service.ts');
    assert.match(availabilitySource, /MIXED_DECLARATION_KEP_WARN_MESSAGE/);
    assert.match(detailPlanSource, /MIXED_DECLARATION_KEP_WARN_MESSAGE/);
    assert.ok(!availabilitySource.includes("'Xe đầu kéo đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp. Vẫn lưu?'"),
      'the generic warn copy must be retired from the mixed-declaration tier');
  });
});
