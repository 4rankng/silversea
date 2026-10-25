import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.tsx'), 'utf8');
// Row markup moved into the feature leaf in the 2026-09-01 structural split.
const rowSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusShipmentRow.tsx'), 'utf8');
const ledgerSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusContainerLedger.tsx'), 'utf8');
const ledgerRowSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusContainerLedgerRow.tsx'), 'utf8');
// SIL-479: the page-host wrapper floor measured at the 1024px viewport with
// the card full-row (sidebar 248 + gutters) — the narrowest desktop row the
// percentage shares must satisfy. Re-measure with
// qa/scripts/2026-10-25-sil479-container-fullrow-shots.mjs if the shell
// chrome ever changes.
const SIL479_PAGE_WRAPPER_FLOOR = 863;

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
    // The floor is the shared control token, not a private 44px: the operator
    // ruling of 2026-09-27 caps every component at 40px (`--control-max-h`,
    // which `--control-touch-h` resolves to) and the 44px inflation around
    // 12px text is the defect that ruling names. A cell trigger still clears
    // the floor, still opts out of double-tap zoom, and still opens a dialog.
    expect(css).toMatch(/\.cus-inline-trigger\s*\{[^}]*min-height:\s*var\(--control-touch-h[^}]*touch-action:\s*manipulation;/);
    expect(rowSource).toContain('aria-haspopup="dialog"');
    expect(rowSource).toContain("onStartQuickEdit(item, 'schedule')");
    expect(rowSource).toContain("onStartQuickEdit(item, 'notes')");
  });

  it('uses the grouped multi-line spreadsheet pattern instead of two tall operational bands', () => {
    expect(ledgerSource).toContain('<table className="cus-container-table">');
    // SIL-483: the drawer row is the grouped multi-line sheet — value lines
    // with ghost editors, no ShipmentContainerCell reveal shells.
    expect(ledgerRowSource).toContain('cus-line cus-line--trigger');
    expect(ledgerRowSource).not.toContain('<ShipmentContainerCell');
    expect(ledgerSource).toContain('<th scope="col">Container</th>');
    expect(ledgerSource).toContain('<th scope="col">Giờ đóng/trả</th>');
    // SIL-483 supersedes the FB-045 px-floor doctrine: percentage tracks (the
    // consult px grid at its 1088px reference) mean the sheet compresses with
    // the drawer instead of scrolling — the AC "không scroll ngang ở ≥1024".
    expect(css).toMatch(/\.cus-container-table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*border-collapse:\s*collapse;[^}]*table-layout:\s*fixed;/);
    expect(css).toMatch(/\.cus-container-table-scroll\s*\{[^}]*overflow-x:\s*auto;/);
    expect(css).toMatch(/\.cus-container-table-scroll\s*\{[^}]*border:\s*1px solid var\(--hairline, var\(--line\)\);/);
    // Anti-nesting: hairline horizontals only — no vertical borders.
    expect(css).toMatch(/\.cus-container-table th,\s*\n\.cus-container-table td\s*\{[^}]*border-right:\s*0;[^}]*border-bottom:\s*1px solid var\(--hairline, var\(--line\)\);/);
    // Ghost inputs: no border, hover fill, grouped lines own 28px hits.
    expect(css).toMatch(/\.cus-container-cell input,[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?min-height:\s*28px;/);
    expect(css).toMatch(/\.cus-container-cell \.cus-line\s*\{[^}]*min-height:\s*28px;/);
    expect(css).toMatch(/\.cus-container-cell \.cus-line--trigger:hover[\s\S]*?background:\s*var\(--hairline-hover, var\(--surface-2\)\);/);
    expect(css).toMatch(/\.cus-container-ledger__head\s*\{/);
    expect(ledgerSource).not.toContain('cus-container-cell--save');
    expect(ledgerSource).not.toContain('Lưu container');
  });

  it('switches the worksheet into two-column task cards while retaining touch-sized controls', () => {
    expect(css).toMatch(/@container shipment-drawer \(max-width: 760px\)[\s\S]*?\.cus-container-table \.cus-container-row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@container shipment-drawer \(max-width: 760px\)[\s\S]*?\.cus-container-table \.cus-container-cell--identity\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/);
    expect(ledgerRowSource).toMatch(/<SearchableSelect[\s\S]*?size="sm"/);
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.cus-container-table \.cus-container-cell input,[\s\S]*?\.cus-container-table \.cus-container-cell \.searchable-select__trigger\s*\{[^}]*min-height:\s*var\(--control-max-h\);[^}]*font-size:\s*var\(--control-field-font-size\);/);
    expect(css).toMatch(/\.shipments-page \.ds-pagination__controls\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
  });

  // SIL-483 SUPERSEDES card 201026140000/FB-045 lan 2 (px floors + min-width):
  // the consult's own AC — "không scroll ngang ở ≥1024" — is incompatible with
  // 1088px of px floors inside a 960px drawer, so the tracks are the consult
  // px grid expressed as percentages of its 1088px reference. At the wide
  // drawer the sheet reads exactly the specced pixel grid; below it, grouped
  // cells compress. The add row leaves the grid at ≤1000px (single-track form)
  // because the segmented giờ hẹn input cannot live in a 12.87% track.
  it('keeps every ledger column on one proportional grid derived from the consult px table', () => {
    const colgroup = ledgerSource.slice(ledgerSource.indexOf('<colgroup>'), ledgerSource.indexOf('</colgroup>'));
    const classes = [...colgroup.matchAll(/<col className="(cus-container-col__\w+)"/g)].map((match) => match[1]);
    expect(classes).toEqual([
      'cus-container-col__declaration',
      'cus-container-col__identity',
      'cus-container-col__route',
      'cus-container-col__carrier',
      'cus-container-col__site',
      'cus-container-col__weight',
      'cus-container-col__appointment',
      'cus-container-col__actions',
    ]);

    const widths = classes.map((className) => {
      const rule = new RegExp(`\\.${className} \\{ width: ([\\d.]+)%; \\}`).exec(css);
      expect(rule, `${className} carries its percentage track`).toBeTruthy();
      return Number(rule![1]);
    });
    const total = widths.reduce((sum, width) => sum + width, 0);
    expect(Math.round(total * 100) / 100).toBe(100);

    // The consult px reference each track derives from (1088px sum).
    const pxReference: Record<string, number> = {
      'cus-container-col__declaration': 120,
      'cus-container-col__identity': 200,
      'cus-container-col__route': 160,
      'cus-container-col__carrier': 220,
      'cus-container-col__site': 100,
      'cus-container-col__weight': 100,
      'cus-container-col__appointment': 140,
      'cus-container-col__actions': 48,
    };
    for (const [index, className] of classes.entries()) {
      expect(Math.round(widths[index]! / 100 * 1088)).toBe(pxReference[className]!);
    }
    // The one-line value law for the giờ đóng/trả mask.
    expect(css).toMatch(/\.cus-appointment-trigger__text\s*\{[^}]*white-space:\s*nowrap;/);
    expect(css).toMatch(/\.cus-appointment-trigger__text\s*\{[^}]*text-overflow:\s*ellipsis;/);
    // The add-actions pair WRAPS inside its track — during `adding` the submit
    // label swaps to the wider "Đang thêm…" and stacking can never spill.
    expect(css).toMatch(/\.cus-container-ledger__add-actions\s*\{[^}]*flex-wrap:\s*wrap;/);
  });

  // SIL-479 (owner 24/10) — re-derived on the SIL-483 grouped 8-column grid
  // (the old 12-col share list died with the type/dispatch/plate tracks; the
  // six content tracks are the drawer's consult % scaled into the 70.1% the
  // two behavioral floors leave): the /shipments/:id page host spans the full
  // grid row from 1024 (grid-column pin lives in ShipmentDetailPage.css) and
  // its columns take percentage shares of the real row — the drawer's lock
  // must not leak there, and the floor laws must still hold at the 1024px
  // worst case. Scoped to `.shipment-detail__card--flush`: the drawer host
  // and viewports <1024 keep the drawer's proportional sheet + scroll law.
  it('SIL-479: page-host ledger goes full-row percentage from 1024 — drawer floors stay the fallback', () => {
    const detailCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDetailPage.css'), 'utf8');
    expect(detailCss).toMatch(
      /@media \(min-width: 1024px\)\s*\{\s*\.shipment-detail__card--flush \{ grid-column: 1 \/ -1; \}\s*\}/,
    );
    const band = /@media \(min-width: 1024px\) \{\s*\/\* SIL-479[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(band).toContain('.shipment-detail__card--flush .cus-container-table { min-width: 0; }');
    const share = (name: string) => Number(
      new RegExp(`\\.shipment-detail__card--flush \\.cus-container-col__${name} \\{ width: ([\\d.]+)%; \\}`).exec(band)?.[1] ?? NaN,
    );
    // SIL-483 colgroup: eight grouped tracks, site ONCE (the old 12-col list
    // counted site twice — the type/dispatch/plate tracks no longer exist).
    const names = ['declaration', 'identity', 'route', 'carrier', 'site', 'weight', 'appointment', 'actions'] as const;
    const total = names.reduce((sum, name) => sum + share(name), 0);
    expect(total).toBeCloseTo(100, 5);
    // SIL-479's re-derived behavioral floors survive the SIL-483 squeeze at
    // the measured 1024px worst case (wrapper 863): giờ hẹn keeps the
    // segmented datetime's measured need — the page host has no
    // shipment-drawer container, so the drawer's ≤1000px single-track
    // add-form law never fires there and the add row still rides the grid —
    // and Thao tác keeps the Thêm/Hủy pair.
    expect(share('appointment') / 100 * SIL479_PAGE_WRAPPER_FLOOR).toBeGreaterThanOrEqual(150);
    expect(share('actions') / 100 * SIL479_PAGE_WRAPPER_FLOOR).toBeGreaterThanOrEqual(100);
    // The override never re-binds the drawer host.
    expect(band).not.toContain('cus-shipment-drawer');
  });

  // Card 20260923_9 residual, re-scoped by SIL-483 (the ≤560 single-track law
  // broadened to ≤1000): the add-container form gives every field its whole
  // row once the sheet compresses — the segmented giờ hẹn input cannot live
  // in a 12.87% track.
  it('gives every add-container field its whole row once the sheet compresses', () => {
    expect(css).toMatch(
      /@container shipment-drawer \(max-width: 1000px\)[\s\S]*?\.cus-container-table \.cus-container-ledger__add-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    // The single track is only reachable while the card layout owns the row —
    // a bare 1fr override on the table row would fight the 8-track grid.
    expect(css).toMatch(
      /@container shipment-drawer \(max-width: 1000px\)[\s\S]*?\.cus-container-table \.cus-container-ledger__add-row\s*\{[\s\S]*?display:\s*grid;/,
    );
  });
});

// Card 20260925_1 (CHIEF 25/09 09:46) export-button pins — SUPERSEDED by
// card 20260926_45/_47: the summary rail is gone; Tải XLSX rides the Row 1
// action cluster (ghost, h-8 desktop, 40px touch budget below 768px) and never
// owns a full-width row.
describe('shipment worksheet export button — non-fighting compact (superseded by 20260926_47)', () => {
  it('Tải XLSX rides Row 1 at h-8 on desktop; no full-width slab anywhere', () => {
    // h-8 law scoped to ≥768 — below it the UUI button keeps its40px touch
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
