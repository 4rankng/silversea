/**
 * SIL-1165 — Ghép container 40FT vào cặp Kẹp phải CHẶN CỨNG (KB Ch.3
 * §3.3.6 K3.52 + Ch.4 K4.59: "Chỉ chặn cứng khi ghép container 40FT vào
 * cặp Kẹp" — không cho lưu, không có nút lưu tiếp).
 *
 * Repro (owner, build 2881141d): menu dòng 40'DC (MSKU9999150, Bill
 * W4C-40FT-01, 20.000 kg) → Ghép chuyến → Kẹp → chọn lệnh ghép cùng → hệ
 * thống CHỈ hiện cảnh báo mềm tải trọng "Vẫn lưu?" — FE chặn sau khi mở hộp
 * lưu. Fix hai tầng:
 *  - BE: POST /api/trips/pairs với bất kỳ container nào 40ft trả 400 với
 *    text DOC (SIL-638 đã có chặn cứng trong pairing core với mã 422 —
 *    ticket này đổi đúng trạng thái 400 theo acceptance; khối chặn cứng
 *    thời điểm phát lệnh giữ nguyên 409 riêng của nó).
 *  - FE: PairTripsDialog disable nút trước khi mở hộp lưu (see the dialog
 *    vitest — SIL-1165 describe).
 * KHÔNG đụng nhánh 2×20FT: SIL-1148/SIL-638 TC6(2) — quá tải 2×20' vẫn là
 * cảnh báo mềm warn-once (KEP_WEIGHT_WARNING), pinned lại ở đây.
 *
 * BE unit-only ruling: the DB-bound command is pinned by source-scan (the
 * sil1021 file's established pattern); the pure size/weight laws are pinned
 * by direct call (same shape as sil638-tc6-kep-weight-soft-warning).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  containerFootClass,
  kepContainerSizeBlockMessage,
  kepPairWeightVerdict,
  kepWeightGuardOutcome,
  KEP_CONTAINER_SIZE_BLOCK_MESSAGE,
} from '../../services/trip-pair-rules.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const pairsSource = readFileSync(
  path.join(here, '../../services/trip-pairs.service.ts'),
  'utf8',
);

describe('SIL-1165 — POST /api/trips/pairs chặn cứng 40FT vào cặp Kẹp (400)', () => {
  it('the pairing core refuses a 40ft side with ApiError 400 and the DOC text', () => {
    const coreIdx = pairsSource.indexOf('async function createTripPairCoreInTx');
    const core = pairsSource.slice(coreIdx, pairsSource.indexOf('export async function createTripPair', coreIdx));
    assert.match(core, /throw new ApiError\(400, kepSizeBlock\);/,
      'the KEP size block must answer 400 — chặn cứng, no confirm path');
    assert.doesNotMatch(core, /throw new ApiError\(422, kepSizeBlock\);/,
      'the old 422 status is superseded by the SIL-1165 acceptance');
    assert.match(core, /const kepSizeBlock = kepContainerSizeBlockMessage\(/,
      'the block reads the containers\' size/type codes (same nguồn phân loại 20/40)');
  });

  it('every proven 40ft shape blocks; 20+20 passes (containerFootClass law)', () => {
    assert.equal(kepContainerSizeBlockMessage('40DC', '20DC'), KEP_CONTAINER_SIZE_BLOCK_MESSAGE);
    assert.equal(kepContainerSizeBlockMessage('20DC', '40DC'), KEP_CONTAINER_SIZE_BLOCK_MESSAGE);
    assert.equal(kepContainerSizeBlockMessage('40HC', '40HC'), KEP_CONTAINER_SIZE_BLOCK_MESSAGE);
    assert.equal(kepContainerSizeBlockMessage('20DC', '20DV'), null);
    assert.equal(kepContainerSizeBlockMessage('20RF', '20GP'), null);
    // An unprovable shell keeps blocking — a clamp needs proof (SIL-638).
    assert.equal(kepContainerSizeBlockMessage(null, '20DC'), KEP_CONTAINER_SIZE_BLOCK_MESSAGE);
    assert.equal(containerFootClass('40DC'), '40');
    assert.equal(containerFootClass("40'"), '40');
  });
});

describe('SIL-1165 — nhánh 2×20FT giữ nguyên cảnh báo mềm', () => {
  it('a proven 2×20 overload stays the warn-once path — refuse once, confirmed retry allows', () => {
    // The repro rig: 2×20' (10.000 kg total) on an 8t declared rating.
    assert.equal(kepPairWeightVerdict('5000', '5000', '8000'), 'overload');
    assert.equal(kepWeightGuardOutcome('overload', false), 'refuse',
      'the first attempt refuses with KEP_WEIGHT_WARNING');
    assert.equal(kepWeightGuardOutcome('overload', true), 'allow',
      'the confirmed retry proceeds — soft, never a hard block');
    // Exactly at capacity is NOT overload.
    assert.equal(kepPairWeightVerdict('5000', '5000', '10000'), 'pass');
    assert.equal(kepWeightGuardOutcome('pass', false), 'allow');
  });

  it('the pairing core still carries the DOC soft warning for the saved pair', () => {
    assert.match(pairsSource, /warnings\.push\(KEP_WEIGHT_WARNING_MESSAGE\);/,
      'the 2×20 overload advisory rides the pair result warnings — unchanged');
    assert.match(pairsSource, /kepContainerSizeBlockMessage\(/,
      'the size block keeps reading the same DOC-backed pure law');
  });
});
