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

  it('atomic columns are budgeted explicitly — the fixed-layout board no longer equal-shares every column', () => {
    // Card 20260929_207: the 3% selection track is GONE with the checkbox
    // column (PM directive 2026-09-29). This contract now pins both halves of
    // that: no orphaned select track, and the freed share landing on the
    // content columns that were being crushed to three ragged lines.
    expect(css).not.toMatch(/ppc-col--select/);
    // Card 20260925_47: shares rebalanced so unbreakable header tokens hold
    // their longest word at ≤2 even lines (fixed layout honours width only).
    // 2026-09-29: rebalanced AGAIN, because the two IDENTITY tracks were the
    // starved ones — measured at 1144px, 'Lịch trình' held 57px against the
    // 149px its trip code + bill need and 'Thông tin xe' 57px against 206px,
    // so a code the operator reads character by character broke after every
    // hyphen. The wrapping text columns pay for the two identity tracks now.
    // Shares are RELATIVE weights (fixed layout scales them to the table's
    // 100%), so the pin is the shape, not an absolute total.
    expect(css).toMatch(/\.ppc-board th\.ppc-col--lich-trinh\s*\{[^}]*width:\s*12%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--xe\s*\{[^}]*width:\s*10%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--customer-route\s*\{[^}]*width:\s*9%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--thongso\s*\{[^}]*width:\s*8%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--diadiem\s*\{[^}]*width:\s*9%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--chiho\s*\{[^}]*width:\s*11%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--money\s*\{[^}]*width:\s*10%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--status\s*\{[^}]*width:\s*8%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--date\s*\{[^}]*width:\s*9%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--ghichu\s*\{[^}]*width:\s*7%/);
    // Card 20260928_162 — the not-charged reason column takes the note-track
    // weight; the budget stays explicit now that a 12th column exists.
    expect(css).toMatch(/\.ppc-board th\.ppc-col--ghichu-ops\s*\{[^}]*width:\s*7%/);
    const shares = new Map(
      [...css.matchAll(/\.ppc-board th\s*\.ppc-col--([\w-]+)\s*\{[^}]*width:\s*([\d.]+)%/g)]
        .map((match) => [match[1], Number(match[2])]),
    );
    expect([...shares.keys()], 'every track is declared').toHaveLength(11);
    // The identity tracks carry the widest weight and the note tracks the
    // narrowest — inverting either is what starved the board.
    expect(shares.get('lich-trinh')!).toBeGreaterThan(shares.get('customer-route')!);
    expect(shares.get('xe')!).toBeGreaterThanOrEqual(shares.get('ghichu')! * 1.4);
  });

  // Card 20260929_207: the picked row is drawn WITHOUT a shadow — the flat
  // sheet law forbids one, and the ratchet below reads any shadow in this
  // file as a violation. The left rule is a border on the row's first cell.
  it('the selected row is marked by a border, never a shadow (design law §3)', () => {
    expect(css).toMatch(/tr\[data-selected="true"\][^{]*td:first-child\s*\{[^}]*border-left:\s*3px solid var\(--accent\)/);
  });

  it('chi hộ affordance is an icon-only button with a ≥24px hit area (09-18 icon-action ruling, §5)', () => {
    expect(css).toMatch(/\.ppc-board \.ppc-icon-btn\s*\{[^}]*width:\s*26px/);
    expect(css).toMatch(/\.ppc-board \.ppc-icon-btn\s*\{[^}]*height:\s*26px/);
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
// page no longer owns the filter strip. `ListFilterBar` owns the layout and the
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
    const bar = source.match(/<ListFilterBar([\s\S]*?)<\/ListFilterBar>/)?.[1] ?? '';
    expect(bar).toContain("placeholder: 'Mã chuyến, container, khách'");
    expect(bar).toContain("ariaLabel: 'Tìm kiếm'");
    expect(bar).toContain('<DateRangeFields');
    // ONE from/to implementation — the page no longer mounts bare date fields.
    expect(source).not.toContain('<BufferedUuiDateInput');
  });

  it('the four secondary criteria live inside the dropdown, which comes last', () => {
    const bar = source.match(/<ListFilterBar([\s\S]*?)<\/ListFilterBar>/)?.[1] ?? '';
    const dropdown = bar.match(/<FilterDropdown([\s\S]*?)<\/FilterDropdown>/)?.[1] ?? '';
    for (const label of ['Trạng thái', 'Sắp xếp', 'Loại phiếu', 'Số tài khoản quỹ (STK)']) {
      expect(dropdown).toContain(`label="${label}"`);
    }
    expect(dropdown).toContain('onReset={resetSecondary}');
    expect(bar.indexOf('<DateRangeFields')).toBeLessThan(bar.indexOf('<FilterDropdown'));
  });

  it('the Lập phiếu action rides the bar action slot — the page owns no filter row', () => {
    const bar = source.match(/<ListFilterBar([\s\S]*?)<\/ListFilterBar>/)?.[1] ?? '';
    const actionsIndex = bar.indexOf('actions={(');
    expect(actionsIndex).toBeGreaterThan(-1);
    expect(actionsIndex).toBeLessThan(bar.indexOf('<DateRangeFields'));
    expect(bar).toContain('onClick={() => void issueVoucher()}');
    expect(bar).toContain('{voucherLabel}');
  });

  it('flat sheet — no shadow, gradient, or 3D anywhere (design law §3)', () => {
    expect(css).not.toMatch(/box-shadow|gradient|perspective|rotate3d/);
  });
});
