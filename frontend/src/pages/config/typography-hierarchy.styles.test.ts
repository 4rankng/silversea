import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8');
const sizesFor = (path: string, selector: string) => {
  const css = read(path).replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(',').some((part) => part.trim() === selector))
    .flatMap((match) => [...match[2].matchAll(/font-size:\s*([^;!]+)(?:\s*!important)?;/g)].map((value) => value[1].trim()));
};
const expectRole = (path: string, selector: string, role: string) => {
  const sizes = sizesFor(path, selector);
  expect(sizes.length, `${path}: ${selector} has an explicit role`).toBeGreaterThan(0);
  expect(new Set(sizes), `${selector} keeps its role across breakpoints`).toEqual(new Set([`var(--text-${role}-size)`]));
};

describe('shell and administration typography hierarchy', () => {
  it('keeps page titles at one semantic size on phone, tablet and desktop', () => {
    expectRole('components/PageHeader.css', '.page-title', 'title');
    expectRole('features/users/users.css', '.users-admin-page .page-title', 'title');
    expectRole('pages/config/SalaryPeriodConfigPage.css', '.sp-page-header h1', 'title');
    expectRole('pages/DashboardPage.css', '.dash-wf .wf-head h1', 'title');
  });

  it('does not shrink metrics or KPI labels into tiny phone text', () => {
    expectRole('components/KpiCard.css', '.kpi__value', 'metric');
    expectRole('components/KpiCard.css', '.kpi--compact .kpi__value', 'metric');
    expectRole('pages/DashboardPage.css', '.dash-wf .wf-kpi .val', 'metric');
    expectRole('features/users/users.css', '.users-admin-page .kpi-grid .kpi .kpi__label', 'label');
    expectRole('components/layout/responsive.css', '.is-driver .kpi__value', 'metric');
    expect(read('pages/config/PenaltyReasonsConfigPage.tsx')).not.toContain('fontSize: topReasonText.length');
  });

  it('uses the same role for equivalent user identity and account detail text', () => {
    expectRole('features/users/users.css', '.user-name', 'data');
    expectRole('features/users/users.css', '.users-mobile-card__name', 'data');
    expectRole('components/layout/bottom-nav.css', '.mobile-user-sheet-details dt', 'label');
    expectRole('components/layout/bottom-nav.css', '.mobile-user-sheet-details dd', 'data');
    expectRole('components/layout/bottom-nav.css', '.bottom-nav-label', 'label');
  });

  it('lets shared input typography own editable fields and keeps captions readable', () => {
    expect(sizesFor('features/users/users.css', '.icon-input__field')).toEqual(['var(--control-field-font-size)']);
    expect(sizesFor('pages/config/debit-note-template-editor.css', '.debit-editor-label-textarea')).toEqual([]);
    expect(read('pages/config/ForwarderExpenseTypesConfigPage.tsx')).not.toMatch(/fontSize:\s*13\b/);
    for (const file of ['features/users/users.css', 'components/layout/topbar.css', 'components/layout/sidebar.css', 'components/layout/bottom-nav.css', 'features/admin-center/AdminHealthWorkspace.css']) {
      expect(read(file), file).not.toMatch(/font-size:\s*(?:\d|clamp\()/);
    }
  });
});
