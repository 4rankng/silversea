import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-572 (2026-10-29): the pinned Thao tác rail owns its width inside the
// last scrolling column — the Ghi chú cell reserves one rail-width of
// padding-inline-end so its live note buttons stop before the zone the sticky
// cell covers when the board scrolls. (At full scroll the rail sits over its
// own track and nothing is covered; mid-transit overlap is inherent to a
// pinned rail over a wider board — geometry documented on the ticket.)
const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

describe('pinned Thao tác rail width reservation (SIL-572)', () => {
  it('declares the rail reserve and pays it at the Ghi chú cell edge', () => {
    expect(css).toMatch(/--dpg-actions-reserve:\s*56px;/);
    expect(css).toMatch(
      /\.detailed-plan-grid td\.detailed-plan-grid__cell--notes\s*\{[^}]*padding-inline-end:\s*calc\(var\(--space-sm\) \+ var\(--dpg-actions-reserve\)\);/,
    );
  });
});

// SIL-572 QA round 2 (2026-10-29): the kebab-vs-pager overlap requires the
// grid's rows to escape the bounded pane's overflow clip (an engine-side
// clipping failure not reproducible in Chromium — pane flush at 851.6, pager
// top 865). The pager therefore becomes an opaque, elevated surface: escaped
// paint slides under it and it always wins the click at any shared pixel, in
// every engine, at every scroll offset.
describe('pager surface lift (SIL-572)', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/pages/DispatchPlanPage.css'), 'utf8');

  it('lifts the in-flow pager above any escaped grid paint with an opaque surface', () => {
    const rule = page.match(/\.dispatch-plan-page__workspace > \.ds-pagination\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule, 'rule exists').not.toBe('');
    expect(rule).toMatch(/position:\s*relative;/);
    expect(rule).toMatch(/z-index:\s*calc\(var\(--z-base, 1\) \+ 1\);/);
    expect(rule).toMatch(/background:\s*var\(--bg\);/);
  });

  it('never reverts the pager to static (paint-over) or transparent', () => {
    const rule = page.match(/\.dispatch-plan-page__workspace > \.ds-pagination\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).not.toMatch(/position:\s*static/);
  });
});
