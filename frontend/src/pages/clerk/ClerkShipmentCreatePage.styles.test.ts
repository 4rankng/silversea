import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/clerk/ClerkShipmentCreatePage.css'), 'utf8');
const spreadsheetCellCss = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/create/ShipmentContainerCell.css'),
  'utf8',
);
// Every assertion below reads the page stylesheet, never the TSX source: the
// sheet is where the layout contract lives, and a markup pin stays green
// through a rendered regression. The DOM side of these promises is covered by
// ClerkShipmentCreatePage.test.tsx and ShipmentCreateWorkspace.*.test.tsx.
const CONTAINER_COLUMNS = [
  'index',
  'number',
  'type',
  'route',
  'pickup-port',
  'dropoff-port',
  'factory',
  'appointment',
  'weight',
  'actions',
] as const;

describe('shipment create responsive layout', () => {
  it('shows mobile record controls directly and keeps inline catalog actions beside selectors', () => {
    const recordRules = css.slice(css.indexOf('/* Stacked records'));
    expect(recordRules).toContain('@container (max-width: 1037px)');
    expect(recordRules).toMatch(/\.csc-container-cell \.csc-container-cell__display\s*\{[^}]*display:\s*none;/);
    expect(recordRules).toMatch(/\.csc-container-cell \.csc-container-cell__editor > \*\s*\{[^}]*opacity:\s*1;/);
    expect(recordRules).toMatch(/\.csc-container-cell \.csc-route-picker\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
    expect(recordRules).toMatch(/\.csc-container-cell \.csc-route-picker__add\s*\{[^}]*min-height:\s*44px;/);
  });

  it('gives every form control a persistent visible boundary and focus state', () => {
    // ONE boundary surface shared by every adapter family: the wrapper's
    // presentation layer, the nested input wrapper and the grouped surfaces.
    expect(css).toMatch(/\.csc-control-boundary \[data-input-wrapper='true'\]/);
    expect(css).toMatch(/\.csc-control-boundary \[role='group'\]/);
    expect(css).toMatch(/\.csc-control-boundary > \[role='presentation'\][\s\S]*?border:\s*1px solid/);
    expect(css).toMatch(/\.csc-control-boundary > \[role='presentation'\][\s\S]*?background:\s*var\(--surface/);
    expect(css).toMatch(/\.csc-control-boundary:focus-within > \[role='presentation'\][\s\S]*?border-color:\s*var\(--accent/);
    expect(css).toMatch(/\.csc-control-boundary:focus-within > \[role='presentation'\][\s\S]*?box-shadow:\s*0 0 0 3px/);
    expect(css).toMatch(/\.csc-control-boundary :where\(input, select, textarea\):focus-visible\s*\{[^}]*outline:\s*none;[^}]*outline-offset:\s*0;/);
    // Single visible boundary per control: a retired blanket rule painted a
    // second border+padding onto the nested transparent inputs (box-in-box);
    // it must stay retired.
    expect(css).not.toMatch(/\.csc-form :where\(input, select, textarea\)/);
    // Field-label parity across families (combobox + text/date join the
    // select's shared compact label role).
    expect(css).toMatch(/\.csc-searchable-field label,\s*\n\s*\.csc-uui-field label\s*\{[^}]*font-size:\s*var\(--text-label-size\);/);
  });

  it('fills the desktop workspace while keeping short-value columns compact', () => {
    // The sheet declares a width for each of the ten columns the desktop
    // workspace lays out.
    for (const column of CONTAINER_COLUMNS) {
      expect(css).toMatch(new RegExp(`\\.csc-container-col__${column}[\\s,][^{]*\\{[^}]*width:`));
    }
    expect(css).toMatch(/\.csc-container-editor\s*\{[^}]*container-type:\s*inline-size;[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.csc-container-table-scroll\s*\{[^}]*width:\s*100%;/);
    expect(css).toMatch(/\.csc-container-table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*1038px;[^}]*table-layout:\s*fixed;/);
    expect(css).toMatch(/\.csc-container-col__route\s*\{[^}]*width:\s*180px;/);
    expect(css).toMatch(/\.csc-container-col__index\s*\{[^}]*width:\s*40px;/);
    expect(css).toMatch(/\.csc-container-col__weight\s*\{[^}]*width:\s*96px;/);
    expect(css).toMatch(/\.csc-container-col__actions\s*\{[^}]*width:\s*44px;/);
    expect(css).toMatch(/\.csc-container-col__pickup-port,[^}]*\.csc-container-col__appointment\s*\{[^}]*width:\s*auto;/);
    expect(css).not.toMatch(/\.csc-container-table thead th:nth-child\([^)]*\)\s*\{[^}]*width:\s*\d+%;/);
    expect(css).toMatch(/\.csc-container-table td:not\(\.csc-container-row__actions\)\s*>\s*\*\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.csc-container-table select\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  });

  it('keeps the quantity-plus-add control touch-safe and contained on mobile', () => {
    expect(css).toMatch(/\.csc-container-actions\s*\{[^}]*justify-content:\s*flex-end;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-container-add-control\s*\{[^}]*grid-template-columns:\s*72px minmax\(0,\s*1fr\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-container-add-control input[^}]*min-height:\s*44px;/);
  });

  it('uses shared headers on desktop and deliberate record layouts below the wide canvas', () => {
    // Desktop keeps a styled shared header row; below the wide canvas the
    // header row and its colgroup step aside for the record layout.
    expect(css).toMatch(/\.csc-container-table thead th\s*\{[^}]*background:\s*var\(--surface-2\);[^}]*font-weight:\s*700;/);
    expect(css).toMatch(/@container\s*\(max-width:\s*1037px\)[\s\S]*?\.csc-container-table thead,\s*\.csc-container-table colgroup\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/@container\s*\(max-width:\s*1037px\)[\s\S]*?\.csc-container-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-container-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
  });

  it('keeps the active editor visible while a cell popover owns focus', () => {
    expect(spreadsheetCellCss).toMatch(/\.csc-container-cell:has\(\[aria-expanded='true'\]\) \.csc-container-cell__display\s*\{[^}]*opacity:\s*0;/);
    expect(spreadsheetCellCss).toMatch(/\.csc-container-cell:has\(\[aria-expanded='true'\]\) \.csc-container-cell__editor > \*\s*\{[^}]*opacity:\s*1;/);
  });

  it('renders the cargo option set as the app segmented control, not pill-shaped blocks', () => {
    // Card 20260922_31: the grouped option set wears the app's normal
    // connected segmented treatment — one shared border around the group,
    // compact segments, no per-option box.
    expect(css).toMatch(/\.csc-mode > div\s*\{[^}]*display:\s*inline-flex;[^}]*overflow:\s*hidden;[^}]*border:\s*1px solid var\(--line-2\);[^}]*border-radius:\s*8px;/);
    expect(css).toMatch(/\.csc-mode__option\s*\{[^}]*min-height:\s*34px;[^}]*border:\s*0;[^}]*border-radius:\s*0;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-mode__option[^}]*min-height:\s*44px;/);
    // The old faux-radio dot and the 8px option boxes are gone for good.
    expect(css).not.toMatch(/\.csc-mode__option::before/);
    expect(css).not.toMatch(/\.csc-mode > div\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
    expect(css).not.toMatch(/\.csc-mode\s+span(?:\s*\{|::before)/);
  });

  it('uses the app ink-fill selected segment for cargo mode', () => {
    expect(css).toMatch(/\.csc-mode__option\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--fg-2\);/);
    expect(css).toMatch(/\.csc-mode input:checked \+ span\s*\{[^}]*background:\s*var\(--ink\);[^}]*color:\s*var\(--surface\);/);
    expect(css).not.toMatch(/\.csc-mode input:checked \+ span\s*\{[^}]*(?:accent-soft|brand-subtle)/);
  });

  it('uses one desktop decision row for cargo type and combined-load handling', () => {
    expect(css).toMatch(/\.csc-cargo-choice-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(280px,\s*1fr\);[^}]*align-items:\s*end;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*?\.csc-cargo-choice-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    // ONE data-flag treatment (card 20260922_31): all three flags share the
    // plain inline checkbox class — the bordered chip and the bordered
    // combined box are retired from both the markup and the sheet.
    expect(css).toMatch(/\.csc-flag-checkbox\s*\{[^}]*min-height:\s*34px;[^}]*border:\s*0;[^}]*background:\s*none;/);
    expect(css).not.toContain('.csc-combined-toggle');
    expect(css).not.toContain('.csc-adhoc-toggle');
    // ONE plain flag treatment: the sheet never styles hint text inside it.
    expect(css).not.toMatch(/\.csc-flag-checkbox small/);
  });

  it('gives customer identity the widest column and reflows cleanly by viewport', () => {
    expect(css).toMatch(/\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\);/);
    expect(css).toMatch(/\.csc-identity-grid__customer\s*\{[^}]*grid-column:\s*span 6;/);
    // Below the 12-column canvas the customer field stops sharing a half row.
    expect(css).toMatch(/@media\s*\(max-width:\s*1100px\)[\s\S]*?\.csc-identity-grid__customer\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*1100px\)[\s\S]*?\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  });

  it('lets customer names use the trigger width and wrap inside a wider menu', () => {
    // Token-agnostic on purpose: assert the CONTRACT (a wide-enough menu on a
    // surface), not the literal fallback value. The stylesheet was cleaned to
    // `var(--surface)` — the token always resolves — and pinning `#fff` broke
    // a correct rule (card 20260928_153).
    expect(css).toMatch(/\.csc-customer-popover\s*\{[^}]*min-width:\s*min\(32rem,\s*calc\(100vw - 32px\)\);[^}]*background:\s*var\(--surface/);
    expect(css).toMatch(/\.csc-customer-popover \.csc-customer-option \[slot='label'\]\s*\{[^}]*white-space:\s*normal;/);
  });

  it('separates form sections from the application canvas without decorative elevation', () => {
    expect(css).toMatch(/\.app-main:has\(\.csc-page\)\s*\{[^}]*background:\s*var\(--surface-3\);/);
    expect(css).toMatch(/\.csc-form\s*\{[^}]*gap:\s*12px;/);
    expect(css).toMatch(/\.csc-section\s*\{[^}]*border:\s*0\s*!important;[^}]*background:\s*var\(--surface\)\s*!important;/);
    expect(css).toMatch(/\.csc-section__heading\s*\{[^}]*margin:\s*-18px -18px 0;[^}]*background:\s*var\(--surface-2\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-section__heading\s*\{[^}]*margin:\s*-8px -8px 0;/);
    expect(css).not.toMatch(/\.csc-section\s*\{[^}]*box-shadow:/);
  });

  it('renders section titles without sequential number badges', () => {
    // The sheet styles no badge span inside a section heading; the rendered
    // heading names (no leading number) are pinned in
    // ClerkShipmentCreatePage.test.tsx.
    expect(css).not.toContain('.csc-section__heading > span');
  });

  it('uses compact desktop density while retaining mobile touch targets', () => {
    // Compact desktop density is the sheet's shared compact tokens, not a
    // per-control override; the adapters' own compact default is pinned by
    // uui-fields.test.tsx through `data-control-size`.
    expect(css).toMatch(/\.csc-utility-button\s*\{[^}]*min-height:\s*var\(--control-compact-h,\s*34px\);/);
    expect(css).toMatch(/\.csc-mode legend\s*\{[^}]*font-size:\s*var\(--control-compact-font-size\);[^}]*line-height:\s*var\(--control-compact-line-height\);/);
    expect(css).toMatch(/\.csc-mode__option\s*\{[^}]*font-size:\s*var\(--control-compact-font-size\);[^}]*line-height:\s*var\(--control-compact-line-height\);/);
    expect(css).toMatch(/\.csc-flag-checkbox\s*\{[^}]*font-size:\s*var\(--control-compact-font-size\);[^}]*line-height:\s*var\(--control-compact-line-height\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-mode legend,\s*\.csc-mode__option,\s*\.csc-flag-checkbox\s*\{[^}]*font-size:\s*var\(--control-compact-touch-font-size\);[^}]*line-height:\s*var\(--control-compact-touch-line-height\);/);
    expect(css).toMatch(/\.app-main:has\(\.csc-page\) \.app-body\s*\{[^}]*--app-body-pad-x:\s*8px;/);
    expect(css).toMatch(/\.app-main:not\(\.driver-mode\) \.app-body > \.csc-page\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*margin-inline:\s*0;/);
    expect(css).toMatch(/\.csc-page\s*\{[^}]*width:\s*100%;[^}]*margin:\s*0;[^}]*padding:\s*12px 0 28px;/);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*?\.csc-page\s*\{[^}]*padding-bottom:\s*calc\(44px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    expect(css).toMatch(/\.csc-workspace\s*\{[^}]*gap:\s*12px;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-section\s*\{[^}]*padding:\s*8px\s*!important;[^}]*gap:\s*10px\s*!important;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-section__heading\s*\{[^}]*padding:\s*10px 8px;/);
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
    // The picker owns the shipping-line identity column and its add action
    // rides the dashed utility-button treatment.
    expect(css).toMatch(/\.csc-identity-grid__shipping-line,\s*\.csc-identity-grid__declaration\s*\{[^}]*grid-column:\s*span 6;/);
    expect(css).toMatch(/\.csc-utility-button--dashed\s*\{[^}]*background:\s*transparent;/);
    expect(css).toMatch(/\.csc-shipping-line-picker\s*\{[^}]*display:\s*grid;[^}]*gap:\s*8px;/);
    expect(css).toMatch(/\.csc-shipping-line-picker__add\s*\{[^}]*width:\s*fit-content;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-shipping-line-picker__add\s*\{[^}]*width:\s*100%;/);
  });

  it('keeps the route add action compact on desktop and full-width on mobile', () => {
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
    expect(css).toMatch(/\.csc-summary__actions\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;[^}]*padding-top:\s*4px;/);
    expect(css).not.toContain('.csc-button');
    expect(css).not.toContain('.csc-summary__actions { display: grid');
  });
});

