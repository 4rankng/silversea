/**
 * SIL-638 (id 742) TC6(2) — the kẹp weight gate's "unprovable" branch is a
 * SOFT WARNING, not a silent allow.
 *
 * Owner DOC (ticket v2, 31/10): the TC6(2) soft warning covers BOTH shapes —
 * "tổng trọng lượng hàng khai báo lớn hơn tải trọng cho phép của xe/moóc
 * (hoặc cont chưa có dữ liệu tải trọng / xe chưa cấu hình tải moóc)" — and
 * the dispatcher's confirm proceeds ("KHÔNG chặn cứng, Điều vận vẫn bấm xác
 * nhận tiếp tục lưu để phát lệnh kịp thời").
 *
 * QA repro (ticket 02/11 12:28, build ed0056e1 — reproduced locally by
 * qa/scripts/2026-11-02-sil638-tc1-tc6-repro.mjs probe1): 2×20' legs at
 * 60,000 kg on a rig whose moóc carries no type (inferred capacity null)
 * issued one after another — the second leg SAVED SILENTLY and the KEP pair
 * row was created with no warning and no confirm. The gate read
 * kepPairWeightVerdict(60000, 60000, null) → 'unprovable' → allow. That
 * silent branch is the exact hole the DOC's missing-data branch forbids.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  kepPairWeightVerdict,
  kepWeightGuardOutcome,
  KEP_WEIGHT_WARNING_CODE,
  KEP_WEIGHT_WARNING_MESSAGE,
} from '../../services/trip-pair-rules.service';

describe('SIL-638 TC6(2) — the missing-data (unprovable) weight branch warns once', () => {
  it('an unprovable verdict on a declared kẹp pair refuses ONCE (409 KEP_WEIGHT_WARNING)', () => {
    assert.equal(kepWeightGuardOutcome('unprovable', false), 'refuse');
  });

  it('the confirmed retry proceeds — never a hard block (DOC: bấm xác nhận tiếp tục lưu)', () => {
    assert.equal(kepWeightGuardOutcome('unprovable', true), 'allow');
  });

  it('both DOC shapes land on the same soft warning (overload + unprovable)', () => {
    // (a) sum over capacity: 60,000 + 60,000 vs a 30,000 kg moóc.
    assert.equal(kepPairWeightVerdict(60000, 60000, 30000), 'overload');
    assert.equal(kepWeightGuardOutcome('overload', false), 'refuse');
    // (b) capacity missing: 60,000 + 60,000 with no configured moóc capacity.
    assert.equal(kepPairWeightVerdict('60000', '60000', null), 'unprovable');
    assert.equal(kepWeightGuardOutcome('unprovable', false), 'refuse');
    // (c) weight missing on either side: the DOC's "cont chưa có dữ liệu tải trọng".
    assert.equal(kepPairWeightVerdict(null, '60000', 30000), 'unprovable');
    assert.equal(kepWeightGuardOutcome(kepPairWeightVerdict(null, '60000', 30000), false), 'refuse');
  });

  it('a provable PASS still saves clean — no nag on a healthy clamp', () => {
    assert.equal(kepWeightGuardOutcome('pass', false), 'allow');
    assert.equal(kepWeightGuardOutcome('pass', true), 'allow');
  });

  it('the refusal payload is the DOC verbatim text + the stable code the FE confirm dialog keys on', () => {
    assert.equal(KEP_WEIGHT_WARNING_MESSAGE, 'Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại');
    assert.equal(KEP_WEIGHT_WARNING_CODE, 'KEP_WEIGHT_WARNING');
  });
});
