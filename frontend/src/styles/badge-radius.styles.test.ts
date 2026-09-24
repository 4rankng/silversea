import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Two-part pill sweep (prod-gating QA delta spot, 2026-09-24): the dashboard
 * trend chips and severity badges render via the daisyUI `d-badge` primitive,
 * whose stock radius is fully-round (computed 20px on a 20px-tall sm badge) —
 * design law §1 bans the pill look; the house fix for `.kpi__trend-badge`
 * (a729f139) set the 6px precedent. The d-badge primitive itself now carries
 * the same 6px radius so every current and future consumer reads as a small
 * rectangle, and the sweep found no other d-badge usages beyond the two this
 * rule covers (dashboard-presenters trend chips, DashboardPage wf-severity). */
describe('d-badge primitive wears the house radius, not the pill (§1)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

  it('overrides the daisyUI badge radius at the primitive level', () => {
    const rule = css.match(/\.d-badge\.d-badge\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('border-radius: 6px');
  });

  it('keeps the dashboard delta chip at the house radius, not 20px', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/DashboardPage.css'), 'utf8');
    const delta = page.match(/\.dash-wf \.wf-kpi \.delta\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(delta).toContain('border-radius: 6px');
    expect(delta).not.toContain('border-radius: 20px');
  });
});
