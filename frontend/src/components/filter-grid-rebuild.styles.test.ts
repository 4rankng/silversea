import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260925_8 — REBUILD the filter bar as a REAL CSS grid (red-first).
 *
 * CHIEF evidence (26/09 09:50): the pair floated off the shared row, controls
 * staggered across rows (search low-left, selects ragged, "Kế hoạch" pushed to
 * a second row), and Tổng quan / Chi tiết lô hàng rendered two different
 * layouts. The flex row (wrap + per-child flex-basis) cannot hold columns
 * straight once anything wraps — so the shared `.list-filter-bar` becomes a
 * grid at desktop, the date pair becomes one 2-column grid item, and BOTH
 * pages ride the exact same pair class.
 *
 * Breakpoint contract (mandate): desktop ≥1280 auto-fit N-col content tracks;
 * tablet 768–1279 exactly 2-col; mobile <768 one-column stack while the date
 * pair stays 2-col.
 *
 * NEPOCORP reference consulted before coding (file:line):
 * - nepocorp frontend/src/pages/ExpenseListPage.css:148 — filter bar is
 *   `display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))`.
 * - nepocorp frontend/src/pages/ExpenseListPage.css:511 — tablet 2-col
 *   override `repeat(2, minmax(0, 1fr))`.
 * - nepocorp frontend/src/pages/ForwarderTripsPage.css:96 — search+date-pair
 *   bar on grid with `grid-template-columns: minmax(220px, 1fr) minmax(260px, auto)`
 *   and the pair as a transparent grid item (`:133` `1fr 1fr`).
 */

const listCss = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.css'), 'utf8');
const detailCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.css'), 'utf8');
const detailTsx = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.tsx'), 'utf8');
const workboardTsx = readFileSync(resolve(process.cwd(), 'src/components/WorkboardFilters.tsx'), 'utf8');

/** Top-level (outside any @media) rule body for a selector. */
function topLevelBlock(css: string, selector: string): string {
  return css.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? '';
}

