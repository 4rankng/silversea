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
    expect(recordRules).toContain('@container (max-width: 620px)');
    // Case 2026-10-11-R14-01 (FB-006 round 14): stacked records stay forms for
    // text/number cells — but picker cells must keep the picked value + detail
    // affordance at EVERY width (owner re-report after the round-13 carve-out),
    // revealing their editor only while the menu is open.
    expect(recordRules).toMatch(/\.csc-container-cell:not\(\.csc-container-cell--picker\) \.csc-container-cell__display\s*\{[^}]*display:\s*none;/);
    expect(recordRules).toMatch(/\.csc-container-cell:not\(\.csc-container-cell--picker\) \.csc-container-cell__editor > \*\s*\{[^}]*opacity:\s*1;/);
    expect(recordRules).toMatch(/\.csc-container-cell \.csc-route-picker\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
    expect(recordRules).toMatch(/\.csc-container-cell \.csc-route-picker__add\s*\{[^}]*min-height:\s*var\(--control-max-h\);/);
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
    // Horizontal-only scroll box: `overflow-x: auto` alone forces
    // `overflow-y: auto` and the horizontal scrollbar's height makes the table
    // overflow vertically — the page painted TWO scrollbars over one table.
    expect(css).toMatch(/\.csc-container-table-scroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/);
    expect(css).toMatch(/\.csc-container-table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*1038px;[^}]*table-layout:\s*fixed;/);
    expect(css).toMatch(/\.csc-container-col__route\s*\{[^}]*width:\s*180px;/);
    expect(css).toMatch(/\.csc-container-col__index\s*\{[^}]*width:\s*40px;/);
    expect(css).toMatch(/\.csc-container-col__weight\s*\{[^}]*width:\s*96px;/);
    expect(css).toMatch(/\.csc-container-col__actions\s*\{[^}]*width:\s*44px;/);
    expect(css).toMatch(/\.csc-container-col__pickup-port,\s*\.csc-container-col__dropoff-port,\s*\.csc-container-col__factory\s*\{[^}]*width:\s*auto;/);
    // The appointment column is deliberately NOT auto: the SplitDateTimeField
    // it holds carries min-width:max-content segment groups, so its floor is
    // ~171px and an auto track sheared the date half of the control out of the
    // cell (only "HH :" stayed visible). The declared width must clear it.
    const appointmentWidth = Number(/\.csc-container-col__appointment\s*\{[^}]*width:\s*(\d+)px;/.exec(css)?.[1] ?? 0);
    expect(appointmentWidth).toBeGreaterThanOrEqual(172);
    expect(css).not.toMatch(/\.csc-container-col__appointment[,\s][^{]*\{[^}]*width:\s*auto;/);
    expect(css).not.toMatch(/\.csc-container-table thead th:nth-child\([^)]*\)\s*\{[^}]*width:\s*\d+%;/);
    expect(css).toMatch(/\.csc-container-table td:not\(\.csc-container-row__actions\)\s*>\s*\*\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.csc-container-table select\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  });

  it('keeps the quantity-plus-add control touch-safe and contained on mobile', () => {
    expect(css).toMatch(/\.csc-container-actions\s*\{[^}]*justify-content:\s*flex-end;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-container-add-control\s*\{[^}]*grid-template-columns:\s*72px minmax\(0,\s*1fr\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-container-add-control input[^}]*min-height:\s*var\(--control-max-h\);/);
  });

  it('uses shared headers on desktop and deliberate record layouts below the wide canvas', () => {
    // Desktop keeps a styled shared header row; below the wide canvas the
    // header row and its colgroup step aside for the record layout.
    expect(css).toMatch(/\.csc-container-table thead th\s*\{[^}]*background:\s*var\(--surface-2\);[^}]*font-weight:\s*700;/);
    expect(css).toMatch(/@container\s*\(max-width:\s*620px\)[\s\S]*?\.csc-container-table thead,\s*\.csc-container-table colgroup\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/@container\s*\(max-width:\s*620px\)[\s\S]*?\.csc-container-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    // Mobile UX consult 16/10 supersedes the 11/10 single-column phone tier:
    // the stacked record stays a grouped 2-column form at EVERY phone width —
    // labelled divider bands open the sub-sections, and only the appointment
    // pair gives its right half back below the segment min-content width
    // (see the cluster-geometry pin below). Phones keep the grouped grid.
    expect(css).toMatch(/@container\s*\(max-width:\s*620px\)[\s\S]*?\.csc-container-row__group\s*\{[^}]*text-transform:\s*uppercase;/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-container-row\s*\{[^}]*padding:\s*8px 8px 10px;/,
    );
  });

  it('keeps the active editor visible while a cell popover owns focus', () => {
    // The reveal trigger is the combobox menu itself ([role='combobox'][aria-expanded]),
    // so a detail-popover button carrying its own aria-expanded never swaps the cell.
    expect(spreadsheetCellCss).toMatch(/\.csc-container-cell:has\(\[role='combobox'\]\[aria-expanded='true'\]\) \.csc-container-cell__display\s*\{[^}]*opacity:\s*0;/);
    expect(spreadsheetCellCss).toMatch(/\.csc-container-cell:has\(\[role='combobox'\]\[aria-expanded='true'\]\) \.csc-container-cell__editor > \*\s*\{[^}]*opacity:\s*1;/);
  });

  it('renders the cargo option set as the app segmented control, not pill-shaped blocks', () => {
    // Card 20260922_31: the grouped option set wears the app's normal
    // connected segmented treatment — one shared border around the group,
    // compact segments, no per-option box.
    expect(css).toMatch(/\.csc-mode > div\s*\{[^}]*display:\s*inline-flex;[^}]*overflow:\s*hidden;[^}]*border:\s*1px solid var\(--line-2\);[^}]*border-radius:\s*8px;/);
    expect(css).toMatch(/\.csc-mode__option\s*\{[^}]*min-height:\s*34px;[^}]*border:\s*0;[^}]*border-radius:\s*0;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-mode__option[^}]*min-height:\s*var\(--control-max-h\);/);
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

  it('uses one desktop decision row for cargo type', () => {
    // The three data flags moved into the identity `Tuỳ chọn` band (owner mock
    // 11/10), so the cargo row carries the Loại hàng decision set alone.
    expect(css).toMatch(/\.csc-cargo-choice-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*align-items:\s*end;/);
    // ONE data-flag treatment: all three flags share ONE chip class — the
    // owner mock 11/10 supersedes the 20260922_31 plain box (bordered chip,
    // brand-soft fill when checked). Still no per-flag variants.
    expect(css).toMatch(/\.csc-flag-checkbox\s*\{[^}]*min-height:\s*34px;[^}]*border:\s*1px solid var\(--line-2\);[^}]*border-radius:\s*10px;[^}]*background:\s*var\(--surface\);/);
    expect(css).toMatch(/\.csc-flag-checkbox:has\(input:checked\)\s*\{[^}]*border-color:\s*var\(--accent-2\);[^}]*background:\s*var\(--accent-soft\);/);
    expect(css).not.toContain('.csc-combined-toggle');
    expect(css).not.toContain('.csc-adhoc-toggle');
    // ONE plain flag treatment: the sheet never styles hint text inside it.
    expect(css).not.toMatch(/\.csc-flag-checkbox small/);
  });

  it('gives customer identity the widest column and reflows cleanly by viewport', () => {
    expect(css).toMatch(/\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\);/);
    // Owner mock 11/10 column map: 6 / 3 / 3 across one 12-column track.
    expect(css).toMatch(/\.csc-identity-grid__customer\s*\{[^}]*grid-column:\s*span 6;/);
    expect(css).toMatch(/\.csc-identity-grid__trade-direction\s*\{[^}]*grid-column:\s*span 3;/);
    expect(css).toMatch(/\.csc-identity-grid__booking\s*\{[^}]*grid-column:\s*span 3;/);
    // Below the 12-column canvas the customer field stops sharing a half row
    // (owner report 11/10: three identity fields ride ONE row on a laptop —
    // the collapse starts at 820px, not at the tablet width).
    expect(css).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.csc-identity-grid__customer,\s*\.csc-identity-grid__flags--solo\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
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
    expect(css).toMatch(/\.csc-form\s*\{[^}]*gap:\s*10px;/);
    expect(css).toMatch(/\.csc-section\s*\{[^}]*border:\s*0\s*!important;[^}]*background:\s*var\(--surface\)\s*!important;/);
    expect(css).toMatch(/\.csc-section__heading\s*\{[^}]*margin:\s*-14px -14px 0;[^}]*background:\s*var\(--surface-2\);/);
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
    // Owner mock 11/10: the topline retires the fixed action bar, so the page
    // clears nothing extra and the dense worksheet gaps read 10px.
    expect(css).toMatch(/\.csc-page\s*\{[^}]*width:\s*100%;[^}]*margin:\s*0;[^}]*padding:\s*12px 0;/);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*?\.csc-page\s*\{[^}]*padding:\s*12px 0;/);
    expect(css).toMatch(/\.csc-workspace\s*\{[^}]*gap:\s*10px;/);
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

  it('keeps the quick-create action trailing its field as a flex sibling with a real hit target', () => {
    // Owner ruling 11/10 put an icon-only + INSIDE the control's right edge.
    // FB-114 superseded that for this control: the absolute 26px overlay raced
    // the input for clicks (z-index 1 over the input's reserved padding) and
    // sat under the 32px touch floor. The action now trails the field as a
    // flex SIBLING — never a row of its own, never an overlay on the input.
    expect(css).toMatch(/\.csc-field-with-append\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*flex-start;/);
    expect(css).not.toMatch(/\.csc-field-with-append\s*\{[^}]*position:\s*relative;/);
    expect(css).toMatch(/\.csc-field-with-append > :first-child\s*\{[^}]*flex:\s*1 1 auto;[^}]*align-self:\s*start;/);
    // The input no longer reserves room for an overlay that is not there.
    expect(css).not.toMatch(/\.csc-field-with-append > :first-child input\s*\{[^}]*padding-right:/);
    // 36px square on the control row (label 18px + gap 8px margin-top);
    // no absolute positioning left to lose a click race.
    expect(css).toMatch(/\.csc-append-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*margin-top:\s*26px;/);
    expect(css).not.toMatch(/\.csc-append-button\s*\{[^}]*position:\s*absolute;/);
    // A press must register visually (FB-114: the click felt dead).
    expect(css).toMatch(/\.csc-append-button:not\(:disabled\):active\s*\{[^}]*transform:\s*translateY\(1px\);/);
    // The old beside-the-field row (and its phone full-width override) is gone.
    expect(css).not.toMatch(/\.csc-append-button\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).not.toMatch(/\.csc-field-with-append\s*\{\s*flex-wrap:\s*wrap;/);
  });

  it('pairs the two recipient notes on one dense row', () => {
    expect(css).toMatch(/\.csc-notes-grid\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)\s*\{\s*\.csc-notes-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  });

  it('gives the declaration entry the dense chip input (owner reference)', () => {
    // No single-row field shares a grid row with the 1-to-N declaration entry:
    // the carrier + flag band stays a partial-width pair (owner density pass
    // 11/10: carrier 6 columns, the `Tuỳ chọn` chips the other 6).
    expect(css).toMatch(/\.csc-identity-grid__shipping-line\s*\{[^}]*grid-column:\s*span 6;/);
    expect(css).toMatch(/\.csc-identity-grid__flags\s*\{[^}]*grid-column:\s*span 6;/);
    expect(css).not.toContain('.csc-identity-grid__declaration');
    // One bordered field holds the chips AND the entry (click anywhere in it
    // focuses the entry), the head carries the bulk actions, the foot the hint.
    expect(css).toMatch(/\.csc-declaration-strip\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.csc-declaration-strip__field\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*max-height:\s*120px;[^}]*overflow-y:\s*auto;[^}]*cursor:\s*text;/);
    expect(css).toMatch(/\.csc-declaration-strip__field:focus-within\s*\{[^}]*border-color:\s*var\(--accent\);/);
    expect(css).toMatch(/\.csc-declaration-strip__input\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*180px;[^}]*border:\s*0;/);
    expect(css).toMatch(/\.csc-declaration-strip__actions\s*\{[^}]*margin-left:\s*auto;/);
    expect(css).toMatch(/\.csc-declaration-chip\s*\{[^}]*border-radius:\s*6px;/);
    expect(css).toMatch(/\.csc-declaration-chip--flash\s*\{/);
    expect(css).toMatch(/\.csc-declaration-strip__bulk-input\s*\{/);
    // The per-declaration row list is retired — no leftover class names.
    expect(css).not.toContain('.csc-declaration-ledger');
    expect(css).not.toContain('.csc-declaration-row');
    expect(css).not.toContain('.csc-declaration-list');
    expect(css).not.toContain('.csc-declaration-chips');
  });

  it('retires the stacked declaration fields and orphan add lines', () => {
    expect(css).not.toContain('.csc-customer-picker');
    expect(css).not.toContain('.csc-shipping-line-picker');
    expect(css).not.toContain('.csc-declaration-picker');
    expect(css).not.toContain('.csc-deposit-row');
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

  it('styles validation summary as a compact neutral card with surface tokens and no pink wall (card 181026180300)', () => {
    expect(css).toMatch(/\.csc-validation-summary\s*\{[^}]*max-width:\s*520px;[^}]*background:\s*var\(--surface\);/);
    expect(css).toMatch(/\.csc-validation-summary\s*\{[^}]*border:\s*1px solid var\(--border-1\);/);
    expect(css).not.toMatch(/\.csc-validation-summary\s*\{[^}]*background:\s*var\(--warning-soft\);/);
    expect(css).not.toMatch(/\.csc-validation-summary\s*\{[^}]*background:\s*var\(--danger-soft\);/);
  });

  it('uses the full workspace width and keeps actions in the form flow', () => {
    expect(css).toMatch(/\.csc-workspace\s*\{[^}]*display:\s*grid;[^}]*gap:\s*10px;[^}]*min-width:\s*0;/);
    expect(css).not.toContain('grid-template-columns: minmax(0, 1fr) minmax(280px, 320px)');
    expect(css).not.toContain('.csc-readiness');
    expect(css).toMatch(/\.csc-summary\s*\{[^}]*display:\s*grid;[^}]*gap:\s*12px;[^}]*min-width:\s*0;/);
    expect(css).not.toContain('position: sticky');
  });

  it('keeps the create actions on the page topline', () => {
    // Owner mock 11/10 ("Tạo lô hàng – dense layout.html"): title, required
    // progress and Huỷ / Lưu nháp / Tạo lô hàng ride ONE row at the head of the
    // worksheet. The fixed bottom bar this supersedes is retired for good.
    expect(css).toMatch(/\.csc-topline\s*\{[^}]*display:\s*flex;/);
    expect(css).toMatch(/\.csc-topline__actions\s*\{[^}]*margin-left:\s*auto;/);
    expect(css).not.toContain('.csc-action-bar');
    expect(css).not.toContain('csc-action-bar-h');
    expect(css).not.toContain('.csc-page__title');
    expect(css).not.toContain('.csc-summary__actions');
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

/* ─── Card 051026230627 — the appointment cluster as a tap surface ─────────
 * The create-form "Ngày giờ đóng trả" cluster rendered as five tiny
 * spinbox-sized segments (hh 20px … yyyy 35px on a 175×30 cluster). The
 * expectation allows the spacious-cluster alternative to a picker redesign:
 * the cluster must carry touch-height segments, a readable font, full row
 * width on phones, and a table column wide enough to hold the larger pair
 * (the 176px floor above was measured for the 12px control font). */
describe('CUS "Ngày giờ đóng trả" cluster geometry (cards 051026230627 → 111026173000)', () => {
  it('gives the appointment segments touch height at the house field font', () => {
    // The base UUI geometry derives inner heights from --uui-control-h and the
    // segments' font from --text-control-compact-size; the fix overrides those
    // variables on the cluster's control boundaries (per-element height rules
    // lose to the base sheet's ID-level min-height resets). The 16px font that
    // landed with the card is reversed by the owner report 11/10 ("bloated,
    // oversize" against the 11-12px house scale): touch height STAYS, the font
    // reads the shared field token — never a hardcoded pixel size.
    expect(css).toMatch(
      /\.csc-container-cell--appointment [\s\S]{0,160}?--uui-control-h:\s*var\(--control-touch-h/,
    );
    expect(css).toMatch(
      /\.csc-container-cell--appointment [\s\S]{0,200}?--text-control-compact-size:\s*var\(--control-field-font-size\)/,
    );
    expect(css).not.toMatch(
      /\.csc-container-cell--appointment [\s\S]{0,200}?--text-control-compact-size:\s*\d+px/,
    );
  });

  it('claims full row width on phones so the cluster is never squeezed', () => {
    // Mobile UX consult 16/10: Ngày giờ đóng trả pairs with Trọng lượng in the
    // grouped 2-column record, but the SplitDateTimeField's segment groups
    // hold a ~150px min-content — the law (cards 051026230627 → 111026173000,
    // "never squeezed") now pins the fallback: below a 380px container the
    // appointment returns to full row width instead of shearing the date half.
    expect(css).toMatch(
      /@container\s*\(max-width:\s*380px\)[\s\S]*?\.csc-container-cell--appointment\s*\{[^}]*grid-column:\s*1 \/ -1;/,
    );
  });

  it('keeps the desktop column at the 12px-scale cluster floor', () => {
    // The em-based segment widths scale with the font: at the 12px field font
    // the pair needs ~200px or the table scroll box shears the date half off.
    // 176px left the segments cramped (card 051026230627); 240px was the 16px
    // era's floor.
    expect(css).toMatch(/\.csc-container-col__appointment\s*\{\s*width:\s*200px/);
  });
});

/* ─── Copy affordance AX/actionability contract (card 101026163010) ────────
 * `visibility: hidden` takes the per-row copy button OUT of the accessibility
 * tree and out of Playwright/CDT actionability until the pointer happens to
 * hover the row — QA saw the button "sometimes in the AX tree" and clicks
 * that waited for visibility never landed (round 12 PASS / round 13 FAIL was
 * pointer-position luck, not copy logic). The reveal mechanism is therefore
 * `opacity: 0` at rest: still rendered, still in the AX tree, still
 * hit-testable, visually identical because a pointer that can reach the
 * button is already on the row, which reveals it. Both copy sites (create
 * form + CUS ledger) share the contract. */
describe('copy affordance AX/actionability contract (card 101026163010)', () => {
  const ledgerCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
  const blockOf = (text: string, selector: string) => {
    const i = text.indexOf(selector);
    expect(i, `selector missing: ${selector}`).toBeGreaterThan(-1);
    return text.slice(i, text.indexOf('}', i) + 1);
  };

  it('keeps both copy buttons in the accessibility tree at rest', () => {
    const createBlock = blockOf(css, '.csc-container-row__copy {');
    expect(createBlock).toMatch(/opacity:\s*0;/);
    expect(createBlock).not.toMatch(/visibility:\s*hidden/);

    const ledgerBlock = blockOf(ledgerCss, '\n.cus-container-row__copy {');
    expect(ledgerBlock).toMatch(/opacity:\s*0;/);
    expect(ledgerBlock).not.toMatch(/visibility:\s*hidden/);
  });

  it('reveals on row hover and row focus-within at both sites', () => {
    expect(css).toMatch(
      /\.csc-container-row:hover \.csc-container-row__copy,[\s\S]*?\.csc-container-row:focus-within \.csc-container-row__copy \{[^}]*opacity:\s*1;/,
    );
    expect(ledgerCss).toMatch(
      /\.cus-container-row:hover \.cus-container-row__copy,[\s\S]*?\.cus-container-row:focus-within \.cus-container-row__copy \{[^}]*opacity:\s*1;/,
    );
  });

  it('reveals on keyboard focus and on coarse/narrow screens at both sites', () => {
    expect(css).toMatch(/\.csc-container-row__copy:focus-visible \{[^}]*opacity:\s*1;/);
    expect(ledgerCss).toMatch(/\.cus-container-row__copy:focus-visible \{[^}]*opacity:\s*1;/);
    expect(css).toMatch(/\.csc-container-row__copy \{\s*opacity:\s*1;/);
    expect(ledgerCss).toMatch(/\.cus-container-row__copy \{\s*opacity:\s*1;/);
  });
});
