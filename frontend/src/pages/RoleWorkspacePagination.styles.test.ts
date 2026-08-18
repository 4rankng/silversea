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

  it('gives the CUS plan filter a full row on narrow screens', () => {
    const css = readPageCss('ShipmentsPage.css');

    expect(css).toMatch(/@media \(max-width:\s*700px\)[\s\S]*?\.cus-worksheet-toolbar__filters \.cus-plan-status-filter\s*\{[^}]*grid-column:\s*1 \/ -1;/);
  });
});
