/**
 * SIL-702 (id 822) — the classification law for one detailed-plan row.
 *
 * Pure unit test (no db, no app boot — see AGENTS.md §2): the module under
 * test owns the rule, the migration owns the persistence.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isStorablePlanClassification,
  LCL_PLAN_ROW_CLASSIFICATIONS,
  LCL_ROW_CLASSIFICATION_REFUSAL_MESSAGE,
} from '../../services/dispatch-plan-classification';

const here = dirname(fileURLToPath(import.meta.url));
const planServiceSource = readFileSync(join(here, '../../services/dispatch-planning-detail-plan.service.ts'), 'utf8');

describe('plan row classification law (SIL-702)', () => {
  it('an LCL lot row carries the cargo-mode pair Lẻ / Lấy Lẻ', () => {
    assert.deepEqual([...LCL_PLAN_ROW_CLASSIFICATIONS], ['LCL', 'LCL_PICKUP']);
    assert.equal(isStorablePlanClassification('LCL_SHIPMENT', 'LCL'), true);
    assert.equal(isStorablePlanClassification('LCL_SHIPMENT', 'LCL_PICKUP'), true);
  });

  it('an LCL lot row never carries a cont model', () => {
    assert.equal(isStorablePlanClassification('LCL_SHIPMENT', 'SINGLE'), false);
    assert.equal(isStorablePlanClassification('LCL_SHIPMENT', 'DOUBLE'), false);
    assert.equal(isStorablePlanClassification('LCL_SHIPMENT', 'COMBINED'), false);
  });

  it('a container row takes every classification, Lấy Lẻ included', () => {
    for (const value of ['SINGLE', 'DOUBLE', 'COMBINED', 'LCL', 'LCL_PICKUP'] as const) {
      assert.equal(isStorablePlanClassification('FCL_CONTAINER', value), true, value);
    }
  });

  it('the refusal message names both legal values', () => {
    assert.match(LCL_ROW_CLASSIFICATION_REFUSAL_MESSAGE, /Lẻ/);
    assert.match(LCL_ROW_CLASSIFICATION_REFUSAL_MESSAGE, /Lấy Lẻ/);
  });

  // The rule above only matters if the WRITE PATH enforces it. The write path
  // is db-bound (the db-bound guards cannot boot in the unit-only tree — the
  // 2026-10-19 owner ruling), so the enforcement is pinned as a source-wiring
  // scan, the repo's own idiom (see sil644-container-weight-lock.test.ts).
  it('the plan write path enforces the shared rule (not a local copy)', () => {
    assert.match(
      planServiceSource,
      /isStorablePlanClassification\(fulfillment\.fulfillmentType, input\.classification\)/,
      'the write path must call the shared law',
    );
    assert.match(
      planServiceSource,
      /fulfillment\.fulfillmentType === 'LCL_SHIPMENT'/,
      'the guard must be scoped to the LCL lot row',
    );
    assert.match(
      planServiceSource,
      /throw new ApiError\(409, LCL_ROW_CLASSIFICATION_REFUSAL_MESSAGE\)/,
      'a cont model on an LCL lot row is a business 409',
    );
    // The old local copy (the 2026-10-06 rule: only 'LCL' is legal) must be
    // GONE — it is what made the option un-storable.
    assert.doesNotMatch(
      planServiceSource,
      /input\.classification !== 'LCL'/,
      'the pre-SIL-702 local rule must not survive',
    );
  });
});
