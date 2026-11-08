/**
 * SIL-750 — the manual Ghép chuyến dialog saved a PROVEN-overload Kẹp pair
 * (QA 08/11, staging build c4cea6b6: 2×12t conts on a 22t rig, trips 462/463,
 * pairId 37) with NO warning at all — the dialog closed straight to success.
 * The missing-capacity advisory (card 211026152138) covered only
 * `capacityMissing`; a proven overload fell through every branch.
 *
 * Owner law (Spec_fix Bug 1, Luật Kẹp/Kết hợp v2): quá tải ⇒ CẢNH BÁO MỀM +
 * vẫn lưu; xe chưa khai tải trọng ⇒ cảnh báo sau lưu; 40' vào cặp Kẹp ⇒ chặn
 * cứng. Only the middle-missing branch is the proven-overload advisory.
 *
 * The dialog (PairTripsDialog) already renders `result.warnings` after the
 * save and keeps itself open when one exists — the null-capacity case proved
 * that half live on staging. The fix is therefore the backend advisory:
 * createTripPairCoreInTx pushes the DOC verbatim warning when
 * kepPairWeightVerdict proves 'overload' (the same pure law the issue-path
 * TC6(2) gate runs), never a hard block here (the 409+confirm gate stays at
 * phát lệnh — SIL-674/TC6 scope, out of this ticket by the ticket's own note).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pairsSource = readFileSync(
  path.join(here, '../../services/trip-pairs.service.ts'),
  'utf8',
);

describe('SIL-750 — the manual pair saves proven overloads with the DOC soft warning', () => {
  it('createTripPairCoreInTx pushes the DOC verbatim warning on a proven overload', () => {
    const advisoryBlock = pairsSource.match(
      /if \(kepPairWeightVerdict\(locked\.first\.cargoWeightKg, locked\.second\.cargoWeightKg, firstCapacity\) === 'overload'\) \{\s*\n\s*warnings\.push\(KEP_WEIGHT_WARNING_MESSAGE\);\s*\n\s*\}/,
    );
    assert.ok(advisoryBlock, 'the proven-overload advisory must wire kepPairWeightVerdict to the DOC warning');
  });

  it('the advisory runs after the pair insert — it saves, it never blocks', () => {
    const insertIdx = pairsSource.indexOf('await tx.insert(s.tripPairs).values({');
    assert.ok(insertIdx > 0, 'the pair insert must exist');
    const advisoryIdx = pairsSource.indexOf("kepPairWeightVerdict(locked.first.cargoWeightKg, locked.second.cargoWeightKg, firstCapacity)");
    assert.ok(advisoryIdx > insertIdx, 'the advisory must be a non-blocking post-insert warning, not a pre-insert guard');
  });

  it('the advisory branch itself carries no kind fence (both pair kinds warn)', () => {
    // The branch regex in the first test matches `if (verdict...) { push }`
    // with nothing else inside — no `kind ===` gate wraps the overload
    // advisory, unlike the KẸP-only size block. (A `kind === 'KET_HOP'`
    // inheritance block legitimately sits between the insert and the
    // advisories; only the advisory's own if-condition matters.)
    const advisoryIdx = pairsSource.indexOf("kepPairWeightVerdict(locked.first.cargoWeightKg, locked.second.cargoWeightKg, firstCapacity)");
    const lineStart = pairsSource.lastIndexOf('\n', advisoryIdx) + 1;
    assert.match(pairsSource.slice(lineStart, advisoryIdx), /^\s*if \($/,
      'the overload verdict must open its own unfenced if, not sit inside a kind guard');
  });

  it('the manual dialog path never hard-blocks on weight — no KEP_WEIGHT_WARNING_CODE throw here', () => {
    assert.ok(!/KEP_WEIGHT_WARNING_CODE/.test(pairsSource),
      'the 409+confirm weight gate is the issue path only (SIL-674/TC6); the manual pair must stay save-with-warning');
  });

  it('the missing-capacity advisory stays beside the new branch (both soft tiers together)', () => {
    const advisoryBlock = pairsSource.match(/const warnings: string\[\] = \[\];[\s\S]*?serializePairRecord\(pair\), warnings/);
    assert.ok(advisoryBlock, 'the advisory block must exist');
    assert.match(advisoryBlock[0], /capacityMissing/);
    assert.match(advisoryBlock[0], /kepPairWeightVerdict/);
  });
});
