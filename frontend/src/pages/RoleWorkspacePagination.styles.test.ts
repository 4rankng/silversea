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

  it('keeps the CUS worksheet toolbar on one self-sizing filter rail that reflows through the grid', () => {
    const css = readPageCss('ShipmentsPage.css');

    // The 2026-09-18 rail rework replaced the fixed two-track template:
    // every filter shares one auto-fit rail (a new filter never needs a
    // track edit), the search field spans two tracks, and the reset sits
    // under the rail flush with its left edge. The retired full-row
    // plan-filter rule must stay retired.
    expect(css).toMatch(/\.cus-worksheet-toolbar__filters\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*150px\),\s*1fr\)\);/);
    expect(css).not.toMatch(/\.cus-worksheet-toolbar__filters \.cus-plan-status-filter\s*\{[^}]*grid-column:\s*1 \/ -1;/);
  });
});
