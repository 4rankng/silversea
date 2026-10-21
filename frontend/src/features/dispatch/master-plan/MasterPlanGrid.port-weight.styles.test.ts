import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
const opsCss = readFileSync(resolve(process.cwd(), 'src/styles/operational-table-typography.css'), 'utf8');

/**
 * Container identity law (DIS-08, card 211026180428; supersedes the card
 * B 18/10 adjacent-sibling pin): every container line — count summaries under
 * a port AND in the cargo cell — carries the SHARED `.ops-container-line`
 * class from operational-table-typography.css, so one rule bolds the fact in
 * every column it renders in. The port-name line stays regular.
 */
describe('MasterPlanGrid container identity law (DIS-08, card 211026180428)', () => {
  it('the port-name line stays regular weight', () => {
    const rule = css.match(/\.master-plan-grid__location-value\s*\{([^}]*)\}/)?.[1];
    expect(rule).toBeTruthy();
    expect(rule).toContain('font-weight: 400');
  });

  it('no adjacent-sibling weight fallback remains — the shared class carries the law', () => {
    expect(css).not.toMatch(/\.master-plan-grid__location-value\s*\+\s*\.master-plan-grid__location-value/);
  });

  it('the shared ops-container-line class pins the primary weight in the ops-table layer', () => {
    const rule = opsCss.match(/\.ops-container-line,\s*\.ops-table \.ops-container-line\s*\{([^}]*)\}/)?.[1];
    expect(rule, 'the shared container identity rule must exist').toBeTruthy();
    expect(rule).toContain('font-weight: var(--ops-table-primary-weight)');
  });
});
