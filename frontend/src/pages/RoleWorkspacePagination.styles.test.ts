import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readPageCss = (filename: string) =>
  readFileSync(resolve(process.cwd(), `src/pages/${filename}`), 'utf8');

describe('role workspace pagination', () => {
  it('keeps CUS pagination in normal flow at tablet and mobile widths', () => {
    const css = readPageCss('ShipmentsPage.css');

    expect(css).toMatch(/\.cus-dashboard-viewport > \.ds-pagination\s*\{[^}]*position:\s*sticky;/);
    expect(css).toMatch(/@media \(max-width:\s*1100px\)[\s\S]*?\.cus-dashboard-viewport > \.ds-pagination\s*\{[^}]*position:\s*static;/);
  });

  it('keeps dispatcher pagination in normal flow when the plan becomes cards', () => {
    const css = readPageCss('DispatchPlanPage.css');

    expect(css).toMatch(/\.dispatch-plan-page__workspace > \.ds-pagination\s*\{[^}]*position:\s*sticky;/);
    expect(css).toMatch(/@media \(max-width:\s*1100px\)[\s\S]*?\.dispatch-plan-page__workspace > \.ds-pagination\s*\{[^}]*position:\s*static;/);
  });

  it('keeps the CUS worksheet toolbar on one two-column grid that reflows without breakpoint overrides', () => {
    const css = readPageCss('ShipmentsPage.css');

    // The 2026-09-15 worksheet rework replaced the 5-column + 3-breakpoint
    // toolbar with a single two-column grid; narrow screens reflow through
    // the grid itself instead of media-query overrides, and the retired
    // full-row plan-filter rule must stay retired.
    expect(css).toMatch(/\.cus-worksheet-toolbar__filters\s*\{[^}]*grid-template-columns:\s*minmax\(240px,\s*1\.3fr\)\s*minmax\(0,\s*4fr\);/);
    expect(css).not.toMatch(/\.cus-worksheet-toolbar__filters \.cus-plan-status-filter\s*\{[^}]*grid-column:\s*1 \/ -1;/);
  });
});
