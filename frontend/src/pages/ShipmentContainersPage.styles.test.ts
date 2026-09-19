import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.tsx'), 'utf8');
const ledgerSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/detail/ShipmentContainerLedger.tsx'), 'utf8');
const railCss = readFileSync(resolve(process.cwd(), 'src/design-system/SummaryRail.css'), 'utf8');

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

  it('keeps an ultrawide operational canvas bounded without a card shell', () => {
    expect(css).toMatch(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-detail-page\s*\{[^}]*width:\s*min\(100%, 1800px\);[^}]*max-width:\s*1800px;[^}]*margin-inline:\s*auto;/);
  });

  it('uses a compact filter-only header and aligns the mixed control families', () => {
    expect(css).not.toContain('.shipments-detail-workspace__intro');
    expect(css).not.toContain('.shipments-detail-eyebrow');
    expect(css).toMatch(/\.shipments-detail-filter \[data-label\]\s*\{[^}]*margin-bottom:\s*0;[^}]*font-weight:\s*var\(--fw-semibold\);/);
    expect(css).toMatch(/\.shipments-detail-filter\s*\{[^}]*gap:\s*4px;/);
    expect(css).toMatch(/\.shipments-detail-filter \[data-input-wrapper\]\s*\{[^}]*gap:\s*4px;/);
    expect(css).toMatch(/\.shipments-detail-filter--search input\s*\{[^}]*padding-left:\s*30px;/);
    expect(css).not.toMatch(/\.shipments-detail-filter input::placeholder\s*\{[^}]*font-size\s*:/);
    expect(css).not.toContain('.shipments-detail-filters__actions');
    expect(source).toMatch(/<div className="shipments-detail-filters">[\s\S]*?<UuiSelectField label="Trạng thái điều xe"[\s\S]*?<div className="shipments-detail-filters__footer">[\s\S]*?shipments-detail-filters__date-actions[\s\S]*?>Xóa bộ lọc<\/UUIButton>/);
    expect(source).not.toContain('shipments-detail-filters__meta');
    expect(source).not.toContain('Đang lọc');
    expect(css).toMatch(/\.shipments-detail-filters__footer\s*\{[^}]*display:\s*flex;[^}]*grid-column:\s*2\s*\/\s*-1;[^}]*align-self:\s*end;/);
    expect(css).toMatch(/\.shipments-detail-filters__date-actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
    expect(css).toMatch(/\.shipments-detail-filters__date-actions button:hover,[\s\S]*?\[data-hovered\]\s*\{[^}]*border-color:\s*var\(--ink-4\);[^}]*background:\s*var\(--surface-2\);/);
    expect(css).not.toContain('.shipments-detail-filters__meta');
    expect(ledgerSource).toMatch(/<SummaryRail\s/);
    expect(ledgerSource).not.toContain('shipment-container-summary');
    expect(railCss).toMatch(/\.summary-rail dd\s*\{[^}]*font-size:\s*var\(--text-section-size\);/);
    expect(railCss).toMatch(/\.summary-rail__item--warning dd\s*\{\s*color:\s*var\(--warning-text\);/);
    expect(css).toMatch(/\.shipment-container-ledger thead th\s*\{[^}]*font-size:\s*var\(--ops-table-header-size\);/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > td\s*\{[^}]*font-size:\s*var\(--ops-table-supporting-size\);/);
  });

  it('keeps filter controls in a flat responsive toolbar inside the workboard', () => {
    expect(css).toMatch(/\.shipments-detail-filters\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/);
    // One self-sizing rail shared with the overview workboard: every filter is a
    // rail item, so adding one never needs a track edit. The old hand-tuned
    // three-track template gave the four selects three columns, wrapping the
    // last one and leaving a hole at the top-left.
    expect(css).toMatch(/\.shipments-detail-filters\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 150px\), 1fr\)\);/);
    expect(css).toMatch(/\.shipments-detail-filters__advanced,\s*\.shipments-detail-filters__group\s*\{\s*display:\s*contents;\s*\}/);
    expect(css).toMatch(/\.shipments-detail-filter--search\s*\{\s*grid-column:\s*span 2;\s*\}/);
    const filterToolbar = css.match(/\.shipments-detail-filters\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(filterToolbar).not.toMatch(/(?:padding|border|border-radius|background|box-shadow)\s*:/);
    expect(css).toMatch(/\.shipments-detail-filter input\s*\{[^}]*box-shadow:\s*none;/);
    expect(css).toMatch(/\.shipments-detail-filter input\s*\{[^}]*background:\s*transparent;/);
    expect(css).not.toContain('.shipments-detail-filter select');
    expect(css).toMatch(/\.shipments-detail-filter > \*,\s*\.shipments-detail-filter input\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
    // Narrow layouts retain search plus an explicit disclosure instead of
    // forcing every filter into tall one-field rows.
    const narrow = css.slice(css.indexOf('@container shipments-detail (max-width: 1000px)'));
    expect(narrow).toMatch(/\.shipments-detail-filters\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
    expect(narrow).toMatch(/\.shipments-detail-filters \.cus-advanced-toggle\s*\{[^}]*display:\s*inline-flex;/);
    // Here the rail is search + disclosure, so the search drops its two-track
    // span; spanning two collapsed the auto track onto a row of its own.
    expect(narrow).toMatch(/\.shipments-detail-filter--search\s*\{\s*grid-column:\s*auto;\s*\}/);
    expect(narrow).toMatch(/\.shipments-detail-filters__advanced\s*\{[^}]*display:\s*none;[^}]*grid-column:\s*1 \/ -1;/);
    expect(narrow).toMatch(/\.shipments-detail-filters__advanced\[data-open\]\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(narrow).toMatch(/\.shipments-detail-filters__group--dates,\s*\.shipments-detail-filters__group--selects\s*\{[^}]*display:\s*contents;/);
    expect(narrow).toMatch(/\.shipments-detail-filters__group--selects > \.shipments-detail-filter:first-child\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(source).toContain('aria-controls="cus-detail-advanced-filters"');
    expect(source).toContain('data-open={advancedOpen ? \'\' : undefined}');
    const tablet = css.slice(css.indexOf('@container shipments-detail (min-width: 700px)'));
    // The tablet disclosure shares the same self-sizing rail; its old five-track
    // template already held six fields and wrapped the last one.
    expect(tablet).toMatch(/\.shipments-detail-filters__advanced\[data-open\]\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 150px\), 1fr\)\);/);
    expect(tablet).toMatch(/\.shipments-detail-filters__group--selects > \.shipments-detail-filter:first-child\s*\{[^}]*grid-column:\s*auto;/);
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
    expect(css).toMatch(/\.shipment-container-ledger table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;/);
    expect(css).toMatch(/\.shipment-container-ledger thead th\s*\{[^}]*white-space:\s*normal;/);
    expect(css).not.toMatch(/\.shipment-container-ledger table\s*\{[^}]*min-width:\s*980px;/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > td\s*\{[^}]*overflow:\s*hidden;/);
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
    // The multiline status cell (badge + missing-fields warning) needs a wider
    // column than the old single-badge 7%; notes gave up 2% to fund it.
    expect(css).toMatch(/\.shipment-container-ledger__col--notes\s*\{[^}]*width:\s*12%;/);
    expect(css).toMatch(/\.shipment-container-ledger__col--status\s*\{[^}]*width:\s*11%;/);
    expect(css).toMatch(/\.shipment-container-ledger__dispatch-badge\s*\{[^}]*max-width:\s*100%;[^}]*font-size:\s*var\(--text-caption-size\);[^}]*line-height:\s*1\.4;[^}]*white-space:\s*normal;/);
  });

  it('SCHEDULE-LAYOUT-07 gives both mobile ports equal width without an obsolete arrow track', () => {
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shipment-container-ledger__route\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*align-items:\s*start;/);
    expect(css).not.toMatch(/\.shipment-container-ledger__route\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.shipment-container-ledger__route > span\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/);
  });

  it('places pagination in the container ledger scroll region', () => {
    expect(source).toMatch(/<ShipmentContainerLedger[\s\S]*?footer=\{<Pagination page=\{page\}/);
    expect(ledgerSource).toMatch(/<div className="shipment-container-ledger"[\s\S]*?\{footer\}[\s\S]*?<\/div>/);
  });

  it('keeps pagination out of single-row and mobile record content', () => {
    expect(css).toMatch(/\.shipment-container-ledger > \.ds-pagination\s*\{[^}]*position:\s*static;/);
    expect(css).toMatch(/@media \(min-width:\s*1101px\)[\s\S]*?\.shipment-container-ledger:has\(tbody > tr:nth-child\(2\)\) > \.ds-pagination\s*\{[^}]*position:\s*sticky;/);
  });

  it('keeps an opened cell editor above the sticky pagination layer', () => {
    expect(tokens).toMatch(/--z-sticky:\s*100;/);
    expect(tokens).toMatch(/--z-overlay:\s*200;/);
    expect(css).toMatch(/\.shipment-container-ledger > \.ds-pagination\s*\{[^}]*z-index:\s*var\(--z-sticky, 100\);/);
    expect(css).toMatch(/\.shipment-container-ledger__editing-cell\s*\{[^}]*z-index:\s*var\(--z-overlay, 200\);/);
  });

  it('uses a dense intermediate ledger grid without empty half-width bands', () => {
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1000px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1000px\)[\s\S]*?tbody > tr > td\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*76px;[^}]*padding:\s*8px 10px;/);
    // Card-collapse modes must reset the desktop 72px floor (workboard pattern:
    // auto + 76px floor) — a definite height under overflow: hidden clips cells.
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?tbody > tr > td\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*76px;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1000px\)[\s\S]*?th\.shipment-container-ledger__editable-cell,\s*\.shipment-container-ledger tbody > tr > td\.shipment-container-ledger__editable-cell\s*\{[^}]*height:\s*auto;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1000px\)[\s\S]*?th\.shipment-container-ledger__editable-cell::before,\s*\.shipment-container-ledger tbody > tr > td\.shipment-container-ledger__editable-cell::before\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1000px\)[\s\S]*?\.shipment-container-ledger__cell-trigger > :not\(\.shipment-container-ledger__edit-purpose\)\s*\{[^}]*grid-column:\s*2;/);
    expect(ledgerSource).toContain('data-cell-label={modeLabelForTrigger(mode)}');
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1000px\)[\s\S]*?tbody > tr > :nth-child\(8\)\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).not.toContain('tbody > tr > :nth-child(4),');
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*780px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*780px\)[\s\S]*?tbody > tr > :nth-child\(even\)\s*\{[^}]*border-right:\s*0;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*780px\)[\s\S]*?\[data-mode="documents"\][\s\S]*?\.shipment-container-ledger__cell-trigger::before\s*\{[^}]*content:\s*"CHỨNG TỪ";/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?tbody > tr > td\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger__route\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    const phone = css.slice(css.indexOf('@media (max-width: 520px)'));
    expect(phone).toMatch(/\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(phone).toMatch(/tbody > tr > td\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*min-height:\s*44px;/);
    expect(phone).toMatch(/tbody > tr > :is\(:first-child, :nth-child\(4\), :nth-child\(7\), :nth-child\(8\)\)\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(phone).toMatch(/\.shipment-container-ledger__cell-trigger::before\s*\{[^}]*position:\s*static;[^}]*grid-column:\s*1;[^}]*width:\s*auto;/);
    expect(phone).toMatch(/\.shipment-container-ledger__cell-trigger > :not\(\.shipment-container-ledger__edit-purpose\)\s*\{[^}]*grid-column:\s*1;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger__editing-cell\s*\{[^}]*grid-column:\s*1 \/ -1 !important;/);
    expect(phone).toMatch(/\.shipment-container-ledger__editing-cell\s*\{[^}]*display:\s*block;[^}]*grid-column:\s*1 \/ -1 !important;[^}]*padding:\s*0 0 8px !important;/);
    expect(phone).toMatch(/\.shipment-container-ledger__editing-cell::before\s*\{[^}]*display:\s*none;/);
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
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1000px\)[\s\S]*\.shipment-container-ledger__editing-cell\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).not.toContain('.shipment-container-ledger__editor-row');
    expect(css).toMatch(/\.shipment-container-ledger__editing-cell\s*\{[^}]*overflow:\s*visible !important;/);
    expect(css).toMatch(/\.shipment-container-ledger__editable-cell\s*\{[^}]*height:\s*1px;[^}]*padding:\s*0 !important;/);
    expect(css).toMatch(/\.shipment-container-ledger__editable-cell > \.shipment-container-ledger__cell-editor\s*\{[^}]*position:\s*relative;[^}]*height:\s*100%;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-editor\s*\{[^}]*position:\s*relative;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-editor > \.shipment-container-ledger__inline-editor\s*\{[^}]*position:\s*absolute;[^}]*top:\s*calc\(100% \+ 6px\);[^}]*display:\s*flex;[^}]*box-shadow:\s*none;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-editor > \.shipment-container-ledger__inline-editor\s*\{[^}]*width:\s*min\(420px, calc\(100vw - 28px\)\);[^}]*flex-direction:\s*column;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-editor\[data-mode="notes"\] > \.shipment-container-ledger__inline-editor\s*\{[^}]*right:\s*-4px;[^}]*left:\s*auto;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-editor\[data-mode="schedule"\] > \.shipment-container-ledger__inline-editor\s*\{[^}]*right:\s*-4px;[^}]*left:\s*auto;/);
    expect(css).not.toContain('data-mode="appointment"');
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1000px\)[\s\S]*\.shipment-container-ledger__cell-editor > \.shipment-container-ledger__inline-editor\s*\{[^}]*position:\s*static;[^}]*width:\s*100%;/);
    expect(css).toMatch(/@media \(pointer:\s*coarse\)[\s\S]*?\.shipment-container-ledger__editor-grid input:not\(\[data-uui-control\] input\),[\s\S]*?\.searchable-select__trigger\s*\{[^}]*height:\s*var\(--control-touch-h\);[^}]*min-height:\s*var\(--control-touch-h\);/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    // The appointment-popover redesign (7ad16f89) pairs the ngày/giờ fields
    // side by side inside the schedule tray — giờ leads (f495a3c4 order), so
    // the narrow giờ column comes first and the date keeps the wide track.
    expect(css).toMatch(/\.shipment-container-ledger__editor-grid--schedule\s*\{[^}]*grid-template-columns:\s*minmax\(0, 0\.8fr\)\s*minmax\(0, 1\.2fr\);/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-grid input:not\(\[data-uui-control\] input\),[\s\S]*?\.searchable-select__trigger\s*\{[^}]*height:\s*var\(--control-default-h\);[^}]*min-height:\s*var\(--control-default-h\);[^}]*font-size:\s*var\(--control-field-font-size\);/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-footer\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;[^}]*border-top:\s*1px solid var\(--line-2\);/);
    expect(css).toMatch(/\.shipment-container-ledger__edit-action\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*36px;[^}]*height:\s*36px;[^}]*min-height:\s*36px;[^}]*padding-inline:\s*12px;/);
    expect(css).toMatch(/\.shipment-container-ledger__keyboard-hint\s*\{[^}]*font-size:\s*var\(--text-caption-size\);/);
    expect(css).toMatch(/\.shipment-container-ledger__edit-error\s*\{[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.shipment-container-ledger__recovery\s*\{[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.shipment-container-ledger__edit-action\s*\{[^}]*min-width:\s*44px;[^}]*height:\s*44px;[^}]*min-height:\s*44px;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger__keyboard-hint\s*\{[^}]*display:\s*none;/);
    // Labels stay visible at every width — the icon-only skin (hidden
    // [data-text]) is gone, so no rule may target the text span again.
    expect(css).not.toMatch(/\.shipment-container-ledger__edit-action \[data-text\]/);
    expect(css).toContain('.shipment-container-ledger__edit-action:disabled [data-icon] { color: inherit; }');
    // Disabled Save keeps legible muted text and an icon with the same color.
    expect(css).toMatch(/\.shipment-container-ledger__edit-action:disabled\s*\{[^}]*background:\s*var\(--surface-2\);[^}]*color:\s*var\(--ink-3\);[^}]*opacity:\s*1;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1000px\)[\s\S]*\.shipment-container-ledger__cell-trigger,[\s\S]*?\.shipment-container-ledger__edit-action\s*\{[^}]*min-height:\s*40px;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1000px\)[\s\S]*\.shipment-container-ledger__edit-action\s*\{[^}]*min-width:\s*40px;[^}]*height:\s*40px;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*1000px\)[\s\S]*tbody > tr > td\.shipment-container-ledger__editable-cell\s*\{[^}]*height:\s*auto;/);
  });

  it('uses a distinct, non-destructive pending state when today still needs vehicle allocation', () => {
    expect(css).toMatch(/shipment-container-ledger__row--missing-date/);
    // Amber is an attention signal scoped to the schedule cell, never a full-row fill.
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr\.shipment-container-ledger__row--missing-date > td\[data-label='Lịch trình'\]\s*\{[^}]*background:/);
    expect(css).not.toMatch(/__row--missing-date > th,/);
    expect(css).not.toMatch(/__row--missing-date > td\s*\{/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-pending/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-state/);
    expect(css).toMatch(/shipment-container-ledger__plate--missing/);
    expect(ledgerSource).not.toContain('shipment-container-ledger__vehicle-guidance');
    expect(css).toContain(':not(.shipment-container-ledger__row-warning)');
    expect(css).toMatch(/shipment-container-ledger__multiline:not\(\.shipment-container-ledger__notes\) > span:not\(\.shipment-container-ledger__combined\):not\(\.shipment-container-ledger__plate\):not\(\.shipment-container-ledger__dispatch-badge\):not\(\.shipment-container-ledger__vehicle-state\)/);
    // Status chips are UUI badges: the component owns fill, ring, and geometry;
    // page CSS only tunes type so a chip can never read as a button.
    expect(css).toMatch(/\.shipment-container-ledger__plate--missing\s*\{[^}]*color:\s*var\(--warning-text\);[^}]*font-size:\s*var\(--text-caption-size\);/);
    expect(css).not.toMatch(/__plate--missing\s*\{[^}]*border/);
    expect(css).toMatch(/\.shipment-container-ledger__vehicle-state\s*\{[^}]*color:\s*var\(--warning-text\);[^}]*font-size:\s*var\(--text-caption-size\);/);
    expect(css).toMatch(/\.shipment-container-ledger__schedule-gap\s*\{[^}]*color:\s*var\(--warning-text\);/);
    expect(ledgerSource).toMatch(/<BadgeWithDot size="sm" color="warning" className="shipment-container-ledger__plate--missing">/);
    expect(ledgerSource).toMatch(/<Badge size="sm" color="warning" className="shipment-container-ledger__vehicle-state">/);
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
    expect(css).not.toMatch(/__direction--import\s*\{[^}]*var\(--info/);
    expect(css).not.toMatch(/__direction--export\s*\{[^}]*var\(--brand/);
    expect(css).not.toMatch(/shipment-container-ledger__vehicle-alert/);
    expect(css).not.toMatch(/shipment-container-ledger__vehicle-pending\s*\{[^}]*var\(--danger\)/);
  });
});
