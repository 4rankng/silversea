/**
 * SIL-1166 — merged-group-tag: the PHÂN LOẠI "Ghép (k/N)" suffix shared by the
 * /shipments-detail ledger and the chi tiết lô pair-facts block.
 * W3A precedence (the master-plan chip law): cost side leads, rev side when
 * rev-only; a grouped lot on a count-less wire degrades to bare "Ghép".
 */
import { describe, expect, it } from 'vitest';
import { mergedGroupTag } from './merged-group-tag';

describe('mergedGroupTag', () => {
  it('null when the lot joined no group', () => {
    expect(mergedGroupTag({})).toBeNull();
    expect(mergedGroupTag({ costGroupId: null, revGroupId: null })).toBeNull();
  });

  it('rev-only lots print their rev position (1/2)', () => {
    expect(mergedGroupTag({ revGroupId: 'g-rev', revGroupOrder: 1, revGroupMemberCount: 2 })).toBe('Ghép (1/2)');
  });

  it('cost leads when the lot rides both dimensions', () => {
    expect(mergedGroupTag({
      costGroupId: 'g-cost', costGroupOrder: 2, costGroupMemberCount: 3,
      revGroupId: 'g-rev', revGroupOrder: 1, revGroupMemberCount: 2,
    })).toBe('Ghép (2/3)');
  });

  it('a grouped lot on a count-less wire degrades to bare "Ghép" — never fabricates k/N', () => {
    expect(mergedGroupTag({ revGroupId: 'g-rev' })).toBe('Ghép');
    expect(mergedGroupTag({ revGroupId: 'g-rev', revGroupOrder: 1 })).toBe('Ghép');
  });
});
