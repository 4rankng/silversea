import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.tsx'), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Strip comments first (workboard-standard idiom): rationale prose may
  // quote the retired declarations it replaced.
  return (css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * SIL-877 (CR-009.1 EPIC 4.2) — the /dispatch master-plan board's width and
 * note-visibility contract:
 *
 * 1. The board FILLS the canvas at every width — the old ultra-wide
 *    guardrail (max-width: 1920px + margin-inline: auto, cap + center past
 *    1920) left dead whitespace beside a capped board; the % column shares
 *    now redistribute the whole full-bleed rail.
 * 2. GHI CHÚ carries a 160px min-width floor (Chromium honors min-width on
 *    <col> in table-layout: fixed) so a normal note reads comfortably at
 *    the 1440×900 acceptance width and below.
 * 3. Notes render WHOLE — the TSX no longer runs the 60-char truncateNote
 *    "…" cut; the CSS wrap law (ticket 18/11 §4.1.3 cấm cắt chữ) carries
 *    visibility and the row grows with wrapped content.
 *
 * Pins the declarations, not the pixels — the browser matrix is the render
 * rung (house styles-test idiom: CSS read from disk, regex-pinned).
 */
describe('master-plan board fills the canvas with a floored, fully visible GHI CHÚ (SIL-877 / CR-009.1)', () => {
  it('keeps no px cap and no auto-centering on the table — the board spans the full rail', () => {
    const table = rule('.master-plan-grid');
    expect(table).toContain('width: 100%');
    // The retired ultra-wide guardrail must stay retired: no px max-width
    // cap, no auto-centering that would band the board inside the canvas.
    expect(table).not.toMatch(/max-width:\s*\d/);
    expect(table).not.toContain('margin-inline: auto');
    // The horizontal-rail floor survives: below 1170px the wrapper scrolls.
    expect(table).toMatch(/min-width:\s*1170px/);
    expect(table).toMatch(/table-layout:\s*fixed/);
  });

  it('keeps the wrapper the full-bleed horizontal rail (one scrollbar, no sticky header)', () => {
    const wrapper = rule('.master-plan-grid__wrapper');
    expect(wrapper).toMatch(/overflow-x:\s*auto/);
    expect(wrapper).toMatch(/width:\s*calc\(100% \+ 2 \* var\(--app-body-pad-x, 24px\)\)/);
    expect(wrapper).toMatch(/margin-inline:\s*calc\(-1 \* var\(--app-body-pad-x, 24px\)\)/);
    // Owner directive 10/11: the document is the single vertical scroller —
    // the wrapper must never become a bounded pane again.
    expect(wrapper).not.toMatch(/max-height/);
  });

  it('floors GHI CHÚ at 160px while keeping its % share', () => {
    const col = rule('.master-plan-grid__col--notes');
    expect(col).toMatch(/width:\s*11\.5%/);
    expect(col).toMatch(/min-width:\s*160px/);
  });

  it('wraps every note line whole — no ellipsis, no clip, no nowrap on the notes cell', () => {
    const line = rule('.master-plan-grid__line--notes');
    expect(line).toMatch(/white-space:\s*normal/);
    expect(line).not.toMatch(/text-overflow/);
    const trigger = rule('.master-plan-grid__notes-trigger');
    expect(trigger).toMatch(/white-space:\s*normal/);
    expect(trigger).toMatch(/overflow:\s*visible/);
    expect(trigger).not.toMatch(/text-overflow/);
  });

  it('renders note values whole in the TSX — the truncateNote cut is gone', () => {
    // No JS-level ellipsis on any notes cell render path.
    expect(tsx).not.toContain('truncateNote');
    // The operational note renders through displayNote, whole.
    expect(tsx).toContain('displayNote(item.operationalNotes)');
    // The factory note line renders the full stored value.
    expect(tsx).toContain('`NM: ${item.factoryNotes}`');
    // SIL-877 (QA fail build 32e22c12) — the "Xem thêm" reveal is GONE from
    // the board: the note wraps whole and the note button itself opens the
    // full 'Ghi chú điều hành' / 'Ghi chú nhà máy' dialog.
    expect(tsx).not.toContain('Xem chi tiết ghi chú điều hành');
    expect(tsx).not.toContain('Xem thêm');
  });
});
