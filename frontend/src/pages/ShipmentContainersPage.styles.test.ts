import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.tsx'), 'utf8');
const ledgerSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/detail/ShipmentContainerLedger.tsx'), 'utf8');
const railCss = readFileSync(resolve(process.cwd(), 'src/design-system/SummaryRail.css'), 'utf8');
const missingSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/detail/ShipmentMissingFieldsSummary.tsx'), 'utf8');

describe('shipment detail workboard styling', () => {
  it('UI-CD-14 leaves nested shared control inputs to their own component styling', () => {
    const selector = css.match(/(\.shipment-container-ledger__editor-grid input[^,]+),/)?.[1];
    expect(selector).toBeTruthy();
    const grid = document.createElement('div');
    grid.className = 'shipment-container-ledger__editor-grid';
    grid.innerHTML = '<label><input id="native"></label><div data-uui-control><input id="direct"></div><div data-uui-control><div><div><input id="nested"></div></div></div>';
    expect(grid.querySelector('#native')!.matches(selector!)).toBe(true);
    expect(grid.querySelector('#direct')!.matches(selector!)).toBe(false);
    expect(grid.querySelector('#nested')!.matches(selector!)).toBe(false);
  });

  it('UI-CD-14 retains equal touch sizing on coarse-pointer tablets', () => {
    expect(css).toMatch(/@media \(pointer:\s*coarse\)[\s\S]*?\.shipment-container-ledger__editor-grid input:not\(\[data-uui-control\] input\),[\s\S]*?\.searchable-select__trigger\s*\{[^}]*height:\s*var\(--control-touch-h\);[^}]*min-height:\s*var\(--control-touch-h\);/);
  });

  it('SIL-877: the detail canvas fills the shell uncapped — the 1800px cap is retired', () => {
    expect(css).toMatch(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-detail-page\s*\{[^}]*width:\s*100%;/);
    expect(css).not.toMatch(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-detail-page\s*\{[^}]*max-width/);
    expect(css).not.toMatch(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-detail-page\s*\{[^}]*margin-inline/);
    expect(css).not.toContain('1800px');
  });

  it('uses a compact filter-only header and aligns the mixed control families', () => {
    expect(css).not.toContain('.shipments-detail-workspace__intro');
    expect(css).not.toContain('.shipments-detail-eyebrow');
    expect(css).not.toMatch(/\.shipments-detail-filter input::placeholder\s*\{[^}]*font-size\s*:/);
    expect(css).not.toContain('.shipments-detail-filters__actions');
    // Card 20260922_42: the shared FilterBar owns row layout; the
    // self-made 12-col owner grid (card _36) is superseded and deleted.
    expect(source).toContain('<FilterBar');
    expect(css).not.toMatch(/\.shipments-detail-filters\s*\{[^}]*grid-template-columns/);
    // Card 20260927_152: the page declares no filter layout and no filter
    // width — `.filter-bar`'s wrapping row sizes every control, and the four
    // secondary criteria ride `FilterDropdown` while they fit. The deleted
    // rules must not come back (the 320px wrapper, the input stretch, the
    // page-local `gap` declarations).
    expect(source).toContain('<FilterDropdown');
    expect(css).not.toMatch(/\.shipments-detail-filter\s*\{[^}]*(?:flex|width|gap)\s*:/);
    expect(css).not.toMatch(/\.shipments-detail-filter > \*\s*\{/);
    expect(css).not.toMatch(/\.shipments-detail-filter input\s*\{[^}]*width\s*:/);
    expect(css).not.toMatch(/\.shipments-detail-filter[^{]*\{[^}]*gap\s*:/);
    // Date presets ride the shared preset primitives (operator ruling
    // 2026-09-27): boxed chips on the bar, the same ranges as a dropdown in
    // `Bộ lọc` — no page-local segmented-control CSS survives.
    expect(source).toMatch(/<DateRangePresets[\s\S]*ariaLabel="Lọc nhanh theo ngày"/);
    expect(source).toMatch(/<DateRangePresetSelect[\s\S]*ariaLabel="Lọc nhanh theo ngày"/);
    expect(css).not.toMatch(/\.shipments-detail-presets/);
    expect(source).not.toContain('shipments-detail-filters__meta');
    expect(source).not.toContain('Đang lọc');
    expect(source).not.toContain('shipments-detail-filters__footer');
    expect(css).not.toContain('.shipments-detail-filters__date-actions');
    expect(css).not.toContain('.shipments-detail-filters__meta');
    expect(ledgerSource).toMatch(/<SummaryRail\s/);
    expect(ledgerSource).not.toContain('shipment-container-summary');
    expect(railCss).toMatch(/\.summary-rail dd\s*\{[^}]*font-size:\s*var\(--text-section-size\);/);
    expect(railCss).toMatch(/\.summary-rail__item--warning dd\s*\{\s*color:\s*var\(--warning-text\);/);
    expect(css).toMatch(/\.shipment-container-ledger thead th\s*\{[^}]*font-size:\s*var\(--ops-table-header-size\);/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > td\s*\{[^}]*font-size:\s*var\(--ops-table-supporting-size\);/);
  });

  it('keeps filter controls in a flat responsive toolbar inside the workboard', () => {
    // Card 20260922_42 then 20260927_152: the shared bar hosts the controls and
    // owns their layout, widths AND height token; the page keeps only the flat
    // treatment of the from/to fields' own input. The self-made disclosure
    // family is deleted, and no page rule declares a control dimension.
    expect(source).toContain('<FilterBar');
    expect(css).not.toMatch(/\.shipments-detail-filters \[data-uui-control\]\s*\{[^}]*--uui-control-h/);
    expect(css).not.toMatch(/\.shipments-detail-filters\s*\{[^}]*--uui-control-h/);
    const filterToolbar = css.match(/\.shipments-detail-filters\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(filterToolbar).not.toMatch(/(?:padding|border|border-radius|background|box-shadow)\s*:/);
    expect(css).toMatch(/\.shipments-detail-filter input\s*\{[^}]*box-shadow:\s*none;/);
    expect(css).toMatch(/\.shipments-detail-filter input\s*\{[^}]*background:\s*transparent;/);
    expect(css).not.toContain('.shipments-detail-filter select');
    expect(css).not.toMatch(/cus-advanced-toggle|filters__advanced|filters__group/);
    expect(source).not.toContain('aria-controls="cus-detail-advanced-filters"');
    expect(source).not.toContain('data-open={advancedOpen');
  });

  it('uses a borderless workband rather than an outer card or ruled lines around the filters and ledger', () => {
    const workspace = css.match(/\.shipments-detail-workspace\s*\{([^}]*)\}/)?.[1] ?? '';
    const header = css.match(/\.shipments-detail-workspace__header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(workspace).toMatch(/background:\s*transparent;/);
    expect(workspace).not.toMatch(/(?:border|border-radius|box-shadow)\s*:/);
    expect(header).toMatch(/border-block:\s*0;/);
    expect(header).toMatch(/padding:\s*8px 0 0;/);
    expect(header).toMatch(/background:\s*transparent;/);
    expect(css).not.toMatch(/\.shipments-detail-workspace\s*\{[^}]*box-shadow:/);
  });

  it('fits desktop columns to the workspace and lets headings wrap instead of forcing horizontal scroll', () => {
    // SIL-824 + SIL-863 → SIL-877 (CR-009.1 EPIC 4.1): the table fills the
    // uncapped canvas at width 100% and pins its floor at the TSX-fed
    // --led-min (default --led-fixed-sum, the chốt ten columns = 1084px) so
    // table-layout: fixed is never over-constrained and narrow containers
    // horizontal-scroll instead of shattering. The 1344px max-width cap is
    // retired — wider canvases stretch the %-share columns proportionally.
    expect(css).toMatch(/\.shipment-container-ledger table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*var\(--led-min, var\(--led-fixed-sum\)\);[^}]*table-layout:\s*fixed;/);
    expect(css).not.toMatch(/\.shipment-container-ledger table\s*\{[^}]*max-width/);
    expect(css).toMatch(/\.shipment-container-ledger thead th\s*\{[^}]*white-space:\s*normal;/);
    // 20260922_37 no-truncation doctrine: data cells wrap, never clip — the
    // old `overflow: hidden` cut trailing characters of long place names.
    expect(css).not.toMatch(/\.shipment-container-ledger tbody > tr > td\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > td\s*\{[^}]*overflow-wrap:\s*anywhere;/);
    // The shared Table.css base sets an unscoped `tbody td { white-space: nowrap }`
    // that beats inheritance from wrappers — stacked body cells must re-declare
    // wrapping on themselves or long text ("· Hãng tàu …") spills past fixed columns.
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > td\s*\{[^}]*white-space:\s*normal;/);
    expect(css).toMatch(/\.shipment-container-ledger__route\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.shipment-container-ledger__multiline > small\s*\{[^}]*word-break:\s*break-word;/);
    expect(css).toMatch(/tbody > tr > td::before\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*tbody > tr > td\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  });

  it('uses one compact, wrapping type scale for every dispatch status and keeps the status column narrow', () => {
    expect(ledgerSource).toContain('shipment-container-ledger__dispatch-badge--${row.dispatchStatus.toLowerCase()}');
    // SIL-872 (CR-009.1 4.1): the narrow columns own the ticket's chốt px
    // floors, not shares — notes 120px (a Cột-picker opt-in), status 115px
    // (cột 10: fully on-screen at 1440px). The FB-086 actions column is
    // retired; FB-113 v2 (2026-10-18) keeps the documents group as four
    // headed columns.
    expect(css).toMatch(/--led-w-notes:\s*120px;/);
    expect(css).toMatch(/--led-w-status:\s*115px;/);
    expect(css).not.toMatch(/--led-w-actions:/);
    expect(css).toMatch(/\.shipment-container-ledger__dispatch-badge\s*\{[^}]*max-width:\s*100%;[^}]*font-size:\s*var\(--text-caption-size\);[^}]*line-height:\s*1\.4;[^}]*white-space:\s*normal;/);
  });

  it('SCHEDULE-LAYOUT-07 gives both mobile ports equal width without an obsolete arrow track', () => {
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shipment-container-ledger__route\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*align-items:\s*start;/);
    expect(css).not.toMatch(/\.shipment-container-ledger__route\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
    // SIL-819 (QA 1440px): the route place name wraps at WORD boundaries —
    // multi-word names never break mid-word while a word boundary offers a
    // break point. SIL-824 (QA FAIL 16/11, builds 1a0ea1c5 + 4db1a331): the
    // span's own `break-word` override silently disabled the td's working
    // `anywhere` law in this grid-in-fixed-table context (Chrome never fires
    // break-word there), so over-line tokens clipped invisibly at the cell
    // edge; the span reads `anywhere` again — with the 96px floor + the route
    // trigger's 6px inline lever now holding the widest real port token
    // ('VipGreenPort' 79.3-80.1px measured) whole in an 83px box, the
    // emergency break only ever fires for a token wider than the whole line,
    // and it fires VISIBLY. The span's grid keeps the explicit minmax(0, 1fr)
    // track — an implicit auto track floors at min-content, which anywhere
    // must be able to shrink below.
    expect(css).toMatch(/\.shipment-container-ledger__route > span\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*normal;/);
  });

  it('SIL-872: KHÁCH HÀNG & LỘ TRÌNH rides its ticket share with the 150px floor and the SIL-822 wrap levers', () => {
    // SIL-872 (hotfix CR-009.1 4.1): the col reads the ticket's 14% share
    // with the 150px floor as min-width. The spec's 200px cap
    // (--led-w-customer-max) stays retired — the share only ever grows with
    // the canvas. SIL-822's levers stay: the 6px inline padding floor on the
    // row-header cell and word-boundary wrap on the NameCell runs.
    expect(css).toMatch(/\.shipment-container-ledger__col--customer\s*\{[^}]*width:\s*calc\(14%\s*\*\s*var\(--led-share-scale, 1\)\);\s*min-width:\s*var\(--led-w-customer\);/);
    expect(css).toMatch(/--led-w-customer:\s*150px;/);
    expect(css).not.toMatch(/--led-w-customer-max/);
    expect(css).not.toMatch(/\.shipment-container-ledger__col--\w+\s*\{[^}]*max-width/);
    expect(css).toMatch(/\.shipment-container-ledger th\[data-label='Khách hàng & lộ trình'\]\s*\{[^}]*padding-inline:\s*6px;/);
    expect(css).toMatch(/\.shipment-container-ledger th\[data-label='Khách hàng & lộ trình'\] \.name-cell\s*\{[^}]*overflow-wrap:\s*break-word;[^}]*word-break:\s*normal;/);
  });

  it('places pagination in the container ledger scroll region', () => {
    expect(source).toMatch(/<ShipmentContainerLedger[\s\S]*?footer=\{<Pagination page=\{page\}/);
    expect(ledgerSource).toMatch(/<div className="shipment-container-ledger"[\s\S]*?\{footer\}[\s\S]*?<\/div>/);
  });

  it('keeps pagination in flow at the table end on every viewport (card 20260922_20)', () => {
    // Static base is the only pagination positioning: the desktop sticky
    // (b6eda31c) pinned to a scrollport that is not main.app-body and floated
    // the bar mid-table over rows; its -32px margin hack is banned.
    expect(css).toMatch(/\.shipment-container-ledger > \.ds-pagination\s*\{[^}]*position:\s*static;/);
    expect(css).not.toMatch(/:has\(tbody > tr:nth-child\(2\)\) > \.ds-pagination[^}]*sticky/);
    expect(css).not.toMatch(/\.ds-pagination[^}]*margin-bottom:\s*-/);
  });

  it('keeps an opened cell editor above the sticky pagination layer', () => {
    expect(tokens).toMatch(/--z-sticky:\s*100;/);
    expect(tokens).toMatch(/--z-overlay:\s*200;/);
    expect(css).toMatch(/\.shipment-container-ledger > \.ds-pagination\s*\{[^}]*z-index:\s*var\(--z-sticky, 100\);/);
    expect(css).toMatch(/\.shipment-container-ledger__editing-cell\s*\{[^}]*z-index:\s*var\(--z-overlay, 200\);/);
  });

  it('uses a dense intermediate ledger grid without empty half-width bands', () => {
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*?tbody > tr > td\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*76px;[^}]*padding:\s*8px 10px;/);
    // Card-collapse modes must reset the desktop 72px floor (workboard pattern:
    // auto + 76px floor) — grid-display cells treat a definite height as a cap.
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?tbody > tr > td\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*76px;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*?th\.shipment-container-ledger__editable-cell,\s*\.shipment-container-ledger tbody > tr > td\.shipment-container-ledger__editable-cell\s*\{[^}]*height:\s*auto;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*?th\.shipment-container-ledger__editable-cell::before,\s*\.shipment-container-ledger tbody > tr > td\.shipment-container-ledger__editable-cell::before\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*?\.shipment-container-ledger__cell-trigger > :not\(\.shipment-container-ledger__edit-purpose\)\s*\{[^}]*grid-column:\s*2;/);
    // FB-113 v2: documents cells pass a per-column label override; the
    // shared mode label stays the fallback, so every trigger keeps a
    // data-cell-label for the card-mode label rail.
    expect(ledgerSource).toContain('data-cell-label={cellLabel ?? modeLabelForTrigger(mode)}');
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*?tbody > tr > td\.shipment-container-ledger__cell--status\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).not.toContain('tbody > tr > :nth-child(4),');
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*780px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*780px\)[\s\S]*?tbody > tr > :nth-child\(even\)\s*\{[^}]*border-right:\s*0;/);
    // FB-113 v2: the "CHỨNG TỪ" shortening override is retired — each
    // documents trigger carries its own short data-cell-label, so the
    // card-mode rail reads the column the user tapped.
    expect(css).not.toMatch(/\[data-mode="documents"\][^}]*::before\s*\{[^}]*content:/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?tbody > tr > td\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger__route\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    const phone = css.slice(css.indexOf('@media (max-width: 520px)'));
    expect(phone).toMatch(/\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(phone).toMatch(/tbody > tr > td\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*min-height:\s*44px;/);
    // FB-113 v2: the phone-tier full-width cells are pinned by identity
    // (row header th) and class/label — not child indexes, which the
    // documents split (and any hidden column) shifts.
    expect(phone).toMatch(/tbody > tr > th,\s*\n\s*\.shipment-container-ledger tbody > tr > td\[data-label='Nâng \/ hạ'\],\s*\n\s*\.shipment-container-ledger tbody > tr > td\[data-label='Ghi chú'\],\s*\n\s*\.shipment-container-ledger tbody > tr > td\.shipment-container-ledger__cell--status\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(phone).toMatch(/\.shipment-container-ledger__cell-trigger::before\s*\{[^}]*position:\s*static;[^}]*grid-column:\s*1;[^}]*width:\s*auto;/);
    expect(phone).toMatch(/\.shipment-container-ledger__cell-trigger > :not\(\.shipment-container-ledger__edit-purpose\)\s*\{[^}]*grid-column:\s*1;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger__editing-cell\s*\{[^}]*grid-column:\s*1 \/ -1 !important;/);
    expect(phone).toMatch(/\.shipment-container-ledger__editing-cell\s*\{[^}]*display:\s*block;[^}]*grid-column:\s*1 \/ -1 !important;[^}]*padding:\s*0 0 8px !important;/);
    expect(phone).toMatch(/\.shipment-container-ledger__editing-cell::before\s*\{[^}]*display:\s*none;/);
    // SIL-149 phase 2 (tie-breaker 24/10): the four secondary cells collapse
    // behind the th expander; an editor opened while collapsed keeps
    // rendering, and the expander itself is a phone-only 44px control.
    expect(phone).toMatch(/\.shipment-container-ledger__row-toggle\s*\{[^}]*position:\s*absolute;[^}]*width:\s*44px;[^}]*height:\s*44px;/);
    expect(phone).toMatch(/tr\[data-expanded="false"\] > td\[data-label='Hãng tàu'\][^}]*display:\s*none\s*!important/);
    expect(phone).toMatch(/tr\[data-expanded="false"\] > td\.shipment-container-ledger__editing-cell\s*\{[^}]*display:\s*block\s*!important/);
    expect(css).toMatch(/\.shipment-container-ledger__row-toggle\s*\{\s*display:\s*none;\s*\}/);
    // SIL-150 (C-chrome): packed filter bar above the first record; the
    // quick-range strip drops because the 'Bộ lọc' dialog carries the same
    // ranges. SIL-1214 round 2 (QA failed the 40px strip twice on 2d15ef50):
    // the page-local rail override is RETIRED — the shared design-system band
    // (≤640px SummaryRail 2-col grid) owns the phone rail, so this file pins
    // its ABSENCE instead of the strip.
    expect(phone).not.toMatch(/\.shipments-detail-workspace \.summary-rail dl\s*\{/);
    expect(phone).toMatch(/\.shipments-detail-workspace \.summary-rail\s*\{[^}]*margin:\s*8px 10px 0;/);
    expect(phone).toMatch(/\.shipments-detail-filters \.filter-bar\s*\{[^}]*padding:\s*8px;/);
    expect(phone).toMatch(/\.shipments-detail-filters \.filter-bar__presets\s*\{\s*display:\s*none;/);
    const tablet = css.slice(css.indexOf('@container shipments-detail (min-width: 641px)'));
    expect(tablet).toMatch(/\.shipment-container-ledger__cell-trigger\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(tablet).toMatch(/\.shipment-container-ledger__cell-trigger::before\s*\{[^}]*position:\s*static;/);
  });

  it('makes editable values the cell trigger without pencil controls and keeps bounded stacked editor trays', () => {
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger\s*\{[^}]*display:\s*block;[^}]*background:\s*transparent;[^}]*cursor:\s*text;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger\s*\{[^}]*touch-action:\s*manipulation;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger\s*\{[^}]*scroll-margin-top:\s*96px;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger:not\(\.shipment-container-ledger__cell-trigger--read-only\):not\(\[disabled\]\):hover/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\);/);
    expect(css).not.toContain('.shipment-container-ledger__edit-button');
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*\.shipment-container-ledger__editing-cell\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).not.toContain('.shipment-container-ledger__editor-row');
    expect(css).toMatch(/\.shipment-container-ledger__editing-cell\s*\{[^}]*overflow:\s*visible !important;/);
    expect(css).toMatch(/\.shipment-container-ledger__editable-cell\s*\{[^}]*height:\s*1px;[^}]*padding:\s*0 !important;/);
    expect(css).toMatch(/\.shipment-container-ledger__editable-cell > \.shipment-container-ledger__cell-editor\s*\{[^}]*position:\s*relative;[^}]*height:\s*100%;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-editor\s*\{[^}]*position:\s*relative;/);
    /* Card 20261009_3: the card chrome (display/padding/border/radius/fill)
       lives on the editor's own class so the portaled phone sheet reuses the
       exact same surface — one shared implementation. The descendant rule owns
       only the desktop/tablet cell anchoring. */
    expect(css).toMatch(/\.shipment-container-ledger__inline-editor\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*padding:\s*12px;[^}]*border-radius:\s*8px;[^}]*background:\s*var\(--surface\);[^}]*box-shadow:\s*none;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-editor > \.shipment-container-ledger__inline-editor\s*\{[^}]*position:\s*absolute;[^}]*top:\s*calc\(100% \+ 6px\);[^}]*width:\s*min\(420px, calc\(100vw - 28px\)\);/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-editor\[data-mode="notes"\] > \.shipment-container-ledger__inline-editor\s*\{[^}]*right:\s*-4px;[^}]*left:\s*auto;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-editor\[data-mode="schedule"\] > \.shipment-container-ledger__inline-editor\s*\{[^}]*right:\s*-4px;[^}]*left:\s*auto;/);
    expect(css).not.toContain('data-mode="appointment"');
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*\.shipment-container-ledger__cell-editor > \.shipment-container-ledger__inline-editor\s*\{[^}]*position:\s*static;[^}]*width:\s*100%;/);
    expect(css).toMatch(/@media \(pointer:\s*coarse\)[\s\S]*?\.shipment-container-ledger__editor-grid input:not\(\[data-uui-control\] input\),[\s\S]*?\.searchable-select__trigger\s*\{[^}]*height:\s*var\(--control-touch-h\);[^}]*min-height:\s*var\(--control-touch-h\);/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    // The appointment-popover redesign (7ad16f89) pairs the ngày/giờ fields
    // side by side inside the schedule tray — SIL-608 (owner 30/10) put the
    // NGÀY half first app-wide (VN order DD/MM/YYYY before HH:mm, superseding
    // the f495a3c4 giờ-first order), so the wide date track comes first and
    // giờ keeps the narrow one.
    expect(css).toMatch(/\.shipment-container-ledger__editor-grid--schedule\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.2fr\)\s*minmax\(0, 0\.8fr\);/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-grid input:not\(\[data-uui-control\] input\),[\s\S]*?\.searchable-select__trigger\s*\{[^}]*height:\s*var\(--control-default-h\);[^}]*min-height:\s*var\(--control-default-h\);[^}]*font-size:\s*var\(--control-field-font-size\);/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-footer\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;[^}]*border-top:\s*1px solid var\(--line-2\);/);
    expect(css).toMatch(/\.shipment-container-ledger__edit-action\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*36px;[^}]*height:\s*36px;[^}]*min-height:\s*36px;[^}]*padding-inline:\s*12px;/);
    expect(css).toMatch(/\.shipment-container-ledger__keyboard-hint\s*\{[^}]*font-size:\s*var\(--text-caption-size\);/);
    expect(css).toMatch(/\.shipment-container-ledger__edit-error\s*\{[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.shipment-container-ledger__recovery\s*\{[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.shipment-container-ledger__edit-action\s*\{[^}]*min-width:\s*var\(--control-max-h\);[^}]*height:\s*var\(--control-max-h\);[^}]*min-height:\s*var\(--control-max-h\);/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger__keyboard-hint\s*\{[^}]*display:\s*none;/);
    // Labels stay visible at every width — the icon-only skin (hidden
    // [data-text]) is gone, so no rule may target the text span again.
    expect(css).not.toMatch(/\.shipment-container-ledger__edit-action \[data-text\]/);
    expect(css).toContain('.shipment-container-ledger__edit-action:disabled [data-icon] { color: inherit; }');
    // Disabled Save keeps legible muted text and an icon with the same color.
    expect(css).toMatch(/\.shipment-container-ledger__edit-action:disabled\s*\{[^}]*background:\s*var\(--surface-2\);[^}]*color:\s*var\(--ink-3\);[^}]*opacity:\s*1;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*\.shipment-container-ledger__cell-trigger,[\s\S]*?\.shipment-container-ledger__edit-action\s*\{[^}]*min-height:\s*40px;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*\.shipment-container-ledger__edit-action\s*\{[^}]*min-width:\s*40px;[^}]*height:\s*40px;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*tbody > tr > td\.shipment-container-ledger__editable-cell\s*\{[^}]*height:\s*auto;/);
  });

  it('uses a distinct, non-destructive pending state when today still needs vehicle allocation', () => {
    expect(css).toMatch(/shipment-container-ledger__row--missing-date/);
    // Amber is an attention signal scoped to the schedule cell, never a full-row fill.
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr\.shipment-container-ledger__row--missing-date > td\[data-label='Lịch trình'\]\s*\{[^}]*background:/);
    expect(css).not.toMatch(/__row--missing-date > th,/);
    expect(css).not.toMatch(/__row--missing-date > td\s*\{/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-pending/);
    // Card 20260922_24: the duplicate dispatch-state badge is gone — the amber
    // cell tint is the only vehicle-attention cue in the Phân xe cell, because
    // the state itself is printed once, in the Trạng thái cell.
    expect(css).not.toMatch(/shipment-container-ledger__vehicle-state/);
    expect(ledgerSource).not.toMatch(/__vehicle-state">/);
    expect(css).toMatch(/shipment-container-ledger__plate--missing/);
    expect(ledgerSource).not.toContain('shipment-container-ledger__vehicle-guidance');
    expect(css).toContain(':not(.shipment-container-ledger__row-warning)');
    // SIL-756 r3 (2d502f32) added the __code exclusion to the muted-span
    // selector; pin the exact exclusion set so a new child class must be
    // added here deliberately, never silently.
    expect(css).toMatch(/shipment-container-ledger__multiline:not\(\.shipment-container-ledger__notes\) > span(?::not\(\.shipment-container-ledger__(?:code|combined|plate|dispatch-badge|plate--missing|schedule-gap|row-warning)\))+/);
    // Status chips are UUI badges: the component owns fill, ring, and geometry;
    // page CSS only tunes type so a chip can never read as a button.
    expect(css).toMatch(/\.shipment-container-ledger__plate--missing\s*\{[^}]*color:\s*var\(--warning-text\);[^}]*font-size:\s*var\(--text-caption-size\);/);
    expect(css).not.toMatch(/__plate--missing\s*\{[^}]*border/);
    expect(css).toMatch(/\.shipment-container-ledger__schedule-gap\s*\{[^}]*color:\s*var\(--warning-text\);/);
    expect(ledgerSource).toMatch(/<BadgeWithDot size="sm" color="warning" className="shipment-container-ledger__plate--missing">/);
    expect(ledgerSource).toMatch(/<Badge size="sm" color="warning" className="shipment-container-ledger__schedule-gap">/);
    // The missing-fields toggle names the field (single) or the count — never a
    // bare "Thiếu dữ liệu" that contradicts the row's own status.
    expect(missingSource).toMatch(/missingFields\.length === 1/);
    expect(missingSource).toMatch(/Thiếu \$\{missingFields\[0\]\.label\}/);
    expect(missingSource).not.toMatch(/Thiếu dữ liệu\{open/);
    expect(ledgerSource).toMatch(/<Badge size="sm" color="warning" className="shipment-container-ledger__schedule-gap">/);
    expect(css).toMatch(/\.shipment-container-ledger__schedule-gap\s*\{[^}]*width:\s*fit-content;[^}]*font-size:\s*var\(--text-caption-size\);/);
    // The triage summary is one compact amber chip — a count disclosure that
    // expands to jump-to-editor buttons. The list wraps at the chip's own
    // 10px size (no shrinking for density) and the DOM text stays comma-free.
    expect(css).toMatch(/\.shipment-container-ledger__multiline > \.shipment-container-ledger__row-warning\s*\{[^}]*display:\s*inline-flex;[^}]*background:\s*var\(--warning-soft\);/);
    expect(css).toMatch(/\.shipment-container-ledger__multiline > \.shipment-container-ledger__row-warning\.shipment-container-ledger__missing-fields\s*\{[^}]*flex-wrap:\s*wrap;/);
    expect(css).toMatch(/\.shipment-container-ledger__missing-fields-toggle\s*\{[^}]*background:\s*none;[^}]*cursor:\s*pointer;/);
    expect(css).toMatch(/\.shipment-container-ledger__missing-fields-list\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
    expect(css).toMatch(/\.shipment-container-ledger__missing-fields-item\s*\{[^}]*font-size:\s*var\(--text-caption-size\);/);
    expect(css).toMatch(/\.shipment-container-ledger__row-warning svg\s*\{[^}]*flex:\s*0 0 12px;/);
    // Structural classification chips stay neutral — accent fills are state-only.
    expect(css).toMatch(/\.shipment-container-ledger__direction\s*\{[^}]*background:\s*var\(--surface-3\);[^}]*color:\s*var\(--ink-2\);/);
    // SIL-484 (owner 25/10): the chip reads the table's DATA scale (12px,
    // same as the neighboring cells) — not the 11px caption scale — and the
    // line-height keeps the pill inside the owner's 20-22px band
    // (12px × 1.5 + 2px × 2 padding = 22px).
    expect(css).toMatch(/\.shipment-container-ledger__direction\s*\{[^}]*font-size:\s*var\(--text-data-size\);[^}]*line-height:\s*1\.5;/);
    expect(css).not.toMatch(/\.shipment-container-ledger__direction\s*\{[^}]*font-size:\s*var\(--text-caption-size\)/);
    expect(css).not.toMatch(/__direction--import\s*\{[^}]*var\(--info/);
    expect(css).not.toMatch(/__direction--export\s*\{[^}]*var\(--brand/);
    expect(css).not.toMatch(/shipment-container-ledger__vehicle-alert/);
    expect(css).not.toMatch(/shipment-container-ledger__vehicle-pending\s*\{[^}]*var\(--danger\)/);
  });

  it('SIL-872: the chốt ladder pins its px floors and ticket % shares, and the sums close exactly', () => {
    // SIL-872 (hotfix CR-009.1 4.1) — the customer's chốt ladder REPLACES the
    // SIL-863 Bảng 2 / SIL-824 floors ("thắng mọi quyết định cũ"): every
    // column reads its floor from a --led-w-* var AND its EXACT ticket %
    // share from a calc() col width, --led-fixed-sum is the share base
    // (1084px — the ten floors sum, ≤ the ~1150px canvas at 1440×900 so
    // TRẠNG THÁI never spills), CHỌN/GHI CHÚ ride the TSX --led-min +
    // --led-share-scale only while rendered, and the retired FB-086 actions
    // column leaves no floor.
    const floor = (name: string) => {
      const m = css.match(new RegExp(`--led-w-${name}:\\s*(\\d+)px;`));
      expect(m, `missing --led-w-${name}`).toBeTruthy();
      return Number(m![1]);
    };
    const names = ['select', 'customer', 'billbook', 'declaration', 'direction', 'shippingline', 'container', 'route', 'schedule', 'vehicle', 'notes', 'status'];
    const sum = names.reduce((acc, name) => acc + floor(name), 0);
    const declared = Number(css.match(/--led-fixed-sum:\s*(\d+)px;/)?.[1] ?? NaN);
    // --led-fixed-sum counts the SPEC TEN (CHỌN/GHI CHÚ excluded — they ride
    // the TSX --led-min while rendered).
    expect(declared).toBe(1145);
    expect(sum - floor('select') - floor('notes')).toBe(declared);
    expect(floor('customer')).toBe(150); // ticket cột 1 (share 14%)
    expect(floor('billbook')).toBe(128); // P2 QA +23 — 'BILL/BOOKIN' no longer clips
    expect(floor('declaration')).toBe(128); // P2 QA +23 — 'Chưa có tờ khai' no longer clips
    expect(floor('direction')).toBe(64); // ticket cột 4 (share 5.5%)
    expect(floor('shippingline')).toBe(80); // ticket cột 5 (share 7%)
    expect(floor('container')).toBe(115); // ticket cột 6 (share 11%)
    expect(floor('route')).toBe(120); // ticket cột 7 (share 11.5%)
    expect(floor('schedule')).toBe(125); // ticket cột 8 (share 12%)
    expect(floor('vehicle')).toBe(120); // P2 QA +15 — the Phân xe plate pill fits its track
    expect(floor('status')).toBe(115); // ticket cột 10 (share 10%)
    expect(floor('notes')).toBe(120);
    expect(css).not.toMatch(/--led-w-actions:/);
    expect(css).toMatch(/\.shipment-container-ledger td\[data-label='Nâng \/ hạ'\] \.shipment-container-ledger__cell-trigger\s*\{[^}]*padding-left:\s*6px;[^}]*padding-right:\s*6px;/);
    // SIL-872: every col declares its EXACT ticket % share scaled by the
    // TSX-fed --led-share-scale, and keeps its px floor as min-width. The
    // ticket shares are the customer's chốt numbers — deliberately NOT
    // floor-derived (customer 14% over a 13.8% floor proportion etc.) — and
    // the ten of them sum to exactly 100% (no dead margin, no overflow; the
    // share-scale re-base keeps every hide/merge combination ≤ 100%).
    const shares: Record<string, number> = {
      select: 4.06,
      customer: 14,
      billbook: 9.5,
      declaration: 9.5,
      direction: 5.5,
      shippingline: 7,
      container: 11,
      route: 11.5,
      schedule: 12,
      vehicle: 10,
      notes: 10.48,
      status: 10,
    };
    for (const name of names) {
      if (name === 'select') {
        // CHỌN carries the REAL px width — under table-layout: fixed a px
        // width wins verbatim, so no share can squeeze the checkbox into a
        // half-clipped sliver (the P2 QA defect).
        expect(css).toMatch(/\.shipment-container-ledger__col--select\s*\{[^}]*width:\s*var\(--led-w-select\);/);
        continue;
      }
      expect(css).toMatch(new RegExp(`\\.shipment-container-ledger__col--${name}\\s*\\{[^}]*width:\\s*calc\\(${shares[name]}%\\s*\\*\\s*var\\(--led-share-scale, 1\\)\\);\\s*min-width:\\s*var\\(--led-w-${name}\\);`));
    }
    const tenShareSum = names.filter((name) => name !== 'select' && name !== 'notes').reduce((acc, name) => acc + shares[name], 0);
    expect(tenShareSum).toBe(100); // the ticket's ten shares close exactly
    // CHỌN/GHI CHÚ ratios: GHI CHÚ keeps the floor-derived share (120 ÷
    // 1145); CHỌN no longer rides a share at all — its track is the real px
    // width, so only GHI CHÚ is ratio-checked here.
    expect(Math.abs(shares.notes - (100 * floor('notes')) / declared)).toBeLessThan(0.05);
    // The TSX feeds both vars from the RENDERED colgroup.
    expect(ledgerSource).toMatch(/'--led-min':\s*`\$\{tableMinWidth\}px`,\s*'--led-share-scale':\s*ledShareScale/);
    expect(ledgerSource).toMatch(/const LEDGER_SPEC_TEN_SUM/);
    // The band ladders stay gone — one share ladder, no @media restatements.
    expect(css).not.toMatch(/@media \(min-width: 1101px\)[\s\S]*?col--/);
    expect(css).not.toMatch(/@media \(min-width: 761px\)[\s\S]*?col--/);
    // The card collapse owns ≤1118px (with the min-width reset); 1119px+
    // renders the share table with the in-container scroll whenever the
    // container runs under the rendered min-width sum (1440px sidebar-open
    // canvas ≈1129px ≥ 1084px → NO scroll, the ticket's AC); the band ends
    // at 1560px (audit 2026-11-27 P2-18: the collapsed-sidebar .app-body is
    // overflow-x: hidden, so 1301–1560px canvases clipped instead of
    // scrolling); ≥1561px fits without the lane.
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)\s*\{[\s\S]*?\.shipment-container-ledger table\s*\{\s*min-width:\s*0;/);
    expect(css).toMatch(/@container shipments-detail \(min-width:\s*1119px\) and \(max-width:\s*1560px\)\s*\{[^}]*\.shipment-container-ledger\s*\{[^}]*overflow-x:\s*auto;/);
    // BILL/BOOKING header never drops a lone second line (nowrap law kept).
    expect(css).toMatch(/\.shipment-container-ledger__col--billbook \.table-sort-button\s*\{[^}]*white-space:\s*nowrap;/);
    // P2 QA: identifier cells lost the cell-level overflow-x scrollbar —
    // the value wraps inside its widened floor instead.
    expect(css).not.toMatch(/\.shipment-container-ledger__code[^{]*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/td\[data-label="Số tờ khai"\] \.shipment-container-ledger__code[\s\S]*?overflow-wrap:\s*anywhere/);
  });

  it('SIL-1211: the freight board scrolls in a seamed pane — flush sticky header and per-cell floors', () => {
    // The scroll lane (1119–1560 container canvases — the 1440px workboard
    // included) carries the scroll-on-purpose law's --border-1 hairline seam:
    // the board reads as one framed scroll box, never content leaking past
    // the viewport edge. The seam rides the same rule the ladder test's band
    // pin already matches (overflow-x stays its first declaration).
    expect(css).toMatch(/@container shipments-detail \(min-width:\s*1119px\) and \(max-width:\s*1560px\)\s*\{\s*\.shipment-container-ledger\s*\{[^}]*overflow-x:\s*auto;[^}]*border-block:\s*1px solid var\(--border-1\);/);
    // P2-21 (styles/record-table.css law): inside the pane the WRAP resolves
    // the sticky offset — the header pins flush at the pane's top, never 24px
    // above the clipped edge the -24px token would produce.
    expect(css).toMatch(/@container shipments-detail \(min-width:\s*1119px\) and \(max-width:\s*1560px\)\s*\{[\s\S]*?\.shipment-container-ledger thead th\s*\{\s*top:\s*0;\s*\}/);
    // Per-column floors are restated on the CELL layer keyed by data-label
    // (the DebtListPage AUI-01 shape) — VẬN CHUYỂN included — so no column
    // can drop below its floor even if the layout ever leaves fixed. The
    // floors read the ladder's own --led-w-* vars; the row header rides the
    // customer floor.
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > th\[data-label='Khách hàng & lộ trình'\]\s*\{\s*min-width:\s*var\(--led-w-customer\);/);
    const cellFloors: Array<[string, string]> = [
      ['Chọn', 'select'],
      ['Bill/Booking', 'billbook'],
      ['Số tờ khai', 'declaration'],
      ['Nhập/Xuất', 'direction'],
      ['Hãng tàu', 'shippingline'],
      ['Thông số container', 'container'],
      ['Nâng / hạ', 'route'],
      ['Lịch trình', 'schedule'],
      ['Phân xe', 'vehicle'],
      ['Cước đầu ra · Vận chuyển', 'out-transport'],
      ['Cước đầu ra · Làm hàng', 'out-handling'],
      ['Cước đầu ra · Phát sinh', 'out-incidental'],
      ['Cước đầu ra · Tổng cước', 'out-total'],
      ['Cước đầu vào · Vận chuyển', 'in-transport'],
      ['Cước đầu vào · Làm hàng', 'in-handling'],
      ['Cước đầu vào · Phát sinh', 'in-incidental'],
      ['Cước đầu vào · Tổng cước', 'in-total'],
      ['Phí chi hộ · CSHT', 'chiho-csht'],
      ['Phí chi hộ · Nâng', 'chiho-lift'],
      ['Phí chi hộ · Hạ', 'chiho-drop'],
      ['Phí chi hộ · Khác', 'chiho-other'],
      ['Ghi chú', 'notes'],
      ['Trạng thái', 'status'],
    ];
    for (const [label, floor] of cellFloors) {
      expect(css).toMatch(new RegExp(`\\.shipment-container-ledger tbody > tr > td\\[data-label='${label.replace(/[/\\]/g, '\\$&')}'\\]\\s*\\{\\s*min-width:\\s*var\\(--led-w-${floor}\\);`));
    }
    // The floors live inside the scroll band only — the card grid's td rule
    // keeps winning at ≤1118px.
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1118px\)[\s\S]*?tbody > tr > td\s*\{[^}]*min-width:\s*0;/);
  });

  it('SIL-1211 (R5): the overflow pane carries explicit scroll affordances — visible rail, fold gradient, head hint', () => {
    // The owner re-measured the 2265px board in a 1129px frame with
    // scrollLeftMax=1136 and no visible scrollbar (macOS overlay) — the seam
    // alone was judged not an affordance. The band law now: (1) a custom,
    // always-visible scrollbar (styling it disables Chromium overlay mode),
    // (2) the local/scroll right-edge fold gradient, (3) the board-head
    // hint, display-flipped inside the band only.
    expect(css).toMatch(/\.shipment-container-ledger\s*\{[^}]*overflow-x:\s*auto;[^}]*scrollbar-width:\s*thin;\s*scrollbar-color:\s*var\(--ink-4, #b6bcc8\) transparent;/);
    expect(css).toMatch(/\.shipment-container-ledger::-webkit-scrollbar\s*\{\s*height:\s*10px;\s*\}/);
    expect(css).toMatch(/\.shipment-container-ledger::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--ink-4, #b6bcc8\);/);
    // Fold gradient (longhand layers — the shorthand form was dropped by one
    // engine): the cover rides the content end (local), the shadow stays at
    // the pane edge (scroll) — the shadow disappears once the board is
    // scrolled flush right.
    expect(css).toMatch(/background-image:\s*\n\s*linear-gradient\(to left, var\(--surface\), transparent 24px\),\s*\n\s*linear-gradient\(to left, rgba\(15, 23, 42, 0\.12\), transparent 24px\);/);
    expect(css).toMatch(/background-attachment:\s*local, scroll;/);
    // The hint renders with the table (exact owner phrasing) and only the
    // scroll band displays it.
    expect(ledgerSource).toMatch(/<p className="shipment-container-ledger__scroll-hint">Cuộn ngang để xem thêm<\/p>/);
    expect(css).toMatch(/\.shipment-container-ledger__scroll-hint\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/@container shipments-detail \(min-width:\s*1119px\) and \(max-width:\s*1560px\)\s*\{[\s\S]*?\.shipment-container-ledger__scroll-hint\s*\{\s*display:\s*block;\s*\}/);
  });

  it('SIL-516: the in-cell plate editor fits its cell and headers never overflow the table', () => {
    // The BKS quick editor renders in-flow inside the cell — it must fill it
    // (fit-content collapsed the combobox to ~37px and shattered the helper
    // one character per line).
    expect(css).toMatch(/\.shipment-container-ledger__multiline > \.shipment-container-ledger__inline-editor\s*\{[^}]*width:\s*100%;/);
    // Helper reads as horizontal word-wrap lines (wrap law parity with
    // __multiline > small), never min-content vertical text.
    expect(css).toMatch(/\.shipment-container-ledger__editor-grid > small\s*\{[^}]*word-break:\s*break-word;[^}]*white-space:\s*normal;/);
    // The action pair stays on the footer's trailing edge inside the cell.
    expect(css).toMatch(/\.shipment-container-ledger__edit-actions\s*\{[^}]*margin-left:\s*auto;/);
    // The shared nowrap sort button overflows its th here (label + icon) —
    // overlapping the neighbouring sticky header and escaping the table's
    // right edge (TRẠNG THÁI cut). The ledger wraps the LABEL at spaces
    // instead: keep-all (never mid-token), balanced 2-line wrap (card
    // 20260925_47).
    // P2-18 (audit 2026-11-27): the wrap law rides the shared __label span —
    // the bare text node let the ⇅ icon orphan onto its own line.
    // SIL-1213 (audit 2026-11-27): the ledger's own `flex-wrap: wrap` on the
    // button is GONE — that wrap is what pushed the ⇅ onto a line of its own
    // and doubled the header's height. The shared control never wraps its own
    // content; the label owns the icon and does the wrapping.
    expect(css).not.toMatch(/\.shipment-container-ledger thead \.table-sort-button\s*\{/);
    expect(css).toMatch(/\.shipment-container-ledger thead \.table-sort-button__label\s*\{[^}]*white-space:\s*normal;[^}]*word-break:\s*keep-all;[^}]*text-wrap:\s*balance;/);
    // Same containment for the editable-cell trigger when it is the row's
    // last rendered column (left hit-area kept, right bleed removed).
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > :last-child \.shipment-container-ledger__cell-trigger\s*\{[^}]*width:\s*calc\(100% \+ 4px\);[^}]*margin-right:\s*0;/);
    // Card-mode row cards must not overflow their tbody (width: 100% + 10px
    // side margins pushed the row 20px past the table's box at 390px).
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr\s*\{\s*width:\s*auto;\s*margin:\s*10px 10px 0;/);
    // An open plate editor claims the full card row on card layouts.
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > \.shipment-container-ledger__cell--plate-open\s*\{\s*grid-column:\s*1 \/ -1;/);
    expect(ledgerSource).toContain("plateEditor?.rowId === row.id ? 'shipment-container-ledger__cell--plate-open' : ''");
  });

  it('card 20260922_54: thead headers wrap at spaces only — never mid-word, never an orphan letter', () => {
    const thead = css.match(/\.shipment-container-ledger thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(thead).toContain('word-break: keep-all');
    expect(thead).toContain('overflow-wrap: normal');
    expect(thead).not.toContain('overflow-wrap: anywhere');
    // Data cells keep the emergency break — long container numbers need it.
    const td = css.match(/\.shipment-container-ledger tbody > tr > td \{([^}]*)\}/)?.[1] ?? '';
    expect(td).toContain('overflow-wrap: anywhere');
  });
});

