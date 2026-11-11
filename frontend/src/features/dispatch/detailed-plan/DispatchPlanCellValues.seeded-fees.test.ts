// SIL-796 — the dispatch editor's "Cước thu/trả dự kiến" seed law.
// The owner ruling (04/11): a SIGNED table price is USED — a stored absent/0
// estimate resolves through the pricing engine and the field carries the real
// number; the engine answering MANUAL (missing signed row) seeds NOTHING and
// the dialog names the gap — never a fabricated 0.
import { describe, expect, it } from 'vitest';
import { OWN_CARRIER_VALUE, seededFeesFromPreview } from './DispatchPlanCellValues';

const draft = (overrides: Partial<{ plannedRevenue: number | ''; plannedCarrierCost: number | ''; carrierValue: string }> = {}) => ({
  plannedRevenue: 0 as number | '',
  plannedCarrierCost: 0 as number | '',
  carrierValue: OWN_CARRIER_VALUE,
  ...overrides,
});

const AUTO_4M = { source: 'AUTO' as const, total: 4_000_000 };

describe('seededFeesFromPreview (SIL-796)', () => {
  it('seeds an absent/0 estimate with the signed engine total — own fleet seeds BOTH fields', () => {
    expect(seededFeesFromPreview(draft(), AUTO_4M)).toEqual({ plannedRevenue: 4_000_000, plannedCarrierCost: 4_000_000 });
    expect(seededFeesFromPreview(draft({ plannedRevenue: '', plannedCarrierCost: '' }), AUTO_4M))
      .toEqual({ plannedRevenue: 4_000_000, plannedCarrierCost: 4_000_000 });
  });

  it('seeds revenue only for an external carrier — its trả price lives outside the engine', () => {
    const external = draft({ carrierValue: 'carrier:11' });
    expect(seededFeesFromPreview(external, AUTO_4M)).toEqual({ plannedRevenue: 4_000_000, plannedCarrierCost: 0 });
  });

  it('never rewrites an operator-entered fee — a real stored value wins, the other field still seeds', () => {
    expect(seededFeesFromPreview(draft({ plannedRevenue: 3_500_000 }), AUTO_4M))
      .toEqual({ plannedRevenue: 3_500_000, plannedCarrierCost: 4_000_000 });
    expect(seededFeesFromPreview(draft({ plannedRevenue: 0, plannedCarrierCost: 2_000_000 }), AUTO_4M))
      .toEqual({ plannedRevenue: 4_000_000, plannedCarrierCost: 2_000_000 });
  });

  it('a MANUAL engine answer (missing signed row) clears a stored fake 0 and seeds nothing real', () => {
    expect(seededFeesFromPreview(draft(), { source: 'MANUAL', total: 0 }))
      .toEqual({ plannedRevenue: '', plannedCarrierCost: '' });
    // A real stored value stays; only the fake 0 goes.
    expect(seededFeesFromPreview(draft({ plannedRevenue: 3_500_000, plannedCarrierCost: 0 }), { source: 'MANUAL', total: 0 }))
      .toEqual({ plannedRevenue: 3_500_000, plannedCarrierCost: '' });
    expect(seededFeesFromPreview(draft({ plannedRevenue: 3_500_000, plannedCarrierCost: 1_200_000 }), { source: 'MANUAL', total: 0 }))
      .toBeNull();
    expect(seededFeesFromPreview(draft(), null)).toBeNull();
    expect(seededFeesFromPreview(draft(), undefined)).toBeNull();
  });
});