describe('filter bar = real CSS grid (card 20260925_8 rebuild)', () => {
  it('shared ListFilterBar bar is a grid with auto-fit content tracks at desktop', () => {
    const bar = topLevelBlock(listCss, '.filter-bar.list-filter-bar');
    expect(bar, 'desktop grid rule exists').not.toBe('');
    expect(bar).toMatch(/display:\s*grid/);
    // Content-sized tracks: controls keep their natural width at wide viewports,
    // shrink gracefully (never overflow) when the row is tight, and every wrap
    // lands on the SAME column boundaries — that is the whole point vs flex.
    expect(bar).toMatch(/grid-template-columns:\s*repeat\(auto-fit, minmax\(240px, max-content\)\)/);
    // Baseline even: bottoms of every label-above-control stack align.
    expect(bar).toMatch(/align-items:\s*end/);
    expect(bar).toMatch(/gap:\s*12px 24px/);
    // No floats — grid handles wrap.
    expect(listCss).not.toMatch(/float\s*:/);
  });

  it('hides the flex spacer and pins actions to the end of the grid row', () => {
    // The flex spacer would occupy a grid track; actions get the last column
    // instead (auto / -1 + justify-self:end ⇒ right edge of their grid row).
    expect(listCss).toMatch(/\.list-filter-bar \.filter-bar__spacer\s*\{\s*display:\s*none/);
    expect(listCss).toMatch(/\.list-filter-bar \.filter-bar__spacer \+ \*[^{]*\{[^}]*grid-column:\s*auto \/ -1/);
    expect(listCss).toMatch(/\.list-filter-bar \.filter-bar__spacer \+ \*[^{]*\{[^}]*justify-self:\s*end/);
  });

  it('pair-group is ONE transparent grid item holding 2 dates/short-values side-by-side', () => {
    const pair = topLevelBlock(listCss, '.list-filter-bar__pair');
    expect(pair, 'pair desktop rule exists').not.toBe('');
    expect(pair).toMatch(/display:\s*grid/);
    expect(pair).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(pair).toMatch(/align-items:\s*end/);
    // Flat law: the pair can never paint a panel of its own.
    expect(pair).toMatch(/background:\s*transparent/);
    expect(pair).toMatch(/border:\s*0/);
    expect(pair).toMatch(/border-radius:\s*0/);
    expect(pair).not.toMatch(/box-shadow:\s*(?!none)/);
    // Children release their desktop width floors inside the pair so the 2
    // tracks shrink together — no overlap, no overflow into neighbours:
    // the date keeps its 168px natural size but is clamped to its cell.
    expect(listCss).toMatch(/\.list-filter-bar__pair \[data-input-wrapper\][^{]*\{[^}]*width:\s*168px/);
    expect(listCss).toMatch(/\.list-filter-bar__pair \[data-input-wrapper\][^{]*\{[^}]*max-width:\s*100%/);
    expect(listCss).toMatch(/\.list-filter-bar__pair \[data-input-wrapper\][^{]*\{[^}]*min-width:\s*0/);
    expect(listCss).toMatch(/\.list-filter-bar__pair \.ds-uui-select[^{]*\{[^}]*width:\s*100%/);
    expect(listCss).toMatch(/\.list-filter-bar__pair \.ds-uui-select[^{]*\{[^}]*min-width:\s*0/);
  });

  it('breakpoints: tablet 768-1279 = exactly 2-col, mobile <768 = 1-col stack', () => {
    expect(listCss).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1279px\)\s*\{[\s\S]*?\.filter-bar\.list-filter-bar[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    const mobile = listCss.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(mobile, 'mobile <768 block exists').not.toBe('');
    expect(mobile).toMatch(/\.filter-bar\.list-filter-bar/);
    expect(mobile).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    // Old 480px mobile breakpoint is superseded by the mandate's <768.
    // (Assert on the media query itself — the `max-width: 480px` *width
    // contract* on the searchable field is a different rule and must stay.)
    expect(listCss).not.toContain('@media (max-width: 480px)');
    // The pair stays 2-col on phones (short-value pairing, card 20260925_1).
    expect(topLevelBlock(listCss, '.list-filter-bar__pair')).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('source order: desktop rule precedes tablet media precedes mobile media', () => {
    const desktopIdx = listCss.search(/\.filter-bar\.list-filter-bar\s*\{/);
    const tabletIdx = listCss.search(/@media \(min-width: 768px\) and \(max-width: 1279px\)/);
    const mobileIdx = listCss.search(/@media \(max-width: 767px\)/);
    expect(desktopIdx).toBeGreaterThan(-1);
    expect(tabletIdx).toBeGreaterThan(desktopIdx);
    expect(mobileIdx).toBeGreaterThan(tabletIdx);
  });
});

describe('Tổng quan + Chi tiết lô hàng share ONE pair pattern (card 20260925_8 consistency)', () => {
  it('Chi tiết rides the shared list-filter-bar__pair with both date inputs inside it', () => {
    expect(detailTsx).toContain('list-filter-bar__pair');
    const pairStart = detailTsx.indexOf('list-filter-bar__pair');
    const fromIdx = detailTsx.indexOf('shipments-detail-filter--from', pairStart);
    const toIdx = detailTsx.indexOf('shipments-detail-filter--to', pairStart);
    expect(pairStart).toBeGreaterThan(-1);
    expect(fromIdx).toBeGreaterThan(pairStart);
    expect(toIdx).toBeGreaterThan(fromIdx);
    // The bespoke pair family (shared label + arrow row) is gone — that was
    // the "layout KHÁC hoàn toàn" CHIEF saw next to Tổng quan.
    expect(detailTsx).not.toContain('shipments-detail-filters__date-pair');
    expect(detailCss).not.toContain('.shipments-detail-filters__date-pair');
    // Group semantics survive the markup swap.
    expect(detailTsx).toContain('aria-label="Khoảng ngày vận chuyển"');
  });

  it('Tổng quan keeps the same shared pair class on both pairs', () => {
    const wrappers = workboardTsx.match(/className="list-filter-bar__pair"/g) ?? [];
    expect(wrappers).toHaveLength(2);
    expect(workboardTsx).toContain('data-pair="dates"');
    expect(workboardTsx).toContain('data-pair="short-selects"');
  });
});