/* Card 20261009_3 — user iOS capture on /shipments-detail: a dead band ran
 * from the last content to the physical screen bottom, and the "Chỉnh sửa
 * khách hàng và lộ trình" inline editor opened as an undocked card instead of
 * the mobile bottom sheet the workboard dialogs use. The page-fill pins below
 * adopt the exact primitive card 20261004_327 shipped for the sibling
 * `.shipments-page` (one pattern, one shared implementation); the sheet pins
 * mirror the house docked-sheet values (DispatchAllocationPopover ≤680px
 * radius/height budget, SearchableSelect ≤640px backdrop). */
describe('shipment detail mobile viewport fill + bottom sheet (card 20261009_3)', () => {
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

  it('the iOS edge-to-edge meta stays in the document head', () => {
    expect(indexHtml).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"\s*\/?>/);
  });

  it('the page surface fills the shell scrollport and paints the page tone', () => {
    const rule = css.match(/^\.shipments-detail-page\s*\{[^}]*\}/m)?.[0] ?? '';
    expect(rule, '.shipments-detail-page base rule exists').not.toBe('');
    expect(rule).toMatch(/min-height:\s*100%;/);
    expect(rule).toMatch(/align-content:\s*start;/);
    expect(rule).toMatch(/background:\s*var\(--bg\);/);
    // Rework 2026-10-09 (owner ruling): flat rhythm only — the bottom safe
    // area is counted ONCE by the ≤640 shell clearance (class-law pin in
    // mobile-viewport-fill-contract.styles.test.ts). The previous
    // calc(40px + env) here was the second env() term of the ~120px iPhone
    // dead band.
    expect(rule).toMatch(/padding-bottom:\s*40px;/);
    expect(rule).not.toMatch(/env\(safe-area-inset-bottom/);
    // A viewport-locked fill overshoots the scrollport (topbar + shell
    // paddings stack below the page) and IS a scrollable void — the exact
    // mechanism card 20261004_327 removed on the sibling page.
    expect(css).not.toMatch(/\.shipments-detail-page\s*\{[^}]*min-height:\s*100(?:dvh|vh)\s*;/);
  });

  it('the phone tier zeroes the page trailing padding (shell counts once)', () => {
    const rule = css.match(/@media \(max-width:\s*640px\)\s*\{[^}]*\.shipments-detail-page\s*\{[^}]*\}/)?.[0]?.match(/\.shipments-detail-page\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '≤640 .shipments-detail-page override exists').not.toBe('');
    expect(rule).toMatch(/padding-bottom:\s*0;/);
  });

  it('the identity editor docks as a bottom sheet at the ≤640px phone band', () => {
    const sheet = css.match(/@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.shipment-container-ledger__inline-editor--sheet\s*\{[^}]*\}/)?.[0]?.match(/\.shipment-container-ledger__inline-editor--sheet\s*\{[^}]*\}/)?.[0] ?? '';
    expect(sheet, 'phone-band sheet rule exists').not.toBe('');
    expect(sheet).toMatch(/position:\s*fixed;/);
    expect(sheet).toMatch(/bottom:\s*0;/);
    expect(sheet).toMatch(/left:\s*0;\s*right:\s*0;/);
    // Full-bleed dock: no floating side offsets may leak in.
    expect(sheet).not.toMatch(/left:\s*calc|right:\s*-4px/);
    // Rounded TOP corners only; the bottom edge sits flush on the screen.
    expect(sheet).toMatch(/border-radius:\s*16px 16px 0 0;/);
    // Actions clear the Home indicator via the safe-area inset (env()=0 on
    // Android/desktop degrades to the 16px floor — the compat AC).
    expect(sheet).toMatch(/padding-bottom:\s*max\(16px, env\(safe-area-inset-bottom, 0px\)\);/);
    // Tall editors scroll inside the sheet instead of overflowing the dock.
    expect(sheet).toMatch(/max-height:\s*calc\(100dvh - max\(8px, env\(safe-area-inset-top, 0px\)\)\);/);
    expect(sheet).toMatch(/overflow-y:\s*auto;/);
    // The sheet portals out of the app subtree, so the flat-surface reset
    // (#root .app *) must be restated on the sheet itself.
    expect(css).toMatch(/\.shipment-container-ledger__inline-editor--sheet,[^}]*\.shipment-container-ledger__inline-editor--sheet \*[^}]*box-shadow:\s*none;/);
  });

  it('the sheet renders over a dimmed scrim that matches the house mobile sheet', () => {
    const backdrop = css.match(/\.shipment-container-ledger__sheet-backdrop\s*\{[^}]*\}/)?.[0] ?? '';
    expect(backdrop, 'sheet backdrop rule exists').not.toBe('');
    expect(backdrop).toMatch(/position:\s*fixed;/);
    expect(backdrop).toMatch(/inset:\s*0;/);
    expect(backdrop).toMatch(/background:\s*rgba\(12,\s*24,\s*17,\s*0\.46\)/);
    // Stacks under the sheet but above every app surface.
    expect(backdrop).toMatch(/z-index:\s*calc\(var\(--z-popover,\s*400\) - 1\);/);
  });

  it('SIL-578 retires the duplicated card-mode header instead of clipping it', () => {
    // The ≤1330px card band must remove the thead outright — the sr-only
    // clip kept its sort buttons alive as invisible, tabbable, clickable
    // controls stacked at one origin. /shipments' card band already answers
    // this with display:none (.cus-dashboard-table thead). Since SIL-824 the
    // band owns the whole below-floor range, so the header layer stays
    // retired across it.
    const band = css.match(/@container shipments-detail \(max-width: 1118px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(band, 'card band exists').not.toBe('');
    expect(band).toMatch(/\.shipment-container-ledger thead\s*\{\s*display:\s*none;\s*\}/);
    expect(band).not.toMatch(/thead[^{}]*clip:\s*rect\(0/);
    expect(band).not.toMatch(/thead[^{}]*clip-path:\s*inset\(50%\)/);
  });
});
