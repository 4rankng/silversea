import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsDetailPage.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsDetailPage.tsx'), 'utf8');
const ledgerSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/detail/ShipmentContainerLedger.tsx'), 'utf8');

describe('shipment detail workboard styling', () => {
  it('keeps an ultrawide operational canvas bounded without a card shell', () => {
    expect(css).toMatch(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-detail-page\s*\{[^}]*width:\s*min\(100%, 1800px\);[^}]*max-width:\s*1800px;[^}]*margin-inline:\s*auto;/);
  });

  it('uses a compact filter-only header and aligns the mixed control families', () => {
    expect(css).not.toContain('.shipments-detail-workspace__intro');
    expect(css).not.toContain('.shipments-detail-eyebrow');
    expect(css).toMatch(/\.shipments-detail-filter \[data-label\]\s*\{[^}]*margin-bottom:\s*0;[^}]*font-weight:\s*var\(--fw-semibold\);/);
    expect(css).toMatch(/\.shipments-detail-filter:not\(\[data-input-wrapper\]\) > label\[data-label\]\s*\{[^}]*margin-bottom:\s*5px;[^}]*font-weight:\s*var\(--fw-semibold\);/);
    expect(css).toMatch(/\.shipments-detail-filter\s*\{[^}]*gap:\s*4px;/);
    expect(css).toMatch(/\.shipments-detail-filter \[data-input-wrapper\]\s*\{[^}]*gap:\s*4px;/);
    expect(css).toMatch(/\.shipments-detail-filter--search input\s*\{[^}]*padding-left:\s*30px;/);
    expect(css).not.toMatch(/\.shipments-detail-filter input::placeholder\s*\{[^}]*font-size\s*:/);
    expect(css).not.toContain('.shipments-detail-filters__actions');
    expect(source).toMatch(/<div className="shipments-detail-filters__footer">[\s\S]*?shipments-detail-filters__date-actions[\s\S]*?>Xóa bộ lọc<\/UUIButton>/);
    expect(source).not.toContain('shipments-detail-filters__meta');
    expect(source).not.toContain('Đang lọc');
    expect(css).toMatch(/\.shipments-detail-filters__footer\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/);
    expect(css).toMatch(/\.shipments-detail-filters__date-actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
    expect(css).toMatch(/\.shipments-detail-filters__date-actions button:hover,[\s\S]*?\[data-hovered\]\s*\{[^}]*border-color:\s*var\(--ink-4\);[^}]*background:\s*var\(--surface-2\);/);
    expect(css).not.toContain('.shipments-detail-filters__meta');
    expect(css).toMatch(/\.shipment-container-summary dd\s*\{[^}]*font-size:\s*var\(--fs-sm\);/);
    expect(css).toMatch(/\.shipment-container-ledger thead th\s*\{[^}]*font-size:\s*10px;/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > td\s*\{[^}]*font-size:\s*11px;/);
  });

  it('keeps filter controls in a flat responsive toolbar inside the workboard', () => {
    expect(css).toMatch(/\.shipments-detail-filters\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/);
    const filterToolbar = css.match(/\.shipments-detail-filters\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(filterToolbar).not.toMatch(/(?:padding|border|border-radius|background|box-shadow)\s*:/);
    expect(css).toMatch(/\.shipments-detail-filter input,\s*\.shipments-detail-filter select\s*\{[^}]*box-shadow:\s*none;/);
    expect(css).toMatch(/\.shipments-detail-filter input\s*\{[^}]*background:\s*transparent;/);
    expect(css).toMatch(/\.shipments-detail-filter select\s*\{[^}]*background:\s*var\(--surface\);/);
    expect(css).toMatch(/\.shipments-detail-filter > \*,\s*\.shipments-detail-filter input,\s*\.shipments-detail-filter select\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipments-detail-filters\s*\{[^}]*grid-template-columns:\s*1fr 1fr;/);
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shipments-detail-filters\s*\{[^}]*grid-template-columns:\s*1fr;/);
  });

  it('uses a divider-led workband rather than an outer card around the filters and ledger', () => {
    const workspace = css.match(/\.shipments-detail-workspace\s*\{([^}]*)\}/)?.[1] ?? '';
    const header = css.match(/\.shipments-detail-workspace__header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(workspace).toMatch(/background:\s*transparent;/);
    expect(workspace).not.toMatch(/(?:border|border-radius|box-shadow)\s*:/);
    expect(header).toMatch(/border-block:\s*1px solid var\(--line\);/);
    expect(header).toMatch(/background:\s*transparent;/);
    expect(css).not.toMatch(/\.shipments-detail-workspace\s*\{[^}]*box-shadow:/);
  });

  it('fits desktop columns to the workspace and lets headings wrap instead of forcing horizontal scroll', () => {
    expect(css).toMatch(/\.shipment-container-ledger table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;/);
    expect(css).toMatch(/\.shipment-container-ledger thead th\s*\{[^}]*white-space:\s*normal;/);
    expect(css).not.toMatch(/\.shipment-container-ledger table\s*\{[^}]*min-width:\s*980px;/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > td\s*\{[^}]*overflow:\s*hidden;/);
    expect(css).toMatch(/\.shipment-container-ledger__route\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.shipment-container-ledger__multiline > small\s*\{[^}]*word-break:\s*break-word;/);
    expect(css).toMatch(/tbody > tr > td::before\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*tbody > tr > td\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  });

  it('uses compact type for pending and planned dispatch tags in the container column', () => {
    expect(ledgerSource).toContain('shipment-container-ledger__dispatch-badge--${row.dispatchStatus.toLowerCase()}');
    expect(css).toMatch(/\.shipment-container-ledger__dispatch-badge--unassigned,\s*\.shipment-container-ledger__dispatch-badge--planned\s*\{[^}]*font-size:\s*10px;[^}]*line-height:\s*1\.4;/);
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
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*?tbody > tr > td\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*8px 10px;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*?td\.shipment-container-ledger__editable-cell::before\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*?tbody > tr > :nth-child\(7\)\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).not.toContain('tbody > tr > :nth-child(4),');
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*780px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*780px\)[\s\S]*?tbody > tr > :nth-child\(even\)\s*\{[^}]*border-right:\s*0;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*780px\)[\s\S]*?\[data-mode="documents"\][\s\S]*?\.shipment-container-ledger__cell-trigger::before\s*\{[^}]*content:\s*"CHỨNG TỪ";/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?tbody > tr > td\s*\{[^}]*grid-template-columns:\s*88px minmax\(0, 1fr\);/);
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shipment-container-ledger__cell-trigger\s*\{[^}]*grid-column:\s*2;/);
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shipment-container-ledger__cell-editor--expanded\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger__editing-cell\s*\{[^}]*grid-column:\s*1 \/ -1 !important;/);
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shipment-container-ledger__editing-cell\s*\{[^}]*display:\s*block;[^}]*padding:\s*0 0 32px;/);
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shipment-container-ledger__editing-cell\.shipment-container-ledger__editable-cell\s*\{[^}]*padding:\s*0 0 32px !important;/);
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shipment-container-ledger__editing-cell::before\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shipment-container-ledger__editing-cell > \.shipment-container-ledger__cell-editor\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shipment-container-ledger__editing-cell \.shipment-container-ledger__cell-trigger\s*\{[^}]*margin:\s*0;/);
  });

  it('makes editable values the cell trigger without pencil controls and keeps bounded stacked editor trays', () => {
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger\s*\{[^}]*display:\s*block;[^}]*background:\s*transparent;[^}]*cursor:\s*text;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger\s*\{[^}]*touch-action:\s*manipulation;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger\s*\{[^}]*scroll-margin-top:\s*96px;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger:not\(\.shipment-container-ledger__cell-trigger--read-only\):not\(\[disabled\]\):hover/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\);/);
    expect(css).not.toContain('.shipment-container-ledger__edit-button');
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*\.shipment-container-ledger__editing-cell\s*\{[^}]*grid-column:\s*1 \/ -1;/);
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
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*\.shipment-container-ledger__cell-editor > \.shipment-container-ledger__inline-editor\s*\{[^}]*position:\s*static;[^}]*width:\s*100%;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger__editor-grid input,[\s\S]*?\.searchable-select__trigger\s*\{[^}]*height:\s*44px;[^}]*min-height:\s*44px;/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-grid--schedule\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-grid input,[\s\S]*?\.searchable-select__trigger\s*\{[^}]*height:\s*36px;[^}]*min-height:\s*36px;[^}]*font-size:\s*13px;/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-footer\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;[^}]*border-top:\s*1px solid var\(--line-2\);/);
    expect(css).toMatch(/\.shipment-container-ledger__edit-action\s*\{[^}]*width:\s*36px;[^}]*min-width:\s*36px;[^}]*height:\s*36px;[^}]*min-height:\s*36px;[^}]*padding:\s*0;/);
    expect(css).toMatch(/\.shipment-container-ledger__keyboard-hint\s*\{[^}]*font-size:\s*11px;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.shipment-container-ledger__edit-action\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/);
    expect(css).toMatch(/\.shipment-container-ledger__edit-action \[data-text\]\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger__keyboard-hint\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger__edit-action\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*44px;[^}]*padding-inline:\s*12px;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger__edit-action \[data-text\]\s*\{[^}]*display:\s*inline;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*\.shipment-container-ledger__cell-trigger,[\s\S]*?\.shipment-container-ledger__edit-action\s*\{[^}]*min-height:\s*40px;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*tbody > tr > td\.shipment-container-ledger__editable-cell\s*\{[^}]*height:\s*auto;/);
  });

  it('uses a distinct, non-destructive pending state when today still needs vehicle allocation', () => {
    expect(css).toMatch(/shipment-container-ledger__row--missing-date/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-pending/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-state/);
    expect(css).toMatch(/shipment-container-ledger__plate--missing/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-guidance/);
    expect(css).toContain(':not(.shipment-container-ledger__row-warning)');
    expect(css).toMatch(/\.shipment-container-ledger__multiline > \.shipment-container-ledger__row-warning\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*white-space:\s*nowrap;/);
    expect(css).toMatch(/\.shipment-container-ledger__multiline > \.shipment-container-ledger__row-warning\.shipment-container-ledger__missing-fields\s*\{[^}]*display:\s*grid;[^}]*width:\s*100%;[^}]*grid-template-columns:\s*13px minmax\(0, 1fr\);[^}]*align-items:\s*start;[^}]*white-space:\s*normal;/);
    expect(css).toMatch(/\.shipment-container-ledger__missing-fields > span\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.shipment-container-ledger__row-warning svg\s*\{[^}]*flex:\s*0 0 13px;/);
    expect(css).toMatch(/shipment-container-ledger__multiline > span:not\(\.shipment-container-ledger__combined\):not\(\.shipment-container-ledger__plate\):not\(\.shipment-container-ledger__dispatch-badge\):not\(\.shipment-container-ledger__vehicle-state\)/);
    expect(css).toMatch(/\.shipment-container-ledger__vehicle-state\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*white-space:\s*nowrap;/);
    expect(css).not.toMatch(/shipment-container-ledger__vehicle-alert/);
    expect(css).not.toMatch(/shipment-container-ledger__vehicle-guidance\s*\{[^}]*var\(--danger\)/);
  });
});
