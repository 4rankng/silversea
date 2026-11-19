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
 * rows size to their content — every value line reads WHOLE: ticket 18/11
 * (spec Chương 4 §4.1.3 cấm cắt chữ) supersedes the 23/10 one-line ellipsis
 * law and the 77px body clamp (data lines WRAP; row height grows with
 * wrapped content — intended). The <640px surface is the phone card list,
 * not a td-grid band.
 *
 * These pins guard the contract, not the numbers: a future edit that drops
 * the body wrapper, reintroduces a clamp/ellipsis on a data line, or
 * restores a fixed-height tower restores the defect class.
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

  it('sizes each body to its content with no reading clamp — no fixed-height tower', () => {
    // Anchored at line start so the select-cell's `--select .master-plan-grid__cell-body`
    // override (flex centering) cannot shadow the base rule.
    const body = css.match(/(^|\n)\.master-plan-grid__cell-body \{([\s\S]*?)\n\}/)?.[2] ?? '';
    expect(body, 'the base cell-body rule must exist').toBeTruthy();
    // Content-sized grid stack (detailed-plan pattern), never a fixed height.
    // ticket 18/11 (spec Chương 4 §4.1.3 cấm cắt chữ) supersedes the 77px
    // reading clamp: wrapped NHÀ MÁY / TUYẾN / CẢNG NÂNG-HẠ / GHI CHÚ content
    // must show, so the body carries NO max-height and NO overflow — the row
    // grows with its wrapped content (intended).
    expect(body).toMatch(/display:\s*grid/);
    expect(body).toMatch(/align-content:\s*start/);
    expect(body).not.toMatch(/max-height/);
    expect(body).not.toMatch(/overflow:\s*hidden/);
    // The FB-043 fixed tower is dead: no row-height variable anywhere.
    expect(css).not.toMatch(/--mpg-row-h/);
    // No desktop/card container bands remain — the phone surface is the
    // MasterPlanCardList (JS-measured switch), not a td-grid band.
    expect(css).not.toContain('@container (min-width: 901px)');
    expect(css).not.toContain('@container (max-width: 900px)');
  });

  it('lets value lines wrap fully — data cells never ellipsise (ticket 18/11); the action triggers never give ground', () => {
    const line = css.match(/\.master-plan-grid__line \{([\s\S]*?)\n\}/)?.[1] ?? '';
    // ticket 18/11 (spec Chương 4 §4.1.3 cấm cắt chữ) supersedes the 23/10
    // one-line ellipsis law (and this suite's former nowrap/ellipsis pin at
    // the same rule): NHÀ MÁY ('ASKEY-XUON'), TUYẾN ('KCN VÂN TRUNG, BẮC
    // GI'), CẢNG NÂNG/HẠ ('Cảng Lạch Hu') and GHI CHÚ ('OPS: làm hàng luồ')
    // wrap fully — no ellipsis, no clip, on any data line. The line's title
    // (set in the component) stays as a bonus, never the carrier. The
    // HEADER law is untouched: the ≥1440 band keeps th nowrap (SIL-698).
    expect(line).toMatch(/white-space:\s*normal/);
    expect(line).not.toMatch(/white-space:\s*nowrap/);
    expect(line).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(css).toMatch(/@media \(min-width: 1440px\)[\s\S]*?\.master-plan-grid thead th\s*\{[^}]*white-space:\s*nowrap/);
    // The "Chi tiết" / "Xem thêm" affordances keep their own line.
    expect(css).toMatch(/\.master-plan-grid__container-detail-trigger,\s*\n\.master-plan-grid__note-detail-trigger \{[\s\S]*?flex:\s*0 0 auto/);
  });

  it('keeps the reading-row clamp while editing — the editor is a body-portal overlay (SIL-631)', () => {
    // Review H1's clamp lift existed because the inline editor's error row
    // and Lưu/Hủy buttons lived INSIDE the 77px-clamped cell. SIL-631 (28/10)
    // moved the editor to a body portal, so the cell holds only a single
    // dimmed line while editing — the clamp lift is gone with its rationale.
    expect(css).not.toContain('master-plan-grid__notes-editing) {');
    expect(css).not.toMatch(/:has\(>\s*\.master-plan-grid__notes-(?:editor|editing)\)/);
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

  it('SIL-581 the warning line wraps — and with the clamp gone (ticket 18/11) no lift is needed', () => {
    // The 101px schedule slot at 768 ellipsised "Cảnh báo: Còn 1/1 cont chưa
    // chốt ngày đóng trả" to "Cảnh báo: Còn…". ticket 18/11 (spec Chương 4
    // §4.1.3 cấm cắt chữ) supersedes the one-line law on ALL data lines, so
    // every line wraps and the 77px body clamp is gone — the SIL-581
    // warning-only :has clamp lift is retired with the clamp it lifted.
    // A warning's meaning must stay readable (§4 doctrine on a status line).
    const warn = css.match(/\.master-plan-grid__line--warning\s*\{[^}]*\}/)?.[0] ?? '';
    expect(warn, 'warning rule exists').not.toBe('');
    expect(warn).toMatch(/white-space:\s*normal;/);
    expect(warn).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(css).not.toMatch(/\.master-plan-grid__cell-body:has\(> \.master-plan-grid__line--warning\)/);
  });
});
