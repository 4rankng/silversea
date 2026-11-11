// SIL-796 — the dispatch editor's "Cước thu/trả dự kiến" seed law.
// The owner ruling (04/11): a SIGNED table price is USED — a stored absent/0
// estimate resolves through its own signed table and the field carries the
// real number; a missing signed answer seeds NOTHING real and the dialog
// names the gap — never a fabricated 0. The two sides read DIFFERENT tables:
// cước thu ← the customer pricing engine preview; cước trả ← the nhà-xe
// board cascade (QA r2 proved the board price is NOT the customer total).
import { describe, expect, it } from 'vitest';
import { seededFees } from './DispatchPlanCellValues';

const draft = (overrides: Partial<{ plannedRevenue: number | ''; plannedCarrierCost: number | '' }> = {}) => ({
  plannedRevenue: 0 as number | '',
  plannedCarrierCost: 0 as number | '',
  ...overrides,
});

const AUTO_4M = { source: 'AUTO' as const, total: 4_000_000 };
const BOARD_PRICE = { price: 3_937_500, matched: 'GENERIC' as const };
const BOARD_MISS = { price: 0, matched: null };

describe('seededFees (SIL-796 r2) — cước thu side', () => {
  it('seeds an absent/0 revenue with the signed engine total', () => {
    expect(seededFees(draft(), AUTO_4M, undefined)).toEqual({ plannedRevenue: 4_000_000 });
    expect(seededFees(draft({ plannedRevenue: '' }), AUTO_4M, undefined)).toEqual({ plannedRevenue: 4_000_000 });
  });

  it('never rewrites an operator-entered revenue', () => {
    expect(seededFees(draft({ plannedRevenue: 3_500_000 }), AUTO_4M, undefined)).toBeNull();
  });

  it('a MANUAL engine answer clears a stored fake 0 and touches nothing real', () => {
    expect(seededFees(draft(), { source: 'MANUAL', total: 0 }, undefined)).toEqual({ plannedRevenue: '' });
    expect(seededFees(draft({ plannedRevenue: 3_500_000 }), { source: 'MANUAL', total: 0 }, undefined)).toBeNull();
    expect(seededFees(draft(), null, undefined)).toBeNull();
    expect(seededFees(draft(), undefined, undefined)).toBeNull();
  });
});

describe('seededFees (SIL-796 r2) — cước trả side', () => {
  it('seeds an absent/0 cost from the nhà-xe board for ANY carrier — not the customer total', () => {
    // The board answer (3.937.500) differs from the engine total (4M): the
    // seed must carry the BOARD number, never copy the thu side.
    expect(seededFees(draft(), AUTO_4M, BOARD_PRICE)).toEqual({ plannedRevenue: 4_000_000, plannedCarrierCost: 3_937_500 });
    expect(seededFees(draft({ plannedRevenue: '', plannedCarrierCost: '' }), AUTO_4M, BOARD_PRICE))
      .toEqual({ plannedRevenue: 4_000_000, plannedCarrierCost: 3_937_500 });
    // The board seed fires without a preview answer too (supplier ask landed first).
    expect(seededFees(draft({ plannedRevenue: 3_500_000 }), null, BOARD_PRICE))
      .toEqual({ plannedCarrierCost: 3_937_500 });
  });

  it('a board miss clears the stored fake 0 — the gap is named, never a 0', () => {
    expect(seededFees(draft(), AUTO_4M, BOARD_MISS)).toEqual({ plannedRevenue: 4_000_000, plannedCarrierCost: '' });
    expect(seededFees(draft({ plannedCarrierCost: 2_000_000 }), AUTO_4M, BOARD_MISS))
      .toEqual({ plannedRevenue: 4_000_000 });
    expect(seededFees(draft({ plannedCarrierCost: '' }), null, BOARD_MISS)).toBeNull();
  });

  it('never rewrites an operator-entered cost — even when the board answers', () => {
    expect(seededFees(draft({ plannedCarrierCost: 2_000_000 }), AUTO_4M, BOARD_PRICE))
      .toEqual({ plannedRevenue: 4_000_000 });
  });

  it('an idle board query (no ask possible) leaves the cost field untouched', () => {
    expect(seededFees(draft(), AUTO_4M, undefined)).toEqual({ plannedRevenue: 4_000_000 });
    expect(seededFees(draft({ plannedRevenue: 3_500_000 }), null, undefined)).toBeNull();
  });
});
