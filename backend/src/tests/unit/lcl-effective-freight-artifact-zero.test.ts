// SIL-814 (id 942) — the FB-145 rule-1 twin on the OVERRIDE channel,
// db-free (the lcl-effective-freight pure law, 2026-10-19 ruling).
//
// Rule 1 (snapshot channel, unchanged) already read a cited ZERO behind an
// UNGROUPED lot as UNSET — "never a stale 0₫". The override channel only
// blanked the exact awaiting-reprice citation, so a dissolved-group
// survivor still carrying a dead-group citation on a 0₫ revenue stamp
// printed a fake 0 in CƯỚC VẬN TẢI (AUTO) (and TỔNG PHẢI THU followed).
// The 24/10 law is channel-agnostic: 0 renders ONLY for a merge member
// (lô phụ nhóm ghép) or a computed / negotiated 0 (D02).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectiveLclFreight, type LclFreightChannelFacts } from '../../services/lcl-effective-freight';
import {
  REV_LOT_AWAITING_REPRICE_REASON,
  REV_LOT_MANUAL_PRICE_REASON,
  REV_LOT_MANUAL_CLEARED_REASON,
} from '../../services/lcl-rev-notes';

const ungroupedStamped = (override: { total: number | null; reason: string | null }): LclFreightChannelFacts => ({
  snapshotChannel: null,
  override: { ...override, stamped: true },
  revGroupId: null,
  revGroupOrder: null,
  cargoMode: 'LCL',
});

describe('effectiveLclFreight — a cited ZERO behind an UNGROUPED lot reads UNSET on the override channel too (SIL-814)', () => {
  it('dissolved-group survivor: 0₫ + dead-group citation → Chưa xác định, never a stale 0₫', () => {
    const result = effectiveLclFreight(ungroupedStamped({
      total: 0,
      reason: 'Ghép cước cùng Bill BL-P',
    }));
    assert.deepEqual(result, { value: null, reason: null });
  });

  it('manual-clear citation rides the same law (SIL-679 r2 kept)', () => {
    const result = effectiveLclFreight(ungroupedStamped({
      total: 0,
      reason: REV_LOT_MANUAL_CLEARED_REASON,
    }));
    assert.deepEqual(result, { value: null, reason: null });
  });

  it('awaiting-reprice citation keeps its pinned rule-2 face (blank + the wait note)', () => {
    const result = effectiveLclFreight(ungroupedStamped({
      total: 0,
      reason: REV_LOT_AWAITING_REPRICE_REASON,
    }));
    assert.deepEqual(result, { value: null, reason: REV_LOT_AWAITING_REPRICE_REASON });
  });

  it('a merge member (lô phụ nhóm ghép) keeps its law — 0₫ + the group stamp reads', () => {
    const result = effectiveLclFreight({
      snapshotChannel: null,
      override: { total: 0, reason: 'Ghép cước cùng Bill BL-P', stamped: true },
      revGroupId: 'rev-1',
      revGroupOrder: 2,
      revPrincipalRef: 'BL-P',
      cargoMode: 'LCL',
    });
    assert.deepEqual(result, { value: 0, reason: 'Ghép cước cùng Bill BL-P' });
  });

  it('a typed negotiated 0 (D02) is money — it reads with its manual note', () => {
    const result = effectiveLclFreight(ungroupedStamped({
      total: 0,
      reason: REV_LOT_MANUAL_PRICE_REASON,
    }));
    assert.deepEqual(result, { value: 0, reason: REV_LOT_MANUAL_PRICE_REASON });
  });

  it('a stamped 0 with no citation at all is a computed zero (D02) — it reads', () => {
    const result = effectiveLclFreight(ungroupedStamped({ total: 0, reason: null }));
    assert.deepEqual(result, { value: 0, reason: null });
  });

  it('a cited NON-ZERO still reads — hiding it made the merge/unmerge toasts lie (SIL-489/SIL-490)', () => {
    const result = effectiveLclFreight(ungroupedStamped({
      total: 3_952_000,
      reason: 'Đón cước chính — 100% cước thu (BL-P)',
    }));
    assert.deepEqual(result, { value: 3_952_000, reason: 'Đón cước chính — 100% cước thu (BL-P)' });
  });
});
