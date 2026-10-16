import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.tsx'), 'utf8');

/**
 * FB-043 (card 141026001010, re-report 2) — "bảng điều xe dòng không đều
 * nhau": on /dispatch a lot with several stacked trips rendered roughly twice
 * as tall as a single-trip lot, and the notes cell varied with it.
 *
 * Round 1 (2026-10-14) gave the DETAIL-PLAN grid a row-height contract and
 * left this grid untouched, so the regression recurred here: `MasterPlanGrid`
 * declared no budget at all — every value line wrapped freely inside a
 * `vertical-align: top` cell. Re-tuning a column cannot fix that class (each
 * rebalance just starves a different column), so the component bounds the row
 * itself: every cell wraps its content in `__cell-body`, and the desktop
 * container band gives that body a fixed height that clips.
 *
 * These pins guard the contract, not the numbers: a future edit that drops
 * the body wrapper, moves the band, or forgets the card-band reset restores
 * the defect class.
 */
describe('MasterPlanGrid uniform row-height contract (FB-043, card 141026001010)', () => {
  it('every table cell wraps its content in the shared row body', () => {
    const cells = tsx.match(/<td[^>]*className="master-plan-grid__cell[^"]*"[^>]*>/g) ?? [];
    expect(cells.length).toBeGreaterThanOrEqual(8);
    const bodies = tsx.match(/<div className="master-plan-grid__cell-body">/g) ?? [];
    // One body per cell: the schedule stacker, the ports, the cargo, the
    // allocation and the notes all ride the same budget.
    expect(bodies.length).toBe(cells.length);
  });

  it('bounds each body to one fixed height that clips, in the desktop band only', () => {
    const band = css.match(/@container\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(band, 'the (min-width: 901px) table band must exist').toBeTruthy();
    const body = band.match(/\.master-plan-grid__cell-body \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';
    expect(body, 'cell-body rule must live in the table band').toBeTruthy();
    expect(body).toMatch(/height:\s*var\(--mpg-row-h\)/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/flex-direction:\s*column/);
    // The budget itself is declared once, on the grid.
    expect(css).toMatch(/--mpg-row-h:\s*\d+px;/);
  });

  it('holds value lines to one line inside the budget and pins the row actions', () => {
    const band = css.match(/@container\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    // Column starvation can no longer re-wrap a value into a taller row.
    expect(band).toMatch(/\.master-plan-grid__cell-body \.master-plan-grid__line[\s\S]*?white-space:\s*nowrap/);
    expect(band).toMatch(/\.master-plan-grid__cell-body \.master-plan-grid__location-block/);
    // The "Chi tiết" / "Xem thêm" affordances never clip: the notes text gives
    // ground instead (the card reported the note cell varying with the row).
    expect(band).toMatch(/\.master-plan-grid__cell-body \.master-plan-grid__container-detail-trigger \{\s*\n\s*flex:\s*0 0 auto/);
    expect(band).toMatch(/\.master-plan-grid__cell-body \.master-plan-grid__note-detail-trigger \{\s*\n\s*flex:\s*0 0 auto/);
    expect(band).toMatch(/\.master-plan-grid__cell-body > \.master-plan-grid__line--notes \{[\s\S]*?overflow:\s*hidden/);
  });

  it('resets the row budget in the card band so records keep their own height', () => {
    const cardBand = css.match(/@container\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(cardBand, 'the (max-width: 900px) card band must exist').toBeTruthy();
    const reset = cardBand.match(/\.master-plan-grid__cell-body \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';
    expect(reset, 'the card band must reset the desktop row budget').toBeTruthy();
    expect(reset).toMatch(/height:\s*auto/);
    expect(reset).toMatch(/overflow:\s*visible/);
    // …and the one-line law goes with it: a stacked record wraps its values.
    expect(cardBand).toMatch(/\.master-plan-grid__line \{[\s\S]*?white-space:\s*normal/);
  });
});