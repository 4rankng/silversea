import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { effectiveLotContainerCount, LCL_LOT_CONTAINER_COUNT } from './lcl-lot-cont';

// SIL-601 (id 702, owner ruling 30/10/2026): 1 lô hàng lẻ = 1 lô cont 1 cont.
describe('SIL-601 LCL lot container-count law', () => {
  test('an LCL lot counts as exactly 1 — never 0, never Σ over trips', () => {
    assert.equal(effectiveLotContainerCount('LCL', 0), 1);
    assert.equal(effectiveLotContainerCount('LCL', 3), LCL_LOT_CONTAINER_COUNT);
    assert.equal(effectiveLotContainerCount('LCL', null), 1);
    assert.equal(effectiveLotContainerCount('LCL', undefined), 1);
  });

  test('FCL keeps its real computed count, missing semantics included', () => {
    assert.equal(effectiveLotContainerCount('FCL', 2), 2);
    assert.equal(effectiveLotContainerCount('FCL', 0), 0);
    assert.equal(effectiveLotContainerCount('FCL', null), null);
    assert.equal(effectiveLotContainerCount('FCL', undefined), null);
  });

  test('an unknown mode is never fabricated into a count', () => {
    assert.equal(effectiveLotContainerCount(null, null), null);
    assert.equal(effectiveLotContainerCount(undefined, 4), 4);
  });
});
