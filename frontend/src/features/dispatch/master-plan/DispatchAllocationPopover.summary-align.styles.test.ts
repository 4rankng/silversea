import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// QA 26/11 FCL allocation nits, pinned as declarations (the browser matrix is
// the lead's render rung — same idiom as the footer-gap styles test):
//
// Nit 1 — "Tổng phân bổ" summary headers must sit over their values. The
// value cells right-align (`> :not(:first-child) { text-align: right }` +
// font-data numerals); the Nhu cầu / Đã phân / Còn lại headers kept the
// default left alignment, so each header drifted off its column of numbers.
// The header cells share the value rows' alignment on the same 4-track grid.
//
// Nit 2 — the shared "+ Thêm nhanh" affordance must hold one line: beside the
// carrier select it wrapped onto two lines when the cell narrowed.

const css = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const ruleBodies = (source: string): Array<{ selector: string; body: string }> =>
  [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().split('\n').pop()!.trim(),
    body: m[2],
  }));

function ruleCss(source: string, selector: string): string | undefined {
  return ruleBodies(source).find((rule) => rule.selector === selector)?.body;
}

describe('DispatchAllocationPopover — summary table header alignment (QA 26/11)', () => {
  const popoverCss = css('src/features/dispatch/master-plan/DispatchAllocationPopover.css');

  it('the value-column headers right-align over their right-aligned values', () => {
    const head = ruleCss(popoverCss, '.dispatch-allocation-popover__summary-table-head-row > :not(:first-child)');
    expect(head).toBeTruthy();
    expect(head).toMatch(/text-align:\s*right/);
  });

  it("the header row shares the value rows' 4-track grid so columns cannot drift", () => {
    // One grouped rule owns both rows' grid template — the heads sit on the
    // exact tracks the values occupy.
    expect(popoverCss).toMatch(
      /\.dispatch-allocation-popover__summary-table-head-row,\s*\n\.dispatch-allocation-popover__summary-row\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    );
  });
});

describe('QuickAddButton — the + Thêm nhanh affordance holds one line (QA 26/11)', () => {
  const quickCss = css('src/components/shared/QuickAddButton.css');

  it('the button never wraps its label onto a second line', () => {
    const rule = ruleCss(quickCss, '.quick-add-button');
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/white-space:\s*nowrap/);
  });
});
