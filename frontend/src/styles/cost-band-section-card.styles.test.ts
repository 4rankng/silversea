import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260926_21 — the driver trip detail cost band vs section-card collision.
 *
 * `.shipment-cost-entry` rendered as a squared full-bleed band (`border-block`
 * only, no radius) sitting directly against rounded `.driver-task-section`
 * cards (border, radius 10) — on mobile 390 the fuel card ("Báo cáo đổ dầu")
 * and the cost card read as one clipped slab: the band's top border line
 * crosses the rounded card above, and its square corners punch out of the
 * rounded page rhythm.
 *
 * Law: the band is a proper rounded section card matching `.driver-task-section`
 * chrome (border 1px var(--line) on ALL sides, border-radius 10, margin-top 10 —
 * the same 10px rhythm every section card uses). The shared class covers BOTH
 * surfaces: ShipmentCostEntryForm AND FuelRefillReportForm ("one pattern, both
 * sections").
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('cost band is a section card (card 20260926_21)', () => {
  const css = read('src/components/trip/ShipmentCostEntryForm.css');

  it('gives .shipment-cost-entry the full section-card chrome, not a border-block band', () => {
    // Anchor on the layout rule (the file also has a var-only one-liner above it).
    const block = css.match(/\.shipment-cost-entry\s*\{[^}]*display:\s*grid[^}]*\}/)?.[0] ?? '';
    expect(block, '.shipment-cost-entry base rule exists').not.toBe('');
    // Full border on all four sides — never the squared border-block band.
    expect(block).toMatch(/border:\s*1px solid var\(--line\);/);
    expect(block, 'border-block band is gone').not.toMatch(/border-block/);
    // Rounded like every .driver-task-section card.
    expect(block).toMatch(/border-radius:\s*10px;/);
    // Same 10px vertical rhythm as .driver-task-section (margin-top: 10px).
    expect(block).toMatch(/margin-top:\s*10px;/);
  });

  it('keeps .driver-task-section as the chrome reference this card mirrors', () => {
    const page = read('src/pages/DriverTripDetailPage.css');
    const block = page.match(/\.driver-task-section\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block, 'base section rule exists').not.toBe('');
    expect(block).toMatch(/border:\s*1px solid var\(--line\);/);
    expect(block).toMatch(/border-radius:\s*10px;/);
  });
});
