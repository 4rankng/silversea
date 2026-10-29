/**
 * SIL-591 (id 691) — the ghép-trả-ĐV carve-out in the trip-side rig guard.
 *
 * Customer report 29/10/2026: two LCL lots merged onto ONE truck (Ghép 2/2)
 * — issuing lot 1 succeeded, issuing lot 2 then 409'd with "Xe đầu kéo đã bị
 * trùng lịch kế hoạch" because lot 1's ACTIVE trip already holds the rig.
 * The carve-out: a blocking holder that belongs to the SAME costGroupId is
 * the group's own arrangement, never a foreign claim. Pure decision — the
 * BE unit-only ruling (2026-10-19) keeps this tree db-free.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sameCostGroupSiblings } from '../../services/dispatch-resource-availability.service';

interface Row {
  id: number;
  costGroupId: string | null;
}

describe('sameCostGroupSiblings (SIL-591 trip-side rig guard carve-out)', () => {
  const blocking: Row[] = [
    { id: 1, costGroupId: 'grp-a' }, // the merged sibling's live trip
    { id: 2, costGroupId: 'grp-b' }, // an unrelated group's lot
    { id: 3, costGroupId: null }, // an ungrouped lot
  ];

  it('carves exactly the issuing lot\'s own group siblings out of blocking', () => {
    const carved = sameCostGroupSiblings(blocking, 'grp-a');
    assert.deepEqual(carved.map((row) => row.id), [1]);
  });

  it('carves nothing for an ungrouped issuing lot (null costGroupId)', () => {
    assert.deepEqual(sameCostGroupSiblings(blocking, null), []);
    assert.deepEqual(sameCostGroupSiblings(blocking, undefined as unknown as null), []);
  });

  it('never carves holders of a DIFFERENT group or ungrouped holders', () => {
    const carved = sameCostGroupSiblings(blocking, 'grp-b');
    assert.deepEqual(carved.map((row) => row.id), [2]);
    // The ungrouped holder (id 3) and the other group (id 1) stay blocking:
    // never a third load on the group's rig.
    const remaining = blocking.filter((row) => !sameCostGroupSiblings(blocking, 'grp-a').includes(row));
    assert.deepEqual(remaining.map((row) => row.id).sort(), [2, 3]);
  });

  it('returns an empty list for empty blocking input', () => {
    assert.deepEqual(sameCostGroupSiblings([], 'grp-a'), []);
  });
});
