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

  it('SIL-568: aligns severity and trend badges with house semantic triads and removes private --wf color pins', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/DashboardPage.css'), 'utf8');
    expect(page).not.toContain('--wf-red:');
    expect(page).not.toContain('--wf-amber:');
    expect(page).not.toContain('--wf-red-soft:');
    expect(page).not.toContain('--wf-amber-soft:');

    expect(page).toMatch(/\.dash-wf\s+\.wf-severity--critical\s*\{[^}]*color:\s*var\(--danger-text\);[^}]*background:\s*var\(--danger-soft\);/);
    expect(page).toMatch(/\.dash-wf\s+\.wf-severity--warning\s*\{[^}]*color:\s*var\(--warning-text\);[^}]*background:\s*var\(--warning-soft\);/);
    expect(page).toMatch(/\.dash-wf\s+\.wf-severity--info\s*\{[^}]*color:\s*var\(--info-text\);[^}]*background:\s*var\(--info-soft\);/);
    expect(page).toMatch(/\.dash-wf\s+\.wf-severity--success\s*\{[^}]*color:\s*var\(--success-text\);[^}]*background:\s*var\(--success-soft\);/);

    expect(page).toMatch(/\.dash-wf\s+\.wf-kpi\s+\.delta\.up\s*\{[^}]*color:\s*var\(--success-text\);[^}]*background:\s*var\(--success-soft\);/);
    expect(page).toMatch(/\.dash-wf\s+\.wf-kpi\s+\.delta\.down\s*\{[^}]*color:\s*var\(--danger-text\);[^}]*background:\s*var\(--danger-soft\);/);

    expect(css).toMatch(/\.d-badge\.d-badge-soft\.d-badge-success\s*\{[^}]*background:\s*var\(--success-soft\);[^}]*color:\s*var\(--success-text\);/);
    expect(css).toMatch(/\.d-badge\.d-badge-soft\.d-badge-error\s*\{[^}]*background:\s*var\(--danger-soft\);[^}]*color:\s*var\(--danger-text\);/);
  });
});
