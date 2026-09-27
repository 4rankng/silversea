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
    // h-8 law scoped to ≥768 — below it the UUI button keeps its 44px touch
    // floor. Matched by selector (the rule only lives inside the ≥768 query,
    // so a stray top-level copy would be a different regression).
    const exportRule = css.match(/\.shipments-control__actions \.shipment-uui-button\s*\{([^}]*)\}/)?.[1] ?? '';
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

// Card 20260925_1 kept ONE promise: every control the shared bar hosts reads the
// one height token (`--filter-control-h`). The `.list-filter-bar__pair` 2-column
// wrapper and its `WorkboardFilters` host are deleted (card 20260927_152) — the
// bar packs its own lines and the last page-local bar is gone.
describe('shipment worksheet — mobile filter inheritance (card 20260925_1)', () => {
  it('ListFilterBar pins every hosted control to --filter-control-h on phones — one height token', () => {
    const listCss = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.css'), 'utf8');
    // Card 20260925_8: mobile break 480 → 767.
    const mobile = listCss.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    // The phone rule pins the height on every control surface the bar hosts
    // (search, native input, date wrapper, uui select).
    expect(mobile).toMatch(/min-height:\s*var\(--filter-control-h\)/);
    // The pair wrapper is gone: no RULE may reopen it (the sheet may still
    // name it in the comment that records the deletion).
    expect(listCss).not.toMatch(/\.list-filter-bar__pair[\s>,{]/);
  });
});

// Card 20260925_5's wide-pair contract is retired with `.list-filter-bar__pair`
// (card 20260927_152): the bar packs its own lines, the pair wrapper's only host
// (`WorkboardFilters`) is deleted, and the one control group that still owns a
// 2-track grid is the shared from/to date group — pinned in
// `filter-grid-rebuild.styles.test.ts` and `FilterBar.styles.test.ts`.
