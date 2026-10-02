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

describe('phôi phiếu board cell discipline (card 20260923_8 group B)', () => {
  it('atomic cells never fracture — date column and chi hộ/tiền đường value tokens pin nowrap (design law §4)', () => {
    expect(css).toMatch(/\.ppc-board td\.ppc-col--date\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.ppc-board \.ppc-value\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('the approved workflow matrix grows to honest column minima at every width', () => {
    expect(css).not.toMatch(/ppc-col--select/);
    expect(css).toMatch(/\.ppc-board\s*\{[^}]*table-layout:\s*auto/);
    expect(css).not.toMatch(/table-layout:\s*fixed|width:\s*\d+%/);
    for (const column of ['lich-trinh', 'xe', 'customer-route', 'thongso', 'diadiem',
      'chiho', 'money', 'status', 'date', 'ghichu', 'ghichu-ops']) {
      const budget = css.match(new RegExp(`\\.ppc-board \\.ppc-col--${column}(?:\\s*,[^{}]+)?\\s*\\{[^}]*min-width:\\s*(\\d+)px`));
      expect(budget, `${column} has a real content floor`).not.toBeNull();
      expect(Number(budget?.[1])).toBeGreaterThanOrEqual(104);
    }
    expect(css).toMatch(/\.ppc-board \.ppc-identity\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.ppc-board-wrap\s*\{[^}]*overflow-x:\s*auto/);
    expect(source).toContain('className="ppc-board-wrap ledger-desktop" role="region"');
    expect(source).toContain('className="ppc-board-hint ledger-desktop"');
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
    expect(css).not.toMatch(/grid-template-columns|grid-column\s*:/);
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
    expect(bar).toContain('onClick={() => void issueVoucher()}');
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
