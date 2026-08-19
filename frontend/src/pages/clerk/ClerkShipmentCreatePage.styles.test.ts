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
const uuiSelectSource = readFileSync(
  resolve(process.cwd(), 'src/design-system/forms/UuiSelectField.tsx'),
  'utf8',
);
const sectionSource = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/create/ShipmentCreateSections.tsx'),
  'utf8',
);
const containerEditorSource = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/create/ShipmentContainerEditor.tsx'),
  'utf8',
);
const summarySource = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/create/ShipmentCreateSummary.tsx'),
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
    expect(source).toContain('className="csc-container-row"');
    expect(containerEditorSource).toContain('className="csc-container-table"');
    expect(css).toMatch(/\.csc-container-editor\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.csc-container-table\s*\{[^}]*width:\s*100%;[^}]*table-layout:\s*fixed;/);
    expect(css).toMatch(/\.csc-container-table td:not\(\.csc-container-row__actions\)\s*>\s*\*\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.csc-container-table select\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  });

  it('keeps the quantity-plus-add control touch-safe and contained on mobile', () => {
    expect(containerEditorSource).toContain('id="container-add-count"');
    expect(containerEditorSource).toContain('DEFAULT_ADD_COUNT = 1');
    expect(containerEditorSource).toContain('aria-label="Số container cần thêm"');
    expect(containerEditorSource.match(/<button/g)).toHaveLength(1);
    expect(css).toMatch(/\.csc-container-actions\s*\{[^}]*justify-content:\s*flex-end;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-container-add-control\s*\{[^}]*grid-template-columns:\s*72px minmax\(0,\s*1fr\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-container-add-control input[^}]*min-height:\s*44px;/);
  });

  it('uses shared headers on desktop and deliberate record layouts below the wide canvas', () => {
    expect(containerEditorSource).toContain('<table className="csc-container-table">');
    expect(containerEditorSource).toContain('<th scope="col">Số container</th>');
    expect(containerEditorSource).toContain('<th scope="col">Ngày giờ đóng trả</th>');
    expect(source).toContain('hideLabel');
    expect(css).toMatch(/@media\s*\(max-width:\s*1100px\)[\s\S]*?\.csc-container-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-container-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
  });

  it('styles only cargo option labels as radio cards, not the required marker', () => {
    expect(source).toContain('className="csc-mode__option"');
    expect(css).toMatch(/\.csc-mode__option\s*\{[^}]*min-height:\s*38px;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-mode__option[^}]*min-height:\s*44px;/);
    expect(css).toMatch(/\.csc-mode__option::before\s*\{[^}]*border-radius:\s*50%;/);
    expect(css).not.toMatch(/\.csc-mode\s+span(?:\s*\{|::before)/);
  });

  it('uses a neutral ink selected state for cargo mode', () => {
    expect(css).toMatch(/\.csc-mode__option\s*\{[^}]*background:\s*var\(--surface\);[^}]*color:\s*var\(--fg-2\);/);
    expect(css).toMatch(/\.csc-mode input:checked \+ span\s*\{[^}]*border-color:\s*var\(--ink\);[^}]*background:\s*var\(--surface\);[^}]*box-shadow:\s*inset 3px 0 0 var\(--ink\);/);
    expect(css).toMatch(/\.csc-mode input:checked \+ span::before\s*\{[^}]*border-color:\s*var\(--ink\);[^}]*background:\s*var\(--ink\);/);
    expect(css).not.toMatch(/\.csc-mode input:checked \+ span\s*\{[^}]*(?:accent-soft|brand-subtle)/);
  });

  it('uses one desktop decision row for cargo type and combined-load handling', () => {
    expect(source).toContain('className="csc-cargo-choice-grid"');
    expect(css).toMatch(/\.csc-cargo-choice-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(280px,\s*1fr\);[^}]*align-items:\s*end;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*?\.csc-cargo-choice-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(css).toMatch(/\.csc-combined-toggle\s*\{[^}]*min-height:\s*38px;[^}]*padding:\s*7px 10px;/);
    expect(source).not.toContain('Điều vận có thể ghép chuyến hoặc xe kẹp.');
    expect(source).not.toMatch(/className="csc-combined-toggle"[\s\S]*?<small>/);
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
    // Counts: USearchableField, UTextField, UTextAreaField, UDateField in the
    // page adapters, plus USelectField via the shared UuiSelectField adapter —
    // all use the operational `sm` contract used by dispatch, rather than
    // growing labels and values through `md`.
    expect(fieldAdapters.match(/size="sm"/g)).toHaveLength(4);
    expect(uuiSelectSource).toContain('size="sm"');
    expect(fieldAdapters).not.toContain('size="md"');
    expect(containerEditorSource).not.toContain('Số lượng cont');
    expect(containerEditorSource.match(/type="number"/g)).toHaveLength(1);
    expect(containerEditorSource).toContain('id="container-add-count"');
    expect(css).toMatch(/\.csc-mode legend\s*\{[^}]*font-size:\s*var\(--control-compact-font-size\);[^}]*line-height:\s*var\(--control-compact-line-height\);/);
    expect(css).toMatch(/\.csc-mode__option\s*\{[^}]*font-size:\s*var\(--control-compact-font-size\);[^}]*line-height:\s*var\(--control-compact-line-height\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-mode legend,\s*\.csc-mode__option\s*\{[^}]*font-size:\s*var\(--control-compact-touch-font-size\);[^}]*line-height:\s*var\(--control-compact-touch-line-height\);/);
    expect(sectionSource).toMatch(/gridTemplateColumns:[^\n]+gap:\s*12/);
    expect(sectionSource).toMatch(/display:\s*'grid',\s*gap:\s*12/);
    expect(css).toMatch(/\.csc-page\s*\{[^}]*padding:\s*12px 20px 28px;/);
    expect(css).toMatch(/\.csc-workspace\s*\{[^}]*gap:\s*12px;/);
    expect(css).toMatch(/\.csc-section\s*\{[^}]*padding:\s*14px\s*!important;[^}]*gap:\s*12px\s*!important;/);
    expect(css).toMatch(/\.csc-section__heading\s*\{[^}]*padding:\s*10px 14px;/);
    expect(css).not.toMatch(/\.csc-control-boundary \[data-label='true'\]\s*\{[^}]*font-size:/);
    const boundaryBlock = css.match(/\.csc-control-boundary textarea\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(boundaryBlock).not.toContain('min-height:');
  });

  it('renders the add-container action as a compact grouped button', () => {
    expect(css).toMatch(/\.csc-add-container\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*fit-content;[^}]*justify-self:\s*end;/);
    expect(css).toMatch(/\.csc-add-container\s+svg\s*\{[^}]*flex:\s*0 0 auto;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-add-container\s*\{[^}]*width:\s*100%;[^}]*justify-self:\s*stretch;/);
    expect(css).toMatch(/\.csc-add-container\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--accent-soft\) 52%,\s*var\(--surface\)\);[^}]*color:\s*var\(--accent-2\);/);
  });

  it('keeps the shipping-line add action compact on desktop and touch-sized on mobile', () => {
    expect(source).toContain('csc-identity-grid__shipping-line csc-shipping-line-picker');
    expect(source).toContain('className="csc-utility-button csc-utility-button--dashed csc-shipping-line-picker__add"');
    expect(css).toMatch(/\.csc-shipping-line-picker\s*\{[^}]*display:\s*grid;[^}]*gap:\s*8px;/);
    expect(css).toMatch(/\.csc-shipping-line-picker__add\s*\{[^}]*width:\s*fit-content;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-shipping-line-picker__add\s*\{[^}]*width:\s*100%;/);
  });

  it('keeps the route add action compact on desktop and full-width on mobile', () => {
    expect(source).toContain('className="csc-route-picker"');
    expect(source).toContain('csc-route-picker__add');
    expect(css).toMatch(/\.csc-route-picker\s*\{[^}]*display:\s*grid;[^}]*gap:\s*8px;/);
    expect(css).toMatch(/\.csc-route-picker__add\s*\{[^}]*width:\s*fit-content;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-route-picker__add\s*\{[^}]*width:\s*100%;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-route-dialog__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
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

  it('keeps the final actions compact, flat, and aligned by hierarchy', () => {
    expect(summarySource).toContain('Button as UUIButton');
    expect(summarySource).toContain('className="csc-summary__actions" role="group"');
    expect(summarySource).toContain('size="md"');
    expect(summarySource).toContain('color="tertiary"');
    expect(summarySource).toContain('color="primary"');
    expect(summarySource).not.toContain('csc-summary__section');
    expect(css).toMatch(/\.csc-summary__actions\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;[^}]*padding-top:\s*4px;/);
    expect(css).not.toContain('.csc-button');
    expect(css).not.toContain('.csc-summary__actions { display: grid');
  });
});
