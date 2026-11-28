// KB ch10 (QA evidence 27/11) — the /accounting/chot-debit sticky rail pair:
// the unified action bar pins flush under the topbar as a full-width opaque
// rail with a shadow, the board's header band pins one bar-height below it
// (--debit-selection-height, measured live on .debit-page), and rows scroll
// under both cleanly. The rail can only exist because .debit-board__wrap
// stops being a scroll container at the operating widths (overflow-x: clip —
// a nested scroll container would pin the thead to the rail instead of the
// page; the MasterPlanGrid law). The Lô cell keeps an explicit daylight
// gutter so the date line and the Số Bill/Book ref never fuse.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/pages/accounting/AccountingDebitClosePage.css'),
  'utf8',
);

/** The first rule body carried by exactly this selector. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1];
  expect(body, `no rule for ${selector}`).toBeTruthy();
  return body!;
}

describe('chot-debit sticky rail — bar, header offset, untrapped scrollport', () => {
  it('the action bar is a sticky, full-bleed, opaque rail with a shadow', () => {
    const body = ruleBody('.debit-selection');
    expect(body).toMatch(/position:\s*sticky/);
    // SIL-1176: sticky insets resolve against the scrollport's PADDING edge,
    // so the bar pins flush under the topbar only through the shared
    // --sticky-thead-top negation (top: 0 landed 24px low and rows bled
    // through the gap).
    expect(body).toMatch(/top:\s*var\(--sticky-thead-top,\s*-24px\)/);
    expect(body).toMatch(/z-index:\s*\d+/);
    // The rail spans the SAME edge-to-edge width as .debit-board__wrap —
    // no scrolled row may peek beside the bar.
    expect(body).toMatch(/width:\s*calc\(100%\s*\+\s*2\s*\*\s*var\(--app-body-pad-x,\s*24px\)\)/);
    expect(body).toMatch(/margin:\s*0\s+calc\(-1\s*\*\s*var\(--app-body-pad-x,\s*24px\)\)\s+8px/);
    // Opaque face + shadow: scrolling rows slide UNDER, never bleed through.
    expect(body).toMatch(/background:\s*var\(--surface/);
    expect(body).toMatch(/box-shadow:/);
    expect(body).toMatch(/border-radius:\s*0/);
  });

  it('the board header pins one toolbar-height below the bar', () => {
    const body = ruleBody('.debit-board thead th');
    // The bar-height offset carries the same padding-edge negation as the
    // bar itself, so the band lands exactly on the bar's bottom edge.
    expect(body).toMatch(/top:\s*calc\(var\(--debit-selection-height,\s*46px\)\s*\+\s*var\(--sticky-thead-top,\s*-24px\)\)/);
    expect(body).toMatch(/z-index:\s*3/);
    // position: sticky + the opaque band face come from the global thead rule
    // (components/Table.css: position: sticky, background surface-2) — this
    // page only re-offsets and re-zs it.
  });

  it('below the clip floor the lane thead stops pinning (SIL-1177)', () => {
    // Inside the ≤1183.98px scroll lane the bar-height top would pin the
    // header 46px INTO the first data row (the lane resolves the sticky
    // offset), so the header un-pins entirely there.
    expect(css).toMatch(
      /@media \(max-width:\s*1183\.98px\)\s*\{\s*\.debit-board thead th\s*\{\s*position:\s*static;\s*\}\s*\}/,
    );
  });

  it('the wrap stops trapping sticky at the operating widths (clip, not scroll)', () => {
    // Below the floor the rail keeps its scroll lane (graceful degradation)…
    expect(ruleBody('.debit-board__wrap')).toMatch(/overflow-x:\s*auto/);
    // …and the ≥1184px band (the 1136px table floor + the shell's widest 48px
    // gutter) replaces it with clip, so the thead pins against the page
    // scrollport instead of the rail.
    expect(css).toMatch(
      /@media \(min-width:\s*1184px\)\s*\{\s*\.debit-board__wrap\s*\{[^}]*overflow-x:\s*clip;[^}]*\}\s*\}/,
    );
  });

  it('sidebar-squeezed content re-opens the lane whatever the viewport says (SIL-1278)', () => {
    // The 1184px media floor assumed a sidebar-less viewport: at 1280 with
    // the 248px sidebar pinned the lane was 1032px wide yet clip still
    // engaged — GHI CHÚ & ĐỐI SOÁT unreachable, no scrollbar (QA 28/11). The
    // regime must key on the lane's TRUE width: the wrap's parent container,
    // 1088px = the 1136px table floor minus the 2×24px bleed gutters.
    expect(css).toMatch(
      /\.debit-page \.scroll-hint\s*\{[^}]*container-name:\s*debit-board;[^}]*container-type:\s*inline-size/,
    );
    const cq = css.match(/@container debit-board \(max-width:\s*1087\.98px\)\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(cq, 'no container-query override block').toBeTruthy();
    // The override restores BOTH lane-regime laws the clip band had replaced:
    // the wrap scrolls and the thead un-pins (SIL-1177's static rule).
    expect(cq).toMatch(/\.debit-board__wrap\s*\{[^}]*overflow-x:\s*auto/);
    expect(cq).toMatch(/\.debit-board thead th\s*\{[^}]*position:\s*static/);
  });

  it('the Lô cell keeps its daylight gutter and the rate input keeps the full cell', () => {
    const lot = ruleBody('.debit-board td.debit-col--lot');
    expect(lot).toMatch(/min-width:\s*0/);
    expect(lot).toMatch(/padding-right:\s*\d+px/);
    // The rate input owns the full cell — a fixed floor would let the value
    // escape the input onto the TỔNG THU track (the money-line suite pins
    // the full contract; this pins the boundary against the neighbor cell).
    const rate = ruleBody('.debit-line--rate .debit-ext-cost');
    expect(rate).toMatch(/width:\s*100%/);
    expect(rate).not.toMatch(/width:\s*\d+ch/);
  });
});
