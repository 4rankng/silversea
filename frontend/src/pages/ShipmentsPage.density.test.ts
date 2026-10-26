import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.tsx'), 'utf8');
// Row markup moved into the feature leaf in the 2026-09-01 structural split.
const rowSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusShipmentRow.tsx'), 'utf8');

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

  it('uses the read-only review sheet instead of an editable ledger (SIL-485)', () => {
    // SIL-485 (owner mockup 25/10): the drawer body is CusLotView — a review
    // sheet + review cards. The editable ledger chain is deleted; no editor
    // affordance may come back through a page-local re-implant. The two
    // sanctioned exceptions are the SIL-498 (26e42187) per-cont declaration
    // cell and the SIL-508 SỐ CONTAINER group — 10 columns now: LOẠI +
    // TRỌNG LƯỢNG live inside the SỐ CONTAINER cell and the 1200px floor is
    // gone so the sheet fills the drawer without a horizontal scrollbar at
    // standard viewports.
    const viewSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusLotView.tsx'), 'utf8');
    expect(viewSource).toContain('<table className="cus-lot-table">');
    for (const header of ['STT', 'Số container', 'Số tờ khai', 'Nhà máy', 'Tuyến đường', 'Nhà xe / BKS', 'Cảng nâng', 'Cảng hạ', 'Đóng / trả', 'Trạng thái']) {
      expect(viewSource).toContain(header);
    }
    for (const retired of ['<th scope="col">Loại</th>', '<th scope="col">Trọng lượng</th>']) {
      expect(viewSource).not.toContain(retired);
    }
    expect(pageSource).not.toContain('CusContainerLedger');
    expect(pageSource).not.toContain('CusDrawerFooter');
    // The sheet compresses by scrolling inside its card, never clipping; the
    // SIL-508 column merge removes the 1200px floor (no forced h-scroll).
    expect(css).toMatch(/\.cus-lot-table-scroll\s*\{[^}]*overflow-x:\s*auto;/);
    expect(css).toMatch(/\.cus-lot-table\s*\{[^}]*width:\s*100%;[^}]*border-collapse:\s*collapse;/);
    expect(css).not.toMatch(/\.cus-lot-table\s*\{[^}]*min-width:\s*1200px/);
    // SIL-508: the SỐ CONTAINER group stacks its three click-to-edit ghost
    // lines, each gated by the line's own fieldAccess mode.
    expect(viewSource).toContain('ContainerGroupCell');
    expect(viewSource).toContain("line.fieldAccess[field]?.mode === 'DIRECT'");
    expect(css).toMatch(/\.cus-lot-line\s*\{[^}]*display:\s*flex;/);
    // SIL-498: the declaration cell keeps its opaque 32px house control;
    // SIL-508 narrows it to the 11-character mono box the column needs.
    expect(css).toMatch(/\.cus-lot-decl\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.cus-lot-decl__input\s*\{[^}]*width:\s*11ch;[^}]*height:\s*32px;[^}]*border:\s*1px solid var\(--control-border\);[^}]*border-radius:\s*var\(--radius-sm\);/);
    expect(css).toMatch(/\.cus-lot-decl__input\s*\{[^}]*font-family:\s*var\(--font-data\);/);
    // Anti-nesting: hairline horizontals only — no vertical borders.
    expect(css).toMatch(/\.cus-lot-table th,\s*\n\.cus-lot-table td\s*\{[^}]*border-bottom:\s*1px solid var\(--line\);/);
    expect(css).not.toMatch(/\.cus-lot-table[^{]*\{[^}]*border-right:\s*1px/);
  });

  it('switches the drawer cards onto the drawer canvas while keeping page pagination wrapping', () => {
    expect(css).toMatch(/@container shipment-drawer \(max-width: 760px\)[\s\S]*?\.cus-lot-fact-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@container shipment-drawer \(max-width: 760px\)[\s\S]*?\.cus-lot-cards-row\s*\{[^}]*grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/\.shipments-page \.ds-pagination__controls\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
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
