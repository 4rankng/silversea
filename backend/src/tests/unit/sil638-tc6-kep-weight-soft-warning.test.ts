/**
 * SIL-638 (id 742) TC6 — kẹp size/weight rules.
 *
 * DOC logic-hang-kep-kethop (owner-standard; supersedes the ticket
 * paraphrase):
 * (1) a 40' container can never form a kẹp pair — HARD block, verbatim text
 *     "Cặp kẹp chỉ áp dụng cho đúng 02 container loại 20ft";
 * (2) an overload of the two 20' boxes is a SOFT warning — the guard refuses
 *     once with the DOC verbatim toast text and the dispatcher's confirmed
 *     retry (kepWeightWarningConfirmed) proceeds. The old hard "Tổng trọng
 *     lượng hai container kẹp vượt quá tải trọng xe." 409 is retired.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  kepContainerSizeBlockMessage,
  kepPairWeightVerdict,
  kepWeightGuardOutcome,
  KEP_CONTAINER_SIZE_BLOCK_MESSAGE,
  KEP_WEIGHT_WARNING_CODE,
  KEP_WEIGHT_WARNING_MESSAGE,
} from '../../services/trip-pair-rules.service';

describe('SIL-638 TC6(1) — 40ft kẹp is a hard block with the DOC text', () => {
  it('the block message is the DOC verbatim text', () => {
    assert.equal(KEP_CONTAINER_SIZE_BLOCK_MESSAGE, 'Cặp kẹp chỉ áp dụng cho đúng 02 container loại 20ft');
  });

  it('20′ + 20′ pairs; every other proven shape blocks', () => {
    assert.equal(kepContainerSizeBlockMessage('20DV', '20DV'), null);
    assert.equal(kepContainerSizeBlockMessage('20RF', '20GP'), null);
    assert.equal(kepContainerSizeBlockMessage('40HC', '20DV'), KEP_CONTAINER_SIZE_BLOCK_MESSAGE);
    assert.equal(kepContainerSizeBlockMessage('20DV', '40HC'), KEP_CONTAINER_SIZE_BLOCK_MESSAGE);
    assert.equal(kepContainerSizeBlockMessage('40HC', '40HC'), KEP_CONTAINER_SIZE_BLOCK_MESSAGE);
  });

  it('an unprovable shell (no type code) keeps blocking — a clamp needs proof', () => {
    assert.equal(kepContainerSizeBlockMessage(null, '20DV'), KEP_CONTAINER_SIZE_BLOCK_MESSAGE);
    assert.equal(kepContainerSizeBlockMessage('20DV', ''), KEP_CONTAINER_SIZE_BLOCK_MESSAGE);
  });
});

describe('SIL-638 TC6(2) — kẹp weight overload is a soft warning', () => {
  it('the warning text and payload code are the DOC verbatim text + stable code', () => {
    assert.equal(KEP_WEIGHT_WARNING_MESSAGE, 'Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại');
    assert.equal(KEP_WEIGHT_WARNING_CODE, 'KEP_WEIGHT_WARNING');
  });

  it('overload verdict proves only with capacity + two finite weights', () => {
    assert.equal(kepPairWeightVerdict('12000', '9500', '20000'), 'overload'); // 21.5t > 20t
    assert.equal(kepPairWeightVerdict(12000, 8000, 20000), 'pass'); // exactly at capacity is NOT overload
    assert.equal(kepPairWeightVerdict(5000, 5000, 20000), 'pass');
  });

  it('missing capacity or weights stays unprovable (check skipped, advisory owns it)', () => {
    assert.equal(kepPairWeightVerdict('12000', '9500', null), 'unprovable');
    assert.equal(kepPairWeightVerdict(null, '9500', '20000'), 'unprovable');
    assert.equal(kepPairWeightVerdict('12000', 'abc', '20000'), 'unprovable');
  });

  it('the guard refuses ONCE on overload and the confirmed retry proceeds', () => {
    assert.equal(kepWeightGuardOutcome('overload', false), 'refuse');
    assert.equal(kepWeightGuardOutcome('overload', true), 'allow');
  });

  it('non-overload verdicts allow regardless of the confirm flag', () => {
    assert.equal(kepWeightGuardOutcome('pass', false), 'allow');
    assert.equal(kepWeightGuardOutcome('unprovable', false), 'allow');
  });
});
