/**
 * SIL-1048 — Gán xe trùng khung giờ khác lô: bấm 'Lưu thay đổi' không lưu,
 * không hiện hộp 'Vẫn lưu?' hay thông báo lỗi (KB §8.1.2 K8.3: "Chạy đơn
 * theo ca và khung giờ, không chặn một xe một ngày; … chỉ hiện thông báo
 * nhắc nhẹ").
 *
 * QA 25/11 (build 4b923af1): the W4C-40FT-02 plan save onto plate
 * 15E-016.26 — already running SHP-2611-00671's two legs in the same 08:00
 * window — hit the PROVEN cross-lot hard tier, whose bare 409 gave the
 * dialog no confirm and (three repros, three lots) no path forward.
 *
 * Fix (backend half): the proven cross-lot overlap for a plain (Đơn) row
 * falls through to the family's warn-once contract — 409
 * RIG_OVERLAP_COMPLETED with the named-lot copy + '. Vẫn lưu?' — which the
 * plan editor already answers with its confirm dialog and the confirmed
 * `rigOverlapCompletedConfirmed` retry (card 061026172804 flow, frontend
 * pinned separately). Demoted tiers keep their pinned laws: the
 * classification-mismatch refusal stays hard for every row, and a declared
 * pair row keeps the hard tier (a Kẹp release may overlap its one carved
 * partner, never two foreign claims).
 *
 * BE unit-only ruling: the tier selection is DB-bound and pinned by
 * source-scan, the file's established pattern.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const planSource = readFileSync(
  path.join(here, '../../services/dispatch-planning-detail-plan.service.ts'),
  'utf8',
);

describe('SIL-1048 — the proven cross-lot overlap answers the warn-once contract', () => {
  const blockStart = planSource.indexOf('if (planRowBlocked || tripConflicts.length > 0) {');
  const blockEnd = planSource.indexOf("} else if (!isDeclaredPairRow && costGroupSiblingClaim", blockStart);

  it('the proven-overlap hard throw is fenced to declared pair rows only', () => {
    const block = planSource.slice(blockStart, blockEnd);
    const hardThrowIdx = block.indexOf('if (isDeclaredPairRow) {');
    assert.ok(hardThrowIdx > 0, 'the bare hard throw must sit behind the declared-pair fence');
    const throwInside = block.slice(hardThrowIdx, hardThrowIdx + 700);
    assert.match(throwInside, /rigConflictBusyMessage\(plate,/);
    assert.ok(throwInside.indexOf('RIG_OVERLAP_COMPLETED') === -1 || throwInside.indexOf("'. Vẫn lưu?'") === -1,
      'the fenced pair-row throw stays the bare (no-confirm) refusal');
  });

  it('a plain row falls through to the RIG_OVERLAP_COMPLETED warn with the Vẫn lưu? copy', () => {
    const block = planSource.slice(blockStart, blockEnd);
    const fenceIdx = block.indexOf('if (isDeclaredPairRow) {');
    const warnIdx = block.indexOf("if (!args.confirmOverlap) {", fenceIdx);
    assert.ok(warnIdx > fenceIdx, 'the warn-once tier must follow the fence — the plain row reaches it');
    const warnBlock = block.slice(warnIdx, warnIdx + 500);
    assert.match(warnBlock, /'\. Vẫn lưu\?'/);
    assert.match(warnBlock, /code: 'RIG_OVERLAP_COMPLETED'/);
  });

  it('the classification-mismatch refusal stays unfenced — hard for every row', () => {
    const block = planSource.slice(blockStart, blockEnd);
    const mismatchIdx = block.indexOf('CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE);');
    const fenceIdx = block.indexOf('if (isDeclaredPairRow) {');
    assert.ok(mismatchIdx > 0 && mismatchIdx < fenceIdx,
      'the incompatibility refusal precedes and stays outside the pair-row fence');
  });
});
