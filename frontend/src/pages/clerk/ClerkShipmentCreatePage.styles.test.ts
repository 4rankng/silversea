import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/clerk/ClerkShipmentCreatePage.css'), 'utf8');
const source = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/create/ShipmentCreateWorkspace.tsx'),
  'utf8',
);
const fieldAdapters = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/create/uui-fields.tsx'),
  'utf8',
);
const sectionSource = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/create/ShipmentCreateSections.tsx'),
  'utf8',
);

describe('shipment create responsive layout', () => {
  it('gives every form control a persistent visible boundary and focus state', () => {
    expect(fieldAdapters).toContain('csc-uui-field csc-control-boundary');
    expect(css).toMatch(/\.csc-control-boundary > \[role='presentation'\][\s\S]*?border:\s*1px solid/);
    expect(css).toMatch(/\.csc-control-boundary > \[role='presentation'\][\s\S]*?background:\s*var\(--surface/);
    expect(css).toMatch(/\.csc-control-boundary:focus-within > \[role='presentation'\][\s\S]*?border-color:\s*var\(--accent/);
    expect(css).toMatch(/\.csc-control-boundary:focus-within > \[role='presentation'\][\s\S]*?box-shadow:\s*0 0 0 3px/);
    expect(css).toMatch(/\.csc-control-boundary :where\(input, select, textarea\):focus-visible\s*\{[^}]*outline:\s*none;[^}]*outline-offset:\s*0;/);
  });

  it('keeps container fields shrinkable inside the page workspace', () => {
    expect(source).toContain('className="csc-container-grid"');
    expect(css).toMatch(/\.csc-container-record\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.csc-container-editor\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.csc-container-grid\s*>\s*\*\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.csc-container-grid\s+select\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  });

  it('collapses the container grid to one column on narrow screens', () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-container-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important;/,
    );
  });

  it('styles only cargo option labels as radio cards, not the required marker', () => {
    expect(source).toContain('className="csc-mode__option"');
    expect(css).toMatch(/\.csc-mode__option\s*\{[^}]*min-height:\s*38px;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-mode__option[^}]*min-height:\s*44px;/);
    expect(css).toMatch(/\.csc-mode__option::before\s*\{[^}]*border-radius:\s*50%;/);
    expect(css).not.toMatch(/\.csc-mode\s+span(?:\s*\{|::before)/);
  });

  it('gives customer identity the widest column and reflows cleanly by viewport', () => {
    expect(source).toContain('className="csc-identity-grid"');
    expect(source).toContain('className="csc-identity-grid__customer"');
    expect(css).toMatch(/\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\);/);
    expect(css).toMatch(/\.csc-identity-grid__customer\s*\{[^}]*grid-column:\s*span 6;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*1100px\)[\s\S]*?\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  });

  it('lets customer names use the trigger width and wrap inside a wider menu', () => {
    expect(source).toContain('popoverClassName="csc-customer-popover"');
    expect(source).toContain('optionClassName="csc-customer-option"');
    expect(css).toMatch(/\.csc-customer-popover\s*\{[^}]*min-width:\s*min\(32rem,\s*calc\(100vw - 32px\)\);[^}]*background:\s*var\(--surface,\s*#fff\);/);
    expect(css).toMatch(/\.csc-customer-popover \.csc-customer-option \[slot='label'\]\s*\{[^}]*white-space:\s*normal;/);
  });

  it('separates form sections from the application canvas without decorative elevation', () => {
    expect(css).toMatch(/\.app-main:has\(\.csc-page\)\s*\{[^}]*background:\s*var\(--surface-3\);/);
    expect(css).toMatch(/\.csc-form\s*\{[^}]*gap:\s*12px;/);
    expect(css).toMatch(/\.csc-section\s*\{[^}]*border:\s*1px solid var\(--line-2\)\s*!important;[^}]*background:\s*var\(--surface\)\s*!important;/);
    expect(css).toMatch(/\.csc-section__heading\s*\{[^}]*margin:\s*-14px -14px 0;[^}]*background:\s*var\(--surface-2\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-section__heading\s*\{[^}]*margin:\s*-14px -14px 0;/);
    expect(css).not.toMatch(/\.csc-section\s*\{[^}]*box-shadow:/);
  });

  it('uses compact desktop density while retaining mobile touch targets', () => {
    expect(fieldAdapters.match(/size="sm"/g)).toHaveLength(4);
    expect(sectionSource).toMatch(/gridTemplateColumns:[^\n]+gap:\s*12/);
    expect(sectionSource).toMatch(/display:\s*'grid',\s*gap:\s*12/);
    expect(css).toMatch(/\.csc-page\s*\{[^}]*padding:\s*12px 20px 28px;/);
    expect(css).toMatch(/\.csc-header h1\s*\{[^}]*font-size:\s*clamp\(22px,\s*2vw,\s*26px\);/);
    expect(css).toMatch(/\.csc-workspace\s*\{[^}]*gap:\s*12px;/);
    expect(css).toMatch(/\.csc-section\s*\{[^}]*padding:\s*14px\s*!important;[^}]*gap:\s*12px\s*!important;/);
    expect(css).toMatch(/\.csc-section__heading\s*\{[^}]*padding:\s*10px 14px;/);
    expect(css).toMatch(/\.csc-control-boundary \[data-label='true'\]\s*\{[^}]*font-size:\s*12px;/);
    expect(css).toMatch(/\.csc-control-boundary > \[role='presentation'\][\s\S]*?min-height:\s*38px;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-control-boundary > \[role='presentation'\][\s\S]*?min-height:\s*44px;/);
  });

  it('renders the add-container action as a compact grouped button', () => {
    expect(css).toMatch(/\.csc-add-container\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*fit-content;[^}]*justify-self:\s*start;/);
    expect(css).toMatch(/\.csc-add-container\s+svg\s*\{[^}]*flex:\s*0 0 auto;/);
  });

  it('keeps a long desktop validation list bounded without hiding any issue', () => {
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1101px\)\s*and\s*\(min-height:\s*721px\)[\s\S]*?\.csc-validation-summary ol\s*\{[^}]*max-height:\s*min\(24vh,\s*168px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/,
    );
  });

  it('uses the full workspace width and keeps actions in the form flow', () => {
    expect(css).toMatch(/\.csc-workspace\s*\{[^}]*display:\s*grid;[^}]*gap:\s*12px;[^}]*min-width:\s*0;/);
    expect(css).not.toContain('grid-template-columns: minmax(0, 1fr) minmax(280px, 320px)');
    expect(css).not.toContain('.csc-readiness');
    expect(css).toMatch(/\.csc-summary\s*\{[^}]*display:\s*grid;[^}]*gap:\s*12px;[^}]*min-width:\s*0;/);
    expect(css).not.toContain('position: sticky');
  });
});
