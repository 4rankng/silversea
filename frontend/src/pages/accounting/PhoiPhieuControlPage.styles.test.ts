import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/accounting/PhoiPhieuControlPage.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/accounting/PhoiPhieuControlPage.tsx'), 'utf8');

describe('phôi phiếu board header contract (card 20260922_54)', () => {
  it('thead headers wrap at spaces only — never a mid-word fracture like CONTAINE/R', () => {
    const thead = css.match(/\.ppc-board thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(thead).toContain('word-break: keep-all');
    expect(thead).toContain('overflow-wrap: normal');
    expect(thead).not.toContain('overflow-wrap: anywhere');
    expect(thead).toContain('white-space: normal');
  });
});

// Card 20260930_214 — the assigned-truck table grows with the number of
// assignments and sits ABOVE the batch controls, so unbounded it pushed
// "Chọn tất cả" / "Phân công" past the reachable frame. These two pin the
// remedy so a later tidy-up cannot quietly drop it: the class is bound AND
// the component still wraps the table in it.
describe('phân công xe — the controls stay reachable (card 20260930_214)', () => {
  it('the assigned-truck table is height-bounded and scrolls on its own', () => {
    const block = (css.match(/\.ppc-assign-existing\s*\{([^}]*)\}/)?.[1] ?? '')
      // Strip comments first: the block explains WHY it declares no `display`,
      // so the explanation must not be mistaken for the declaration.
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(block.trim()).not.toBe('');
    expect(block).toMatch(/max-height:\s*\d/);
    expect(block).toContain('overflow-y: auto');
    // A bound ON the <table> would need display:block, which flattens the
    // rows; this is a wrapper, so `display` is deliberately not declared.
    expect(block).not.toMatch(/display:/);
  });

  it('the component wraps that table, and the wrapper closes before the batch bar', () => {
    const component = readFileSync(
      resolve(process.cwd(), 'src/features/accounting/PhoiPhieuTruckAssignments.tsx'), 'utf8');
    const open = component.indexOf('<div className="ppc-assign-existing">');
    const table = component.indexOf('<table');
    const close = component.indexOf('</div>', component.indexOf('</table>'));
    const batch = component.indexOf('ppc-assign-batch');
    expect(open).toBeGreaterThan(-1);
    expect(table).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(table);
    expect(batch).toBeGreaterThan(close);
  });
});

