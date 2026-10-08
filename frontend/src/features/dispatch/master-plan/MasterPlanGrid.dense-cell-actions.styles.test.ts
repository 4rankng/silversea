import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');

/**
 * Dense cell-action geometry — card 20261004_321 (requirement 1, AC1):
 * the PM 03/10 footnote law (card 20261002_302, pinned in
 * `MasterPlanGrid.cellactions.styles.test.ts`) is KEPT — the action sits on its
 * own right-aligned row below the values it opens. What is REPAIRED here is the
 * misfire the law's row→column flip left behind: `flex: 1 1 56px` on the cargo
 * summary and `flex: 1` on the note line's first child were HORIZONTAL sizing
 * in the old wrapping flex row (basis/grow pushed the action right). On the
 * column they became vertical inflation — a 1–2 line summary is forced to 56px
 * and the "Chi tiết" footnote drops 22–39px below the values ("khoảng trống
 * dọc lớn … bị ghim xuống đáy ô"). The footnote must hug its values; nothing
 * in the sheet may pin an action to the cell floor.
 */
describe('master-plan grid dense cell actions (card 20261004_321)', () => {
  it('keeps the cargo values block content-height so the footnote hugs its values', () => {
    const summary = css.match(/\.master-plan-grid__cargo-summary \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(summary, 'cargo summary rule must exist').toBeTruthy();
    expect(summary).toMatch(/flex:\s*0 0 auto/);
    expect(summary).not.toMatch(/flex-grow:\s*1|flex:\s*1\b|flex-basis:\s*\d|min-height/);
  });

  it('keeps the note line content-height — no stale grow can drift the note action', () => {
    const first = css.match(/\.master-plan-grid__line--notes:has\(> \.master-plan-grid__note-detail-trigger\) > :first-child \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(first, 'note-line first-child rule must exist').toBeTruthy();
    expect(first).toMatch(/flex:\s*0 0 auto/);
    expect(first).not.toMatch(/flex-grow:\s*1|flex:\s*1\b/);
  });

  it('pins nothing to the cell floor', () => {
    // The reported defect: the action glued to the cell bottom with dead space
    // above it. No auto-margin or height-stretch may reintroduce that.
    // (`min-height: 100%` on the allocation trigger is the full-cell HIT AREA
    // of the values-as-trigger contract with its content top-aligned — not a
    // bottom pin — so the stretch ban is scoped to `height: 100%`.)
    expect(css).not.toMatch(/margin-top:\s*auto/);
    expect(css).not.toMatch(/(?<!min-)height:\s*100%/);
  });

  it('keeps allocated-cell values inside the column at every width (AC3 clip class)', () => {
    // The full-cell trigger IS the affordance (values-as-trigger, no separate
    // edit button to bleed past the column edge) and the chips wrap inside the
    // cell — so no glyph or value can be cut off by the column at any width.
    const trigger = css.match(/\.master-plan-grid__allocation-trigger \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(trigger).toContain('width: 100%');
    expect(trigger).toContain('white-space: normal');
    // The cell-filling hit area keeps its value at the top of the cell — the
    // "Chưa phân bổ" text stays at the head of the cell with no dead band.
    expect(trigger).toContain('min-height: 100%');
    expect(trigger).toContain('align-items: flex-start');

    const chip = css.match(/\.master-plan-grid__chip \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(chip).toContain('max-inline-size: 100%');
    expect(chip).toContain('overflow-wrap: anywhere');
    expect(chip).toContain('white-space: normal');
    expect(chip).not.toContain('text-overflow: ellipsis');
  });
});
