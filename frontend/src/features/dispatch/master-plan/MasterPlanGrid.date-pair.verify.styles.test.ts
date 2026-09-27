import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CHIEF ruling 2026-09-27 (card 20260927_150) — the dispatch master-plan date
 * filter is TWO independent fields (Từ ngày / Đến ngày), each with its own
 * one-month calendar, rendered by the shared `DateRangeFields` group.
 *
 * Supersedes case QA-2026-09-27-02 / card 20260927_2, which had pinned the
 * opposite (a single merged range trigger). The BEM slot the drawer grid lays
 * out survives; what must never come back is a merged range trigger, a
 * dual-calendar popover, or the retired 3-track "1fr | separator | 1fr" grid.
 */

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanFilters.tsx'), 'utf8');

describe('MasterPlanGrid from/to date filter (card 20260927_150)', () => {
  it('the dispatch date filter rides the shared two-field group', () => {
    expect(tsx).toContain('<DateRangeFields');
    expect(tsx).not.toContain('DateRangePopover');
    // Both the toolbar and the drawer mount the same group.
    expect(tsx.match(/<DateRangeFields/g)?.length).toBe(2);
  });

  it('the drawer slot still exists as a full-width row holding the field pair', () => {
    expect(css).toMatch(/\.master-plan-filters__date-range\s*\{/);
    const block = css.match(/\.master-plan-filters__date-range\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).toContain('display: block');
    // The retired 3-track input grid stays retired; the pair layout is the
    // shared `.date-range-fields` grid, not a page-local one.
    expect(css).not.toMatch(/\.master-plan-filters__date-inputs\s*\{/);
    expect(css).not.toMatch(/\.master-plan-filters__date-input\s*\{/);
    expect(css).not.toMatch(/\.master-plan-filters__date-sep\s*\{/);
    const drawer = css.match(/\.master-plan-filters__drawer-fields \.master-plan-filters__date-range\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(drawer).toContain('grid-column: 1 / -1');
    expect(drawer).not.toContain('grid-template-columns');
  });

  it('the slot rides the surface — no shadow / no background on the cell', () => {
    const block = css.match(/\.master-plan-filters__date-range\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).not.toMatch(/box-shadow/);
    expect(block).not.toMatch(/background/);
  });
});
