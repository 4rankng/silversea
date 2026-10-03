import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');

/**
 * Cell-action placement contract — PM ruling 2026-10-03 (card 20261002_302):
 * a cell's "Chi tiết" action is a bottom-right footnote of the cell and never
 * shares a row with the values it opens. The cargo block is a column (summary
 * full-width, action right-aligned below it) and a note line holding a detail
 * trigger stacks the note above the right-aligned action. Pins the
 * declarations, not the pixels — the browser matrix is the render rung.
 */
describe('master-plan grid cell-action placement (card 20261002_302)', () => {
  it('keeps the PM 03/10 column allocation (schedule slimmed, starved columns fed)', () => {
    // Card 20261003_303: schedule 15→10 (its date/hour/count tokens fit);
    // the freed width flows to notes +3, allocation +1, cargo +1.
    expect(css).toMatch(/\.master-plan-grid__col--schedule\s*\{\s*width:\s*10%;\s*\}/);
    expect(css).toMatch(/\.master-plan-grid__col--notes\s*\{\s*width:\s*14%;\s*\}/);
    expect(css).toMatch(/\.master-plan-grid__col--allocation\s*\{\s*width:\s*13%;\s*\}/);
    expect(css).toMatch(/\.master-plan-grid__col--cargo\s*\{\s*width:\s*11%;\s*\}/);
  });

  it('makes the cargo block a column so the Chi tiết action never sits beside the summary', () => {
    const block = css.match(/\.master-plan-grid__cargo-content\s*\{[^}]*\}/)?.[0];
    expect(block).toBeTruthy();
    expect(block).toContain('flex-direction: column;');
    expect(block).not.toContain('flex-wrap: wrap;');
    expect(block).not.toContain('justify-content: space-between;');
  });

  it('stacks a note line holding a detail trigger, instead of the old side-by-side row', () => {
    const block = css.match(/\.master-plan-grid__line--notes:has\(> \.master-plan-grid__note-detail-trigger\)\s*\{[^}]*\}/)?.[0];
    expect(block).toBeTruthy();
    expect(block).toContain('flex-direction: column;');
    expect(block).not.toContain('align-items: flex-start;');
  });

  it('right-aligns the cell actions inside their column parents', () => {
    const block = css.match(/\.master-plan-grid__container-detail-trigger,\n\.master-plan-grid__note-detail-trigger\s*\{[^}]*\}/)?.[0];
    expect(block).toBeTruthy();
    expect(block).toContain('align-self: flex-end;');
  });
});
