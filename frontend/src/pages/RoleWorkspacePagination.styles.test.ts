import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readPageCss = (filename: string) =>
  readFileSync(resolve(process.cwd(), `src/pages/${filename}`), 'utf8');

describe('role workspace pagination', () => {
  it('keeps CUS pagination in normal flow at tablet and mobile widths', () => {
    const css = readPageCss('ShipmentsPage.css');

    // Card 20260922_20: the desktop sticky pinned to a scrollport that is
    // not main.app-body and floated the bar mid-list over rows — the pager
    // is in flow at EVERY width now, which subsumes the desktop-sticky/
    // static-cards split this test pinned (same ruling as card 20260921_22).
    expect(css).toMatch(/\.cus-dashboard-viewport > \.ds-pagination\s*\{[^}]*position:\s*static;/);
    expect(css).not.toMatch(/\.cus-dashboard-viewport > \.ds-pagination[^}]*sticky/);
  });

  it('keeps dispatcher pagination in normal flow when the plan becomes cards', () => {
    const css = readPageCss('DispatchPlanPage.css');

    // Card 20260921_22: the sticky desktop pin floated the bar mid-list at
    // rest, covering 13-14 of 20 rows — the pager is now in flow at EVERY
    // width (the cards-mode static rule folded into the base block), which
    // subsumes the old desktop-sticky/static-cards split this test pinned.
    expect(css).toMatch(/\.dispatch-plan-page__workspace > \.ds-pagination\s*\{[^}]*position:\s*static;/);
    expect(css).not.toMatch(/\.dispatch-plan-page__workspace > \.ds-pagination\s*\{[^}]*position:\s*sticky;/);
  });

  it('card 20260922_42: the CUS worksheet toolbar family is retired — the bar rides the shared ListFilterBar sheet', () => {
    const css = readPageCss('ShipmentsPage.css');

    // The self-made toolbar (search block, disclosure, summary chip) was cut
    // over to the shared ListFilterBar; none of its chrome may return.
    expect(css).not.toMatch(/cus-worksheet-toolbar|cus-search-field|cus-worksheet-advanced|cus-advanced-toggle|cus-active-filter-summary/);
  });
});
