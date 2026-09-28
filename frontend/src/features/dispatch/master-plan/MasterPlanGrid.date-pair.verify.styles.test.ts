import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CHIEF ruling 2026-09-27 (card 20260927_150) — the dispatch master-plan date
 * filter is TWO independent fields (Từ ngày / Đến ngày), each with its own
 * one-month calendar, rendered by the shared `DateRangeFields` group.
 *
 * Card 20260927_152 moved that group out of the drawer and onto the shared
 * filter bar, so the drawer-grid pins this file used to carry left with the
 * drawer. What must never come back is a merged range trigger, a dual-calendar
 * popover, the retired 3-track "1fr | separator | 1fr" page grid, or any page
 * rule that sizes, stacks or paints the shared group — the pair layout belongs
 * to DateRangeFields.css and the cell width to the bar's own sheet.
 */

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanFilters.tsx'), 'utf8');

describe('MasterPlanGrid from/to date filter (card 20260927_150)', () => {
  it('the dispatch date filter rides the shared two-field group, mounted once', () => {
    expect(tsx).toContain('<DateRangeFields');
    expect(tsx).not.toContain('DateRangePopover');
    // ONE mount — the bar's. The drawer's duplicate copy left with the drawer.
    expect(tsx.match(/<DateRangeFields/g)?.length).toBe(1);
  });

  it('the page declares no rule of its own for the shared group', () => {
    // The retired 3-track page grid stays retired: the pair layout is the
    // shared `.date-range-fields` grid, not a page-local one.
    expect(css).not.toMatch(/\.master-plan-filters__date-inputs\s*\{/);
    expect(css).not.toMatch(/\.master-plan-filters__date-input\s*\{/);
    expect(css).not.toMatch(/\.master-plan-filters__date-sep\s*\{/);
    // No page rule at all for the slot — no width, no display, no surface.
    expect(css).not.toMatch(/^\.master-plan-filters__date-range\s*[{>]/m);
  });
});
