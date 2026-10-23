import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260926_5 (content-shaped record, Chief 09:34) — the mobile record
// never renders a lone '—' slot. Owner redesign 23/10: the <640px surface is
// the dedicated card list; the law now lives in DispatchPlanCardList's
// routeSides: the port cells still emit the data-empty signal (the desktop
// table's honest-missing law, DSP-PORT-01), and the CARD names a missing side
// '—' inline on its own Nâng/Trả line instead of reserving a stacked slot.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('trip-card content-shaped pair logic (card 20260926_5, owner redesign 23/10)', () => {
  it('component emits data-empty on both port cells (desktop table)', () => {
    const src = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx');
    const lift = src.match(/cell--ports" data-label="Nâng hàng"([^>]*)>/);
    const drop = src.match(/cell--ports" data-label="Trả hàng"([^>]*)>/);
    expect(lift?.[1] ?? '').toContain('data-empty');
    expect(drop?.[1] ?? '').toContain('data-empty');
  });

  it('the card list renders Nâng/Trả as two one-line sides with an honest — fallback', () => {
    const card = read('src/features/dispatch/detailed-plan/DispatchPlanCardList.tsx');
    // FCL: short name first, full name fallback, then the delivery point for
    // a missing drop port — same honesty law as the table.
    expect(card).toContain("row.ports.pickupPortShortName ?? row.ports.pickupPortName ?? '—'");
    expect(card).toContain("row.customerRoute.deliveryPoint ?? '—'");
    // LCL: the shared lift/drop swap law (FB-105 §3) through the same
    // resolver the table uses.
    expect(card).toContain('resolveLiftDropPoints');
    expect(card).toContain("points.lift ?? '—'");
    expect(card).toContain("points.drop ?? '—'");
    // The old td-grid :has() full-span hacks are deleted with the bands.
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).not.toMatch(/\.detailed-plan-grid__cell--ports\[data-empty='true'\]/);
    expect(css).not.toMatch(/:has\(\.detailed-plan-grid__cell--ports/);
  });
});
