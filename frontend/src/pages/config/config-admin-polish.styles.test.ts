import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8');

describe('configuration and administration responsive contracts', () => {
  it('lets portalled catalog forms collapse without leaving implicit extra columns', () => {
    const css = read('pages/config/config-page.css');
    expect(css).toMatch(/\.cfg-form-columns\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.cfg-form-columns\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toContain('.cfg-form-columns__full { grid-column: 1 / -1; }');
    for (const path of ['CustomerForm.tsx', 'FactoriesConfigPage.tsx', 'ForwarderExpenseTypesConfigPage.tsx']) {
      const source = read(`pages/config/${path}`);
      expect(source).toContain('className="cfg-form-columns');
      expect(source).not.toContain("gridTemplateColumns: '1fr 1fr'");
    }
    expect(read('pages/config/FactoriesConfigPage.tsx')).not.toContain("gridColumn: 'span 2'");
    expect(css).toMatch(/\.cfg-form-footer\s*\{[^}]*flex-wrap:\s*wrap;/);
  });

  it('sizes audit detail from the real header height and preserves scrolling', () => {
    const css = read('pages/AuditLogPage.css');
    expect(css).toMatch(/\.audit-detail-modal \.audit-detail-modal__box\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
    expect(css).toMatch(/\.audit-detail-modal__body\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
    expect(css).not.toMatch(/height:\s*calc\([^;]*-\s*(94|104)px\)/);
    expect(css).toContain('env(safe-area-inset-bottom, 0px)');
  });

  it('keeps salary period focus visible and suppresses optional motion', () => {
    const css = read('pages/config/SalaryPeriodConfigPage.css');
    expect(css).toContain('.sp-mode-card:has(input:focus-visible)');
    expect(css).not.toContain('transition: all');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.sp-mode-card\s*\{\s*transition:\s*none;/);
    expect(css).toContain('.sp-save-success { animation: none; }');
  });

  it('uses flat health and user sections with shrinkable field tracks', () => {
    const health = read('features/admin-center/AdminHealthWorkspace.css');
    expect(health).toMatch(/\.admin-health-workspace article\s*\{[^}]*min-width:\s*0;/);
    expect(health.match(/\.admin-health-workspace article\s*\{[^}]*\}/)?.[0]).not.toContain('border-radius');
    expect(health).toContain('@media (pointer: coarse)');
    const users = read('features/users/users.css');
    expect(users).toMatch(/\.icon-input__field\s*\{[^}]*min-width:\s*0;/);
    expect(users).toMatch(/\.users-form-card\s*\{[^}]*border:\s*0;/);
    expect(users).toMatch(/\.business-units__card\s*\{[^}]*border-bottom:\s*1px solid/);
  });

  it('styles compact user rows before phone-only overrides so tablets have the same header layout', () => {
    const users = read('features/users/users.css');
    const componentStyles = users.slice(0, users.indexOf('@media (max-width: 640px)'));
    expect(componentStyles).toMatch(/\.users-mobile-card__header\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/);
    expect(componentStyles).toContain('.users-mobile-card__details');
    expect(componentStyles).toContain('.users-mobile-card__menu');
    expect(users).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.users-admin-page \.page-header/);
  });

  it('gives the contained user paginator the full available footer width', () => {
    const users = read('features/users/users.css');
    expect(users).toMatch(/\.users-table-foot > \.ds-pagination\s*\{[^}]*flex:\s*1 1 100%;[^}]*width:\s*100%;[^}]*max-width:\s*100%;/);
  });

  it('keeps penalty actions visible in flow for keyboard and touch users', () => {
    const source = read('pages/config/PenaltyReasonsConfigPage.tsx');
    const actions = source.match(/\.pr-card-actions\s*\{[^}]*\}/)?.[0] ?? '';
    expect(actions).not.toContain('position: absolute');
    expect(actions).not.toContain('opacity: 0');
    expect(source).toContain('.pr-act:focus-visible');
    expect(source).toContain('.pr-act { width: 44px; height: 44px; }');
  });

  it('uses shell gutters in the document editor and flat issuer fields', () => {
    const css = read('pages/config/debit-note-template-editor.css');
    expect(css).not.toMatch(/\.debit-editor-page\s*\{[^}]*margin:\s*-/);
    expect(css).toMatch(/\.debit-editor-settings--issuer \.debit-editor-field\s*\{[^}]*min-height:\s*0;[^}]*border:\s*0;/);
    expect(css).toContain('minmax(min(260px, 100%), 1fr)');
  });

  it('gives configuration status its own phone row beside a stable action', () => {
    const css = read('pages/ConfigPage.css');
    expect(css).toContain('grid-template-columns: 34px minmax(0, 1fr) auto');
    expect(css).toMatch(/\.setting-card__status\s*\{[^}]*grid-column:\s*2;/);
    expect(css).toMatch(/\.setting-card__action\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1 \/ span 2;/);
  });
});
