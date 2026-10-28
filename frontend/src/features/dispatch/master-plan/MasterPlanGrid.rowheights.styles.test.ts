import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.tsx'), 'utf8');

/**
 * Owner redesign 23/10 (QA R38 "mess vẫn live") — the master-plan row-height
 * contract, retold on the detailed-plan pattern (commit 8a28c094).
 *
 * FB-043 (card 141026001010) fixed "dòng không đều nhau" with a FIXED-height
 * body (--mpg-row-h: 96px + overflow hidden). That fixed-height tower is what
 * the owner rejected on 23/10 as "row cao trống rỗng": every ordinary lot
 * rendered a 96px tower regardless of its content. The superseding law:
 * rows size to their CLAMPED content (70-93px) — every value line is ONE
 * nowrap ellipsized line (title carries the full value), and the body clamps
 * at the 93px row budget so a pathological lot (5+ schedule blocks) clips
 * instead of inflating the row. The <640px surface is the phone card list,
 * not a td-grid band.
 *
 * These pins guard the contract, not the numbers: a future edit that drops
 * the body wrapper, removes the clamp, or reintroduces a fixed-height
 * tower restores the defect class.
 */
describe('MasterPlanGrid content-sized row contract (owner redesign 23/10; supersedes the FB-043 fixed tower)', () => {
  it('every table cell wraps its content in the shared row body', () => {
    const cells = tsx.match(/<td[^>]*className="master-plan-grid__cell[^"]*"[^>]*>/g) ?? [];
    expect(cells.length).toBeGreaterThanOrEqual(8);
    const bodies = tsx.match(/<div className="master-plan-grid__cell-body"/g) ?? [];
    // One body per cell: the schedule stacker, the ports, the cargo, the
    // allocation and the notes all ride the same budget.
    expect(bodies.length).toBe(cells.length);
  });

  it('sizes each body to its content and clamps at the 93px row budget — no fixed-height tower', () => {
    // Anchored at line start so the select-cell's `--select .master-plan-grid__cell-body`
    // override (flex centering) cannot shadow the base rule.
    const body = css.match(/(^|\n)\.master-plan-grid__cell-body \{([\s\S]*?)\n\}/)?.[2] ?? '';
    expect(body, 'the base cell-body rule must exist').toBeTruthy();
    // Content-sized grid stack (detailed-plan pattern), never a fixed height.
    expect(body).toMatch(/display:\s*grid/);
    expect(body).toMatch(/align-content:\s*start/);
    expect(body).toMatch(/max-height:\s*77px/);
    expect(body).toMatch(/overflow:\s*hidden/);
    // The FB-043 fixed tower is dead: no row-height variable anywhere.
    expect(css).not.toMatch(/--mpg-row-h/);
    // No desktop/card container bands remain — the phone surface is the
    // MasterPlanCardList (JS-measured switch), not a td-grid band.
    expect(css).not.toContain('@container (min-width: 901px)');
    expect(css).not.toContain('@container (max-width: 900px)');
  });

  it('holds value lines to one ellipsized line; the action triggers never give ground', () => {
    const line = css.match(/\.master-plan-grid__line \{([\s\S]*?)\n\}/)?.[1] ?? '';
    // Column starvation can no longer re-wrap a value into a taller row —
    // one nowrap ellipsized line per fact, the full value in title.
    expect(line).toMatch(/white-space:\s*nowrap/);
    expect(line).toMatch(/text-overflow:\s*ellipsis/);
    // The "Chi tiết" / "Xem thêm" affordances keep their own line.
    expect(css).toMatch(/\.master-plan-grid__container-detail-trigger,\s*\n\.master-plan-grid__note-detail-trigger \{[\s\S]*?flex:\s*0 0 auto/);
  });

  it('lifts the row clamp while the inline notes editor is mounted (review H1)', () => {
    // A FAILED save renders the error line under the textarea; the 77px
    // clamp would hide the Lưu/Hủy row exactly when the user must retry or
    // cancel. The editor is a transient overlay — its cell leaves the
    // reading-row budget.
    const override = css.match(/\.master-plan-grid__cell-body:has\(> \.master-plan-grid__notes-editor\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(override, 'the :has(notes-editor) clamp override must exist').toBeTruthy();
    expect(override).toMatch(/max-height:\s*none/);
    expect(override).toMatch(/overflow:\s*visible/);
  });

  it('gives the phone surface to the card list below the 640px container width', () => {
    // The JS switch (same law as the detailed-plan grid): the table is the
    // jsdom default, the card list renders only under a real ResizeObserver.
    expect(tsx).toContain('CARD_MODE_BREAKPOINT = 640');
    expect(tsx).toContain('useCardLayoutMode');
    expect(tsx).toContain('MasterPlanCardList');
    expect(tsx).toContain("master-plan-grid__wrapper--cards");
    // The card list itself is a stacked record — its own height, value
    // lines wrap full (SIL-515; pins live with the mpcard suite).
    expect(css).toMatch(/\.mpcard-list\s*\{/);
  });

  it('SIL-581 the warning line wraps and its cell lifts the clamp — a warning never ellipsises', () => {
    // The 101px schedule slot at 768 ellipsised "Cảnh báo: Còn 1/1 cont chưa
    // chốt ngày đóng trả" to "Cảnh báo: Còn…". A warning's meaning must be
    // readable (§4 no-truncation doctrine on a status line), so the line
    // wraps and the 77px body clamp lifts for warning cells — the same
    // escape the transient notes editor already takes.
    const warn = css.match(/\.master-plan-grid__line--warning\s*\{[^}]*\}/)?.[0] ?? '';
    expect(warn, 'warning rule exists').not.toBe('');
    expect(warn).toMatch(/white-space:\s*normal;/);
    expect(warn).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.master-plan-grid__cell-body:has\(> \.master-plan-grid__line--warning\)\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/);
  });
});