describe('phôi phiếu board cell discipline (card 20260923_8 group B → SIL-875 ladder)', () => {
  it('atomic value tokens never fracture — tiền đường values pin nowrap (design law §4)', () => {
    expect(css).toMatch(/\.ppc-board \.ppc-value\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('SIL-875 — the board runs the chốt ladder: fixed layout, full-canvas width, 1132px full-set floor', () => {
    const board = css.match(/\.ppc-board\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(board).toContain('table-layout: fixed');
    expect(board).toContain('width: 100%');
    expect(board).toContain('min-width: var(--ppc-min, var(--ppc-fixed-sum))');
    expect(board).toContain('--ppc-fixed-sum: 1142px');
    // The ladder lives on the colgroup cols — Chromium honors min-width on
    // <col> in table-layout: fixed (SIL-872's probe-verified rung); the
    // th/td classes stay styling hooks (sticky identity, selection edge).
    expect(css).toMatch(/\.ppc-board col\.ppc-col--lich-trinh\s*\{/);
    // Owner sweep 27/11 — the identity token stays one line while it fits and
    // wraps INSIDE its cell only past the floor ('BK-S1021R-1795651457117'
    // measured 185px against the 116px cell and used to bleed onto the
    // neighbor column under the retired nowrap law).
    expect(css).toMatch(/\.ppc-board \.ppc-identity\s*\{[^}]*white-space:\s*normal/);
    expect(css).toMatch(/\.ppc-board \.ppc-identity\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.ppc-board-wrap\s*\{[^}]*overflow-x:\s*auto/);
    expect(source).toContain('className="ppc-board-wrap ledger-desktop" role="region"');
    expect(source).toContain('className="ppc-board-hint ledger-desktop"');
  });

  it('every column carries its % share + px floor; the full thirteen-column set fits the 1440 canvas', () => {
    const cols: Array<[string, string, string, number]> = [
      ['lich-trinh', '10.15%', '--ppc-w-lich-trinh', 116],
      ['customer-route', '7.7%', '--ppc-w-customer-route', 88],
      ['thongso', '8.4%', '--ppc-w-thongso', 96],
      ['diadiem', '6.83%', '--ppc-w-diadiem', 78],
      ['xe', '7.88%', '--ppc-w-xe', 90],
      ['hoadon', '10.5%', '--ppc-w-hoadon', 120],
      ['money', '9.1%', '--ppc-w-money', 104],
      ['status', '8.4%', '--ppc-w-status', 96],
      ['date', '7.88%', '--ppc-w-date', 90],
      ['ghichu', '5.77%', '--ppc-w-ghichu', 66],
    ];
    let declaredSum = 0;
    let floorSum = 0;
    for (const [col, share, floorVar, floorPx] of cols) {
      const block = css.match(new RegExp(`\\.ppc-board col\\.ppc-col--${col}(?:\\s*,[^{}]*)?\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(block, `${col} keeps its % share`).toContain(`width: ${share}`);
      expect(block, `${col} keeps its px floor`).toContain(`min-width: var(${floorVar})`);
      expect(css, `${floorVar} var matches the TSX map`).toContain(`${floorVar}: ${floorPx}px`);
      expect(source, `${col} floor in the TSX map`).toMatch(new RegExp(`['"]?${col}['"]?: ${floorPx},`));
      // One law, FOUR rendered reading columns: composed Ghi chú + vận tải +
      // chi phí OPS + lái xe.
      const rendered = col === 'ghichu' ? 4 : 1;
      declaredSum += Number(share.slice(0, -1)) * rendered;
      floorSum += floorPx * rendered;
    }
    // Declared widths (99.92% of the base — SIL-988 re-based the shares onto
    // the 1142px sum after funding the hoadon/status grants from the
    // anywhere-wrap donors) must stay UNDER 100% — over 100%
    // the fixed layout widens the table past its container and
    // phantom-scrolls at every canvas; the remainder distributes.
    expect(declaredSum).toBeLessThan(100);
    // The full set (the QA screenshot's thirteen columns incl composed
    // Ghi chú) sums 1142px ≤ the 1144px sidebar-open canvas (measured live
    // on the local dev build at 1440×900) —
    // no horizontal scroll at the acceptance width. SIL-988: hoadon 120
    // keeps the Số-HĐ input whole ('HD-QA1110-01' ≈89px content + the 14px
    // input chrome inside the 108px cell) and status 96 gives 'Đang chạy /
    // Phơi: …' three short lines instead of a six-line crush.
    expect(floorSum).toBe(1142);
    expect(source).toMatch(/const PCC_SPEC_BASE_SUM = /);
  });

  it('the rendered-set law: --ppc-min and --ppc-share-scale derive from the RENDERED colgroup (SIL-872 doctrine)', () => {
    expect(source).toMatch(/'--ppc-min': `\$\{tableMinWidth\}px`/);
    expect(source).toMatch(/'--ppc-share-scale': ppcShareScale/);
    expect(source).toMatch(/const ppcShareScale = \(PCC_SPEC_BASE_SUM \/ tableMinWidth\)\.toFixed\(5\);/);
    // The colgroup renders one <col> per rendered key; the three Ghi chú
    // columns collapse onto one col class.
    expect(source).toMatch(/renderedColKeys\.map\(\(key\) => <col key=\{key\} className=\{ppcColClass\(key\)\} \/>\)/);
  });

  it('the dense 6px gutter replaces the shared 12px inside the board', () => {
    expect(css).toMatch(/\.ppc-board thead th,\s*\.ppc-board tbody td\s*\{[^}]*padding-inline:\s*6px;/);
  });

  it('date atomicity rides the col floor — the blanket cell nowrap is retired (SIL-875)', () => {
    expect(css).not.toMatch(/\.ppc-board td\.ppc-col--date\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.ppc-board col\.ppc-col--date\s*\{[^}]*min-width:\s*var\(--ppc-w-date\)/);
    // SIL-920 — the global .tt-table base paints `overflow-wrap: anywhere`
    // on every td (it outranks the board's `.ppc-board th, .ppc-board td`
    // normal-wrap rule on specificity), so below the floor the date broke
    // MID-number ('22/12/2' / '026'). The date cell re-declares the
    // word-boundary law at cell-level specificity: a date can never shed a
    // digit — the 90px floor holds it whole on one line instead.
    const dateCell = css.match(/\.ppc-board td\.ppc-col--date\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(dateCell).toContain('overflow-wrap: normal');
    expect(dateCell).toContain('word-break: keep-all');
    expect(dateCell).not.toContain('anywhere');
  });

  // Card 20260929_207 + the selection-state contract: the picked row is drawn in
  // NEUTRAL INK structure — a neutral surface plus the sanctioned 3px inset ink
  // edge. The accent `border-left` this test used to pin is the superseded
  // recipe; the sanctioned edge is a painted 1D rule, not depth, so it does
  // not break the flat-sheet ratchet below.
  it('the selected row is marked in neutral ink, never with an accent (design law §3)', () => {
    const selected = css.match(/tr\[data-selected="true"\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(selected).toContain('background: var(--surface)');
    expect(selected).toContain('box-shadow: inset 3px 0 0 var(--ink)');
    expect(css).not.toMatch(/border-left:\s*[2-6]px solid/);
  });

  it('chi hộ affordance inherits the shared default/touch icon-button geometry', () => {
    expect(source).toContain('className="btn btn--secondary btn--icon"');
    expect(source).not.toContain('className="ppc-icon-btn"');
    expect(css).not.toMatch(/ppc-icon-btn/);
  });
});

describe('báo cáo tháng report header (card 20260924_1, image11)', () => {
  it('report headers wrap inside the fixed-layout tt-table and draw sub-column separator lines', () => {
    // tt-table ships white-space: nowrap under table-layout: fixed — a long
    // header paints over its neighbour instead of wrapping (the image11
    // "gộp cột" look). The report tables re-declare wrapping and add the
    // vertical separator the audit asked for; law book §4.
    const reportHead = css.match(/\.ppc-report thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(reportHead).toContain('white-space: normal');
    expect(reportHead).toContain('border-right:');
  });
});

// Card 20260927_152 (operator 2026-09-27: "try to keep filter section max 2
// rows only", "the width of control should relative to value it holds"): the
// page no longer owns the filter strip. `FilterBar` owns the layout and the
// shared sheet owns every control's width, so this sheet may declare NOTHING
// about a filter control — the auto-fit grid, the pair wrappers, the ≤480 phone
// band and the page-owned height overrides are deleted with the markup that
// used them (the bespoke bar was the CHIEF 15:40 incident: "Trạng thái" /
// "Sắp xếp" each ate the whole ~1100px row). The old pins described those
// deleted rules; they are replaced by the contract they were hiding — never
// re-pinned onto a rule that no longer exists.
const FILTER_SURFACE = /\.list-filter-bar|\.filter-bar|\.date-range-fields|\.ds-uui-select|\.filter-dropdown|\[data-input-wrapper\]|\[data-uui-control\]/;
const FILTER_LAYOUT_OR_WIDTH = /(?:^|;)\s*(?:display|flex|flex-wrap|flex-grow|grid|grid-template-columns|grid-column|align-items|justify-content|gap|width|min-width|max-width)\s*:/;

/** Every rule in the sheet whose selector names a filter surface. */
const filterRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, declarations]) => ({ selector: selector.trim(), declarations }))
  .filter((rule) => FILTER_SURFACE.test(rule.selector));

describe('phôi phiếu filter strip contract (card 20260927_152)', () => {
  it('the page sheet declares no filter layout and no control width', () => {
    const offenders = filterRules
      .filter((rule) => FILTER_LAYOUT_OR_WIDTH.test(rule.declarations))
      .map((rule) => rule.selector);
    expect(offenders).toEqual([]);
  });

  it('no page-owned filter grid, bar markup or pair wrapper survives', () => {
    expect(css).not.toMatch(/ppc-filter/);
    // The contract is about FILTER surfaces (covered rule-by-rule above).
    // The blunt whole-sheet grid matcher lands on SIL-1030's voucher-form
    // fields grid (.ppc-lots-phieu__fields, the drawer's Ô lập phiếu) — a
    // form area, not the filter strip — so that one known non-filter grid is
    // outside this assertion's scope.
    const cssOutsideDrawerPhieuForm = css.replace(/\.ppc-lots-phieu__fields[^{]*\{[^}]*\}/g, '');
    expect(cssOutsideDrawerPhieuForm).not.toMatch(/grid-template-columns|grid-column\s*:/);
    expect(source).not.toContain('className="filter-bar');
    expect(source).not.toContain('ppc-filters');
    expect(source).not.toContain('shipments-detail-filters');
  });

  it('the bar carries the shared search slot and the two fields of the shared date pair', () => {
    const bar = source.match(/<FilterBar([\s\S]*?)<\/FilterBar>/)?.[1] ?? '';
    expect(bar).toContain("placeholder: 'Bill/Booking, phí, hóa đơn'");
    expect(bar).toContain("ariaLabel: 'Tìm kiếm'");
    expect(bar).toContain('<DateRangeFields');
    // ONE from/to implementation — the page no longer mounts bare date fields.
    expect(source).not.toContain('<BufferedUuiDateInput');
  });

  it('the secondary criteria live inside the dropdown, which comes last', () => {
    const bar = source.match(/<FilterBar([\s\S]*?)<\/FilterBar>/)?.[1] ?? '';
    const dropdown = bar.match(/<FilterDropdown([\s\S]*?)<\/FilterDropdown>/)?.[1] ?? '';
    for (const label of ['Trạng thái', 'Đối chiếu chi hộ', 'Sắp xếp', 'Loại phiếu', 'Số tài khoản quỹ (STK)']) {
      expect(dropdown).toContain(`label="${label}"`);
    }
    expect(dropdown).toContain('onReset={resetSecondary}');
    expect(bar.indexOf('<DateRangeFields')).toBeLessThan(bar.indexOf('<FilterDropdown'));
  });

  it('the Lập phiếu action rides the bar action slot — the page owns no filter row', () => {
    const bar = source.match(/<FilterBar([\s\S]*?)<\/FilterBar>/)?.[1] ?? '';
    const actionsIndex = bar.indexOf('actions={(');
    expect(actionsIndex).toBeGreaterThan(-1);
    expect(actionsIndex).toBeLessThan(bar.indexOf('<DateRangeFields'));
    // The action's own wiring is NOT pinned here: SIL-1085 (K2.71) moved it
    // behind the preview step, and that behaviour is pinned by BEHAVIOUR in
    // PhoiPhieuControlPage.sil1085.test.tsx (the click opens the preview that
    // names every khoản). What this contract owns is the SLOT: the action
    // lives in the bar's action slot and nowhere else.
    expect(bar).toContain('{voucherLabel}');
  });

  // The flat-sheet law is about DEPTH: elevation, gradients and 3D. The
  // selection edge sanctioned by the selection-state contract
  // (`box-shadow: inset 3px 0 0 var(--ink)`) is a painted 1D rule, not a drop
  // shadow, so it is subtracted before the sweep; comments go with it, so a
  // note that merely NAMES the property no longer fails the board.
  it('flat sheet — no drop shadow, gradient, or 3D anywhere (design law §3)', () => {
    const declared = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(
      declared.replace(/box-shadow:\s*inset 3px 0 0 var\(--ink\)/g, ''),
    ).not.toMatch(/box-shadow|gradient|perspective|rotate3d/);
    // Any shadow this sheet DOES carry is that one sanctioned ink edge — a
    // second declaration in another form fails here even if it is ring-shaped.
    expect(declared.match(/box-shadow/g)?.length ?? 0).toBe(
      declared.match(/box-shadow:\s*inset 3px 0 0 var\(--ink\)/g)?.length ?? 0,
    );
  });
});

// Ticket 18/11 Task 3.2 — the 'Lô chưa thanh toán' party drill-down drawer
// claims 2/3 of the screen so Tiền nâng / Tiền hạ / PS khác stay readable
// beside the Ghi chú column; a later drawer refactor must not silently
// shrink it back to the shared 580px ladder.
describe('lô chưa thanh toán drawer width (ticket 18/11 Task 3.2)', () => {
  it('the party lots drawer claims 2/3 of the screen — 66vw, capped at 1200px', () => {
    const block = css.match(/\.drawer\.ppc-lots-drawer:not\(\.drawer--expanded\)\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).toContain('width: 66vw');
    expect(block).toContain('max-width: 1200px');
  });

  it('phones keep the shared full-width band', () => {
    expect(css).toMatch(
      /@media \(max-width: 640px\) \{\s*\.drawer\.ppc-lots-drawer:not\(\.drawer--expanded\) \{ width: 100%; max-width: none; \}/,
    );
  });

  it('the party drawer still binds the ppc-lots-drawer class', () => {
    const drawerSource = readFileSync(
      resolve(process.cwd(), 'src/pages/accounting/PhoiPhieuPartyLotsDrawer.tsx'), 'utf8');
    expect(drawerSource).toContain('ppc-lots-drawer');
  });
});

// SIL-874 (CR-009.1 follow-up 21/11) — the drawer's Untitled UI table runs the
// chốt ladder. The QA defect: table-layout auto grew the columns to their
// nowrap content (961px measured), spilling the table 28px past the 1440px
// viewport and clipping Ghi chú mid-word ('GHI', 'ĐẶC C…'). The ladder — % shares
// + measured px floors under table-layout: fixed — fits the drawer's 902px
// content box at 1440×900 so the last column reads whole inside the drawer.
describe('lô chưa thanh toán drawer table ladder (SIL-874)', () => {
  const ladder = (col: string) =>
    css.match(new RegExp(`\\.ppc-lots-drawer th\\.ppc-lots-col--${col}(?:\\s*,[^{}]*)?\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('the drawer table is fixed-layout with an 886px floor — fits inside the 66vw drawer at 1440px without clipping Ghi chú', () => {
    const block = css.match(/\.ppc-lots-drawer table:not\(\.record-table\)\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).toContain('table-layout: fixed');
    expect(block).toContain('min-width: 886px');
  });

  it('the vendored 12px gutters trim to the 6px dense-family gutter inside this drawer', () => {
    expect(css).toMatch(
      /\.ppc-lots-drawer table th,\s*\.ppc-lots-drawer table td\s*\{[^}]*padding-inline:\s*6px;/,
    );
  });

  it('every data column carries its % share + px floor; shares sum 96% so the select column owns the rest', () => {
    const cols: Array<[string, string, number]> = [
      ['stt', '3.5%', 32], ['bill', '13%', 104], ['container', '9%', 80],
      ['plate', '8.5%', 76], ['date', '7.5%', 68], ['nang', '7%', 64],
      ['ha', '7%', 64], ['khac', '7%', 64], ['total', '7.5%', 68],
      ['paid', '6.5%', 58], ['remain', '7.5%', 64], ['ghichu', '12%', 108],
    ];
    let shareSum = 0;
    let floorSum = 0;
    for (const [col, share, floor] of cols) {
      const block = ladder(col);
      expect(block, `${col} keeps its % share`).toContain(`width: ${share}`);
      expect(block, `${col} keeps its px floor`).toContain(`min-width: ${floor}px`);
      shareSum += Number(share.slice(0, -1));
      floorSum += floor;
    }
    expect(shareSum).toBeCloseTo(96, 5);
    // QA 27/11 (SIL-874 slack): the twelve data floors sum to 850; the 886px
    // table floor leaves the remaining 36px to the unclassed select column and
    // per-column % rounding — the ladder still fits inside the 902px content
    // box of the 66vw / 950px drawer at 1440px.
    expect(floorSum).toBe(850);
    expect(886 - floorSum).toBeGreaterThanOrEqual(36);
  });

  it('batch ladder adds the party column and still lands cleanly with collision-free floors', () => {
    const batchLadder = (col: string) =>
      css.match(new RegExp(`\\.ppc-lots-drawer--batch th\\.ppc-lots-col--${col}(?:\\s*,\\s*\\.ppc-lots-drawer--batch th\\.ppc-lots-col--[a-z]+)?\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    const cols: Array<[string, string, number]> = [
      ['stt', '3.1%', 32], ['party', '11.5%', 120], ['bill', '11%', 112],
      ['container', '8%', 80], ['plate', '7.5%', 76], ['date', '6.6%', 68],
      ['nang', '6.3%', 64], ['ha', '6.3%', 64], ['khac', '6.3%', 64],
      ['total', '6.6%', 68], ['paid', '5.7%', 58], ['remain', '6.6%', 68],
      ['ghichu', '10.9%', 108],
    ];
    let shareSum = 0;
    let floorSum = 0;
    for (const [col, share, floor] of cols) {
      const block = batchLadder(col);
      expect(block, `${col} keeps its % share`).toContain(`width: ${share}`);
      expect(block, `${col} keeps its px floor`).toContain(`min-width: ${floor}px`);
      shareSum += Number(share.slice(0, -1));
      floorSum += floor;
    }
    expect(shareSum).toBeCloseTo(96.4, 1);
    expect(floorSum + 36).toBe(1018);
    const table = css.match(/\.ppc-lots-drawer--batch table:not\(\.record-table\)\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(table).toContain('min-width: 1018px');
  });

  it('Ghi chú renders whole — wraps at spaces, never mid-token, no ellipsis, widest share', () => {
    const note = css.match(/\.ppc-lots-drawer td\.ppc-lots-note\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(note).toContain('white-space: normal');
    expect(note).toContain('word-break: keep-all');
    expect(note).not.toMatch(/text-overflow|nowrap/);
    const drawerSource = readFileSync(
      resolve(process.cwd(), 'src/pages/accounting/PhoiPhieuPartyLotsDrawer.tsx'), 'utf8');
    expect(drawerSource).toContain('className="ppc-lots-note"');
    expect(drawerSource.match(/ppc-lots-col--/g)?.length).toBeGreaterThanOrEqual(11);
  });
});
