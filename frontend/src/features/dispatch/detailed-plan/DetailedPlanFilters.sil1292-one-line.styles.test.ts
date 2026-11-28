/**
 * SIL-1292 (id 1592) — /dispatch-detail toolbar wraps its action cluster onto
 * a second row (86px, 2 rows) at 1280/1440 with the sidebar expanded, against
 * the FB-056 one-line ruling. The row is already fully compacted (gap 8/10,
 * padding-inline 8) so the ticket's sanctioned fallback is "cho cuộn ngang":
 * at ≥1280 the strip never wraps and the lane scrolls sideways instead.
 *
 * These pins guard the three moving parts of that law:
 *   1. the markup adopts the shared scroll-hint host + lane pair;
 *   2. the page sheet enforces nowrap + horizontal scroll on the lane at
 *      ≥1280, with intrinsic item widths (no squeeze) and the native
 *      scrollbar hidden so the row keeps its 48px one-line height;
 *   3. the band's row measurement counts a scrolling no-wrap line by its
 *      WRAPPED-line demand — otherwise the fold ladder sees "1 row" at every
 *      width and parks `inline`, un-folding criteria the surface had folded.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const tsx = read('src/features/dispatch/detailed-plan/DetailedPlanFilters.tsx');
const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
const mode = read('src/design-system/filter-bar-mode.ts');

describe('SIL-1292 — /dispatch-detail toolbar is one line, scrolling sideways when tight', () => {
  it('adopts the shared scroll-hint host + lane pair around the FilterBar', () => {
    expect(tsx).toContain('className="detailed-plan-filters-bar scroll-hint"');
    expect(tsx).toContain('className="detailed-plan-filters-bar__lane scroll-hint__lane"');
    // The lane wraps the band itself — the scroller is the bar's own box.
    expect(tsx.indexOf('detailed-plan-filters-bar__lane scroll-hint__lane')).toBeLessThan(tsx.indexOf('<FilterBar'));
  });

  it('pins nowrap + horizontal scroll on the lane at ≥1280, never below', () => {
    const band = css.match(/@media \(min-width: 1280px\)\s*\{([\s\S]*?)\n\}/);
    expect(band, 'the ≥1280 one-line band is missing from DetailedPlanGrid.css').toBeTruthy();
    const block = band![1];
    expect(block).toMatch(/\.detailed-plan-filters-bar__lane\s*\{[^}]*overflow-x:\s*auto/);
    expect(block).toMatch(/\.detailed-plan-filters-bar__lane \.filter-bar\s*\{[^}]*flex-wrap:\s*nowrap/);
    // Height law: the native scrollbar may not steal pixels from the 48px row.
    expect(block).toMatch(/scrollbar-width:\s*none/);
    expect(block).toMatch(/\.detailed-plan-filters-bar__lane::-webkit-scrollbar\s*\{\s*height:\s*0/);
    // The 8px strip breathing room rides the lane, not the scrolled content.
    expect(block).toMatch(/\.detailed-plan-filters-bar__lane \.filter-bar\s*\{[^}]*margin:\s*0/);
  });

  it('keeps item widths intrinsic under nowrap, with the search as the only shrinker', () => {
    const band = css.match(/@media \(min-width: 1280px\)\s*\{([\s\S]*?)\n\}/)![1];
    // Without this the quick-chips group squeezes, wraps internally and grows
    // the row TALLER — the defect under another name.
    expect(band).toMatch(/\.detailed-plan-filters-bar__lane \.filter-bar > \*\s*\{[^}]*flex-shrink:\s*0/);
    expect(band).toMatch(/search-cell\s*\{[^}]*flex-shrink:\s*1/);
  });

  it('counts a scrolling no-wrap line by its wrapped-line demand, and wrap bars by rows', () => {
    // The ladder's own call shape is contract (filter-audit-contract pins it).
    expect(mode).toMatch(/countLines\(bar\)\s*<=\s*maxLines/);
    // The nowrap overflow branch exists and only fires past the visible width.
    expect(mode).toMatch(/flexWrap === 'nowrap'/);
    expect(mode).toMatch(/extent > bar\.clientWidth \+ 1/);
    expect(mode).toMatch(/Math\.ceil\(extent \/ bar\.clientWidth\)/);
    // The overlap path stays the law for wrap-mode bars.
    expect(mode).toMatch(/const used: \{ top: number; bottom: number \}\[\]/);
  });
});
