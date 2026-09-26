import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.tsx'), 'utf8');
// Row markup moved into the feature leaf in the 2026-09-01 structural split.
const rowSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusShipmentRow.tsx'), 'utf8');
const ledgerSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusContainerLedger.tsx'), 'utf8');
const ledgerRowSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusContainerLedgerRow.tsx'), 'utf8');

describe('shipment container editor density', () => {
  it('keeps Untitled toolbar inputs inside a single outlined control shell', () => {
    // Card 20260922_42: the toolbar-scoped shell rules retired with the
    // self-made toolbar; the shared filter-bar sheet + design-system
    // defaults own the control chrome now.
    expect(css).not.toMatch(/cus-worksheet-toolbar/);
  });

  it('keeps edit fields in one bounded dialog instead of expanding a table column', () => {
    expect(css).toMatch(/\.cus-quick-edit-modal__fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.cus-quick-edit-modal__help\s*\{[^}]*font-size:\s*var\(--text-caption-size\);/);
  });

  it('uses one compact typography scale for table values and metadata', () => {
    expect(pageSource).toContain('cus-dashboard-table ops-table');
    expect(css).toMatch(/\.cus-dashboard-table\s*\{[^}]*font-size:\s*var\(--ops-table-supporting-size\);/);
    expect(css).toMatch(/\.cus-multiline-cell strong\s*\{[^}]*font-size:\s*var\(--ops-table-primary-size\);/);
    expect(css).toMatch(/\.cus-multiline-cell span\s*\{[^}]*font-size:\s*var\(--ops-table-meta-size\);/);
  });

  it('binds touch-friendly cell triggers to an explicit edit dialog', () => {
    expect(css).toMatch(/\.cus-inline-trigger\s*\{[^}]*min-height:\s*44px;[^}]*touch-action:\s*manipulation;/);
    expect(rowSource).toContain('aria-haspopup="dialog"');
    expect(rowSource).toContain("onStartQuickEdit(item, 'schedule')");
    expect(rowSource).toContain("onStartQuickEdit(item, 'notes')");
  });

  it('uses the create-form spreadsheet pattern instead of two tall operational bands', () => {
    expect(ledgerSource).toContain('<table className="cus-container-table">');
    expect(ledgerRowSource).toContain('<ShipmentContainerCell');
    expect(ledgerRowSource).toContain("import { ShipmentContainerCell } from '../create/ShipmentContainerCell';");
    expect(ledgerSource).toContain('<th scope="col">Container</th>');
    expect(ledgerSource).toContain('<th scope="col">Giờ hẹn đóng/trả</th>');
    // 2026-09-08: percentage columns (sum 100%) replaced the 1186px min-width
    // so the fixed-layout ledger fits its container without horizontal scroll.
    expect(css).toMatch(/\.cus-container-table\s*\{[^}]*width:\s*100%;[^}]*border-collapse:\s*collapse;[^}]*table-layout:\s*fixed;/);
    expect(css).not.toMatch(/\.cus-container-table\s*\{[^}]*min-width:\s*\d{3,}px/);
    expect(css).toMatch(/\.cus-container-col__site\s*\{\s*width:\s*10%;/);
    expect(css).toMatch(/\.cus-container-table tbody \.csc-container-cell\s*\{\s*padding:\s*0;/);
    expect(css).toMatch(
      /\.cus-container-cell :is\(\.searchable-select__value, \.searchable-select__placeholder\)\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/,
    );
    expect(ledgerRowSource).toContain('label: option.code');
    expect(css).toMatch(/\.cus-container-table-scroll\s*\{[^}]*overflow-x:\s*auto;/);
    expect(css).toMatch(/\.cus-container-cell input,[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?min-height:\s*28px;/);
    expect(css).toMatch(/\.cus-container-ledger__head\s*\{/);
    expect(css).not.toMatch(/\.cus-container-record__tier\s*\{/);
    expect(ledgerSource).not.toContain('cus-container-cell--save');
    expect(ledgerSource).not.toContain('Lưu container');
  });

  it('switches the worksheet into two-column task cards while retaining touch-sized controls', () => {
    expect(css).toMatch(/@container shipment-drawer \(max-width: 760px\)[\s\S]*?\.cus-container-table \.cus-container-row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@container shipment-drawer \(max-width: 760px\)[\s\S]*?\.cus-container-table \.cus-container-cell--identity\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/);
    expect(css).toMatch(/@container shipment-drawer \(max-width: 760px\)[\s\S]*?\.cus-container-table \.cus-container-cell--identity\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(ledgerRowSource).toMatch(/<SearchableSelect[\s\S]*?size="sm"/);
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.cus-container-table \.cus-container-cell input,[\s\S]*?\.cus-container-table \.cus-container-cell \.searchable-select__trigger\s*\{[^}]*min-height:\s*44px;[^}]*font-size:\s*var\(--control-field-font-size\);/);
    expect(css).toMatch(/\.shipments-page \.ds-pagination__controls\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
  });

  // Card 20260923_9: the add-container row rides the ledger's colgroup, so
  // every track it covers needs one percentage width and the set must still
  // sum to 100% — a track without a width (or an 11th one over budget) is what
  // pushes the drawer into horizontal scroll and breaks the alignment promise.
  it('keeps every ledger column on one percentage grid that sums to 100%', () => {
    const colgroup = ledgerSource.slice(ledgerSource.indexOf('<colgroup>'), ledgerSource.indexOf('</colgroup>'));
    const classes = [...colgroup.matchAll(/<col className="(cus-container-col__\w+)"/g)].map((match) => match[1]);
    expect(classes).toEqual([
      'cus-container-col__identity',
      'cus-container-col__type',
      'cus-container-col__route',
      'cus-container-col__dispatch',
      'cus-container-col__carrier',
      'cus-container-col__plate',
      'cus-container-col__site',
      'cus-container-col__site',
      'cus-container-col__weight',
      'cus-container-col__appointment',
      'cus-container-col__actions',
    ]);

    const widths = classes.map((className) => {
      const rule = new RegExp(`\\.${className} \\{ width: (\\d+)%; \\}`).exec(css);
      expect(rule, `${className} carries a percentage width`).toBeTruthy();
      return Number(rule![1]);
    });
    expect(widths.reduce((total, width) => total + width, 0)).toBe(100);

    // Percentage-only tracks: a px floor on a column would overflow the
    // drawer's capped 1180px width.
    expect(css).not.toMatch(/\.cus-container-col__\w+ \{[^}]*min-width:\s*\d+px/);
  });

  // Card 20260923_9 residual (QA rung, staging 390): inside the card the add
  // row was a 2-column grid, so Trọng lượng (kg) rendered 160.5px wide in a
  // 353px row — the other half of its row blank, unlike Số container, which
  // owns its whole row. Phones drop the add row to a single track so every
  // field takes its full row; the 2-column card stays for wider drawers.
  it('gives every add-container field its whole row on phones', () => {
    expect(css).toMatch(
      /@container shipment-drawer \(max-width: 560px\)[\s\S]*?\.cus-container-table \.cus-container-ledger__add-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    // The single track is only reachable while the card layout owns the row —
    // a bare 1fr override on the table row would fight the 11-column grid.
    expect(css).toMatch(
      /@container shipment-drawer \(max-width: 760px\)[\s\S]*?\.cus-container-table \.cus-container-ledger__add-row\s*\{[\s\S]*?display:\s*grid;/,
    );
  });
});

// Card 20260925_1 (CHIEF 25/09 09:46) export-button pins — SUPERSEDED by
// card 20260926_45/_47: the summary rail is gone; Tải XLSX rides the Row 1
// action cluster (ghost, h-8 desktop, 44px touch floor below 768px) and never
// owns a full-width row.
describe('shipment worksheet export button — non-fighting compact (superseded by 20260926_47)', () => {
  it('Tải XLSX rides Row 1 at h-8 on desktop; no full-width slab anywhere', () => {
    // h-8 law scoped to ≥768 — below it the UUI button keeps its 44px touch floor.
    const desktop = css.match(/@media \(min-width: 768px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const exportRule = desktop.match(/\.shipments-control__actions \.shipment-uui-button\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(exportRule).not.toBe('');
    expect(exportRule).toMatch(/height:\s*32px/);
    expect(exportRule).toMatch(/min-height:\s*32px/);
    expect(exportRule).not.toMatch(/width:\s*100%/);
    // The old rail family is dead chrome.
    expect(css).not.toContain('cus-workspace-summary__export');
    expect(css).not.toMatch(/\.cus-workspace-summary\b/);
  });

  it('no export rule anywhere claims width 100%', () => {
    expect(css).not.toMatch(/\.[a-z-]*export[a-z_-]*\s*\{[^}]*width:\s*100%/);
  });
});

// Card 20260925_1: the shared ListFilterBar must (a) pin every control to
// one height token (44px on phones, the touch floor) and (b) expose a
// `.list-filter-bar__pair` 2-column grid for short-value pairs so Workboard
// filters render date-pair + dropdown-pair on one row each at 390px.
describe('shipment worksheet — mobile filter inheritance (card 20260925_1)', () => {
  it('ListFilterBar carries a `.list-filter-bar__pair` 2-column grid for short-value pairing on phones', () => {
    const listCss = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.css'), 'utf8');
    // Card 20260925_8 moved the mobile break 480 → 767 (mandate: mobile <768).
    const mobile = listCss.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(mobile).toMatch(/\.list-filter-bar__pair\s*\{[^}]*display:\s*grid/);
    expect(mobile).toMatch(/\.list-filter-bar__pair\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('ListFilterBar pins every hosted control to --filter-control-h (44px) on phones — one height token', () => {
    const listCss = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.css'), 'utf8');
    // Card 20260925_8: mobile break 480 → 767.
    const mobile = listCss.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    // The phone rule pin height on every control surface the bar hosts
    // (search, native input, date wrapper, uui select).
    expect(mobile).toMatch(/min-height:\s*var\(--filter-control-h\)/);
  });

  it('WorkboardFilters markup wraps the date pair and the short-select pair in `.list-filter-bar__pair`', () => {
    const wfSource = readFileSync(resolve(process.cwd(), 'src/components/WorkboardFilters.tsx'), 'utf8');
    // Two pair wrappers — one for the date pair, one for the short dropdown pair.
    const wrappers = wfSource.match(/className="list-filter-bar__pair"/g) ?? [];
    expect(wrappers.length).toBeGreaterThanOrEqual(2);
    // Date pair is the first wrapper (Từ ngày + Đến ngày).
    const firstPair = wfSource.match(/<div className="list-filter-bar__pair"[\s\S]*?<\/div>\s*\n/)?.[0] ?? '';
    expect(firstPair).toContain('Từ ngày giao');
    expect(firstPair).toContain('Đến ngày giao');
    // Short-select pair is the second wrapper (Xuất/Nhập + Loại lô).
    const secondPairStart = wfSource.indexOf('<div className="list-filter-bar__pair"', wfSource.indexOf('<div className="list-filter-bar__pair"') + 1);
    const secondPair = secondPairStart >= 0 ? wfSource.slice(secondPairStart, wfSource.indexOf('</div>', secondPairStart) + 6) : '';
    expect(secondPair).toContain('Xuất / Nhập');
    expect(secondPair).toContain('Loại lô');
  });
});

// Card 20260925_5 (CHIEF 19:09, 1920px screenshot 'Tổng quan lô hàng'): on
// the worksheet the date pair and the short-select pair used to render as
// a detached white panel — the `.list-filter-bar__pair` wrapper defaulted
// to `display: block`, so the two stacked labelled inputs floated as a
// chunky block on a row of their own, reading as a separate filter bar.
// Card 20260925_8 (REBUILD): at any viewport above the phone break the
// pair sits as ONE 2-col grid cell of the bar's grid row (the old inline
// flex-cell could still re-wrap), baseline-aligned with the search /
// Xuất-Nhập / Kế hoạch controls beside it, with zero panel chrome (no
// background, no border, no border-radius, no shadow — flat law §3).
describe('shipment worksheet — wide-pair inheritance (card 20260925_5)', () => {
  it('ListFilterBar pair is one 2-col grid cell of the bar at desktop — no detached panel', () => {
    const listCss = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.css'), 'utf8');
    // Top-level default rule (the one OUTSIDE any @media block) carries
    // the desktop pair cell, so a regression that hid it in a media query
    // would also fail this test.
    const desktopBlock = listCss.match(/\.list-filter-bar__pair\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(desktopBlock, 'pair default rule present at top level').not.toBe('');
    expect(desktopBlock).toMatch(/display:\s*grid/);
    expect(desktopBlock).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(desktopBlock).toMatch(/align-items:\s*end/);
    expect(desktopBlock).toMatch(/gap:\s*12px/);
    // Flat surface — never a panel (default `box-shadow: none` covers
    // the shadow side; the rule never pins one explicitly so the page
    // "no-shadow anywhere" assertion still holds).
    expect(desktopBlock).toMatch(/background:\s*transparent/);
    expect(desktopBlock).toMatch(/border:\s*0/);
    expect(desktopBlock).toMatch(/border-radius:\s*0/);
    // Source order: desktop default first, mobile @media below so the
    // phone stack rule wins by order and never leaks up.
    const desktopIdx = listCss.search(/\.list-filter-bar__pair\s*\{/);
    const mobileIdx = listCss.search(/@media \(max-width: 767px\)/);
    expect(desktopIdx).toBeGreaterThan(-1);
    expect(mobileIdx).toBeGreaterThan(desktopIdx);
    // Mobile grid contract preserved (card 20260925_1; break moved 480 →
    // 767 by card 20260925_8): pair is a 2-col grid on phones.
    const mobile = listCss.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(mobile).toMatch(/\.list-filter-bar__pair\s*\{[^}]*display:\s*grid/);
    expect(mobile).toMatch(/\.list-filter-bar__pair\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  });
});
