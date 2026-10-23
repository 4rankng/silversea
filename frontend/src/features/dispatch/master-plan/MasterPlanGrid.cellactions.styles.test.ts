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
  it('keeps the balanced column allocation of the 1200px floor (owner redesign 23/10)', () => {
    // Card 091026091550's one-line-header shares (schedule 15.5 / customer
    // 15.75 / route 17.25 …) starved the port columns to "Cả…"/"Bãi…" cuts —
    // the QA R38 defect. The owner redesign rebalances for the floor +
    // line-clamp-2 headers: THỜI GIAN 10% (~120px at the 1200px floor —
    // "thu lại ~110-130px"), KHÁCH HÀNG & TUYẾN ĐƯỜNG the widest reading
    // zone (17.5 + 14.5), Nâng/Trả 9/8.5 (đủ 1 dòng), shares summing to 96
    // so the on-demand 48px CHỌN column fits the floor exactly.
    expect(css).toMatch(/\.master-plan-grid__col--schedule\s*\{\s*width:\s*10%;\s*\}/);
    expect(css).toMatch(/\.master-plan-grid__col--notes\s*\{\s*width:\s*11\.5%;\s*\}/);
    expect(css).toMatch(/\.master-plan-grid__col--allocation\s*\{\s*width:\s*13%;\s*\}/);
    expect(css).toMatch(/\.master-plan-grid__col--cargo\s*\{\s*width:\s*12%;\s*\}/);
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