describe('copy-icon STT placement rework (20260918_3)', () => {
  const ledgerCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

  const ruleBlock = (cssText: string, selector: string) => {
    const i = cssText.indexOf(selector);
    return cssText.slice(i, cssText.indexOf('}', i) + 1);
  };

  it('create copy button is truly centered in the STT cell (translate both axes)', () => {
    const block = ruleBlock(css, '.csc-container-row__copy {');
    expect(block).toMatch(/transform:\s*translate\(-50%,\s*-50%\)/);
    expect(block).toMatch(/border-radius:\s*8px/);
  });

  it('ledger copy button keeps the shared shape, hugging the right edge in card mode', () => {
    const block = ruleBlock(ledgerCss, '\n.cus-container-row__copy {');
    expect(block).toMatch(/width:\s*26px/);
    expect(block).toMatch(/height:\s*26px/);
    expect(block).toMatch(/border-radius:\s*8px/);
    // Card mode pins the ordinal top-right; the copy affordance follows it
    // there so it can never sit on the container code.
    const cardBlock = ruleBlock(ledgerCss, '.cus-container-table .cus-container-row__copy {');
    expect(cardBlock).toMatch(/right:\s*12px/);
    expect(cardBlock).toMatch(/left:\s*auto/);
  });

  it('create container rows carry the compact in-row control height (30px)', () => {
    expect(css).toMatch(/@media \(min-width: 641px\)\s*\{\s*\.csc-container-row \.csc-icon-button \{\s*min-width: 30px;\s*min-height: 30px;/);
  });
});

describe('global hover reset — copy-icon exclusions (20260918_3 cut D)', () => {
  const baseCss = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');

  it('the global hover reset exempts both copy-icon affordances', () => {
    const rule = baseCss.slice(baseCss.indexOf(":where(button, a, [role='button'])"));
    expect(rule).toContain(':not(.csc-container-row__copy)');
    expect(rule).toContain(':not(.shipment-container-ledger__copy)');
  });
});
