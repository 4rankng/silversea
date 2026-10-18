import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');

/**
 * Card B 18/10 (customer: "số container in đậm, cảng không in đậm") — in the
 * master plan's Cảng nâng / Cảng hạ columns the container-count lines are the
 * scan target and must carry the primary weight, while the port-name line
 * stays regular. Same law the detail plan pinned in card 20261005_361; the
 * fix is CSS-only (sibling selector on the rendered line order: port name
 * first, container summaries after).
 */
describe('MasterPlanGrid port-column weight contract (card B 18/10)', () => {
  it('container summary lines after the port line carry the primary weight', () => {
    const rule = css.match(
      /\.master-plan-grid__location-value \+ \.master-plan-grid__location-value\s*\{([^}]*)\}/,
    )?.[1];
    expect(rule).toBeTruthy();
    expect(rule).toContain('font-weight: var(--ops-table-primary-weight)');
  });

  it('the port-name line itself stays regular weight', () => {
    const rule = css.match(/\.master-plan-grid__location-value\s*\{([^}]*)\}/)?.[1];
    expect(rule).toBeTruthy();
    expect(rule).toContain('font-weight: 400');
  });
});
