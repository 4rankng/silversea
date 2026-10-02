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
