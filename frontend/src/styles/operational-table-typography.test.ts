import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const typography = read('src/styles/operational-table-typography.css');

describe('operational table typography contract', () => {
  it('uses one compact primary, supporting, metadata, and note scale', () => {
    expect(typography).toContain('--ops-table-header-size: var(--text-label-size);');
    expect(typography).toContain('--ops-table-primary-size: var(--text-data-size);');
    expect(typography).toContain('--ops-table-supporting-size: var(--text-data-size);');
    expect(typography).toContain('--ops-table-meta-size: var(--text-label-size);');
    expect(typography).toContain('--ops-table-note-size: var(--text-data-size);');
  });

  it('is adopted by the shipment, dispatch, and detailed-dispatch grids', () => {
    expect(read('src/pages/ShipmentsPage.tsx')).toContain('cus-dashboard-table ops-table');
    expect(read('src/features/dispatch/master-plan/MasterPlanGrid.tsx')).toContain('master-plan-grid ops-table');
    expect(read('src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx')).toContain('detailed-plan-grid ops-table');
  });

  it('floors a supporting <small> inside a data cell at the metadata scale', () => {
    // A `<small>` beside 12px data renders at the browser's 0.8em default
    // (9.6px) unless the shared base floors it — law §5 puts supporting text
    // at 11px, and `role-ui-sweep.mjs` counts sub-11px text as a defect.
    expect(typography).toMatch(/:where\(table tbody small\)\s*\{[^}]*font-size:\s*var\(--ops-table-meta-size\)/);
  });

  it('declares the shared tabular numeral grid on data cells (SIL-562)', () => {
    // Numeric and date cells stop reflowing between refreshes once every
    // digit takes one advance width. Owner-specced like the money
    // primitives (see the font-family contract allowlist): inert until the
    // bundled Be Vietnam Pro carries tnum, declared so the grid holds the
    // moment it does. Prose is unaffected — only numerals map the grid.
    expect(typography).toMatch(
      /:where\(table tbody td\)\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/,
    );
  });

  it('carries the container identity weight law for every dispatch table (DIS-08)', () => {
    // One shared class — rendered by the master grid (cargo cell + port
    // columns) and the detailed grid (container cell) — owns the weight of a
    // container line, so no surface can silently fall back to 400. The
    // compound `.ops-table` form outranks same-specificity page cell rules
    // (e.g. the port-name 400) regardless of stylesheet order.
    const rule = typography.match(/\.ops-container-line,\s*\.ops-table \.ops-container-line\s*\{([^}]*)\}/)?.[1];
    expect(rule).toBeTruthy();
    expect(rule).toContain('font-weight: var(--ops-table-primary-weight)');
    expect(read('src/features/dispatch/master-plan/MasterPlanGrid.tsx')).toContain('ops-container-line');
    expect(read('src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx')).toContain('ops-container-line');
  });

  it('maps each grid to the shared role tokens instead of local font literals', () => {
    const shipmentCss = read('src/pages/ShipmentsPage.css');
    const masterCss = read('src/features/dispatch/master-plan/MasterPlanGrid.css');
    const detailCss = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');

    for (const css of [shipmentCss, masterCss, detailCss]) {
      expect(css).toContain('var(--ops-table-primary-size)');
      expect(css).toContain('var(--ops-table-supporting-size)');
      expect(css).toContain('var(--ops-table-meta-size)');
    }
    expect(shipmentCss).toContain('var(--ops-table-note-size)');
    expect(masterCss).toContain('var(--ops-table-note-size)');
    expect(detailCss).toContain('var(--ops-table-note-size)');
  });
});
