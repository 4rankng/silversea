import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260922_53 (TC-CCP-03): the tracker table must scroll horizontally
// (never clip the action column) and date/bill tokens must stay on one line.
// Rule-local CSS assertions per the no-truncation test idiom.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const css = read('src/pages/accounting/DepositRefundTrackerPage.css');
const tsx = read('src/pages/accounting/DepositRefundTrackerPage.tsx');
/** Declarations only — the sheet's prose documents which rules were deleted,
 *  and documentation must never satisfy (or trip) a pin about declarations. */
const decls = css.replace(/\/\*[\s\S]*?\*\//g, '');

const ruleFor = (selector: string): string => {
  const match = css.match(new RegExp(String.raw`${selector}\s*\{([^}]*)\}`));
  expect(match, `rule ${selector} present`).toBeTruthy();
  return match![1];
};

describe('deposit tracker table — the shared record-table base (recipe #1)', () => {
  // Card 20260922_53 pinned the page's PRIVATE scroll/label workarounds
  // (`.table-wrap` overflow override, 1220px min-width, `.bill`/`.date-cell`
  // nowrap, the 250px action column, the `deposit-status` pill). The redesign
  // retires every one of them: the table is the ONE shared base
  // (`record-table ops-table` in `.record-table-wrap`), which owns cell
  // padding, numeric alignment, token wrapping and the ≤1100px labelled
  // record-card band. The pins below therefore describe the mechanism that
  // replaced the workarounds — never re-pinned onto a rule that no longer
  // exists.
  it('imports and renders the shared base instead of a page-private skin', () => {
    expect(tsx).toContain("import '../../styles/record-table.css';");
    expect(tsx).toContain("import '../../styles/operational-table-typography.css';");
    expect(tsx).toContain('className="record-table-wrap"');
    expect(tsx).toContain('className="record-table ops-table"');
  });

  it('the page sheet keeps no table skin at all', () => {
    // The whole private skin: min-width, the `.table-wrap` overflow override,
    // the cell padding/alignment, the cell shapes and the action-column width.
    expect(decls).not.toMatch(/deposit-tracker-table/);
    expect(decls).not.toMatch(/\.table-wrap/);
    expect(decls).not.toMatch(/min-width:\s*1220px/);
    expect(decls).not.toMatch(/250px/);
    // The shared base owns the wrap, so the sheet declares white-space for
    // exactly ONE thing: the single-token cells (a dd/mm/yyyy date, a bill
    // number, the ordinal) that must not fracture mid-token (law §4). The
    // 2026-09-27 invoice-tracking regression was a nowrap rule with no such
    // reason — the check still catches one, because it must name this class.
    const whiteSpaceRules = [...decls.matchAll(/[^{}]*\{[^}]*white-space\s*:[^}]*\}/g)].map((m) => m[0].split('{')[0].trim());
    expect(whiteSpaceRules, 'only the documented token cells may set white-space').toEqual(['.deposit-col--token']);
  });

  it('every cell carries the data-label the card band prints, money aligned', () => {
    // 10 labelled facts + the action cell's empty label.
    expect(tsx.match(/data-label=/g)?.length).toBe(11);
    expect(tsx).toContain('<td data-label="Số tiền cược" className="num deposit-col--token">');
    expect(tsx).toContain('<td data-label="Ngày nộp CV" className="deposit-col--token">');
    expect(tsx).toContain('<td data-label="Ngày dự kiến hoàn cược" className="deposit-col--token">');
  });

  it('the action cell rides the shared action slot', () => {
    expect(tsx).toContain('<td data-label="" className="record-table__action">');
  });

  it('loading and empty are the shared primitives, never bespoke rows', () => {
    expect(tsx).toContain('<SkeletonTable');
    expect(tsx).toContain('<EmptyState');
    expect(tsx).toContain('context="wallet"');
    expect(tsx).not.toMatch(/Đang tải theo dõi hoàn cược/);
    expect(decls).not.toMatch(/loading|empty/i);
  });

  it('status renders through the shared StatusText — no page-local pill class', () => {
    expect(tsx).toContain("<StatusText variant={row.status === 'DA_HOAN_CUOC' ? 'success' : 'warning'}>");
    expect(decls).not.toMatch(/deposit-status/);
    expect(css.includes('999px')).toBe(false);
    // §1 bans a rounded background fill in a data cell; the shared primitive
    // keeps text + one dot, so the page owns no radius for a status at all.
    expect(decls).not.toMatch(/border-radius[^;]*status/);
  });

  it('overdue alert line renders danger ink and the dismiss control clears the §5 hit-area law', () => {
    expect(ruleFor('\\.deposit-tracker-warnings__item--danger')).toMatch(/color:\s*var\(--danger-text/);
    expect(ruleFor('\\.deposit-tracker-warnings__dismiss')).toMatch(/min-width:\s*24px/);
    expect(ruleFor('\\.deposit-tracker-warnings__dismiss')).toMatch(/min-height:\s*24px/);
    expect(css).toMatch(/pointer:\s*coarse/);
  });

  it('the verbatim alert line renders plain text — no decorative icons (§1)', () => {
    expect(tsx).toMatch(/kiểm tra check cược số lượng: <strong>/);
    expect(tsx).not.toMatch(/deposit-tracker-warnings__item"><CalendarClock/);
  });

  it('the summary strip is the shared SummaryRail, not a hand-rolled KPI tile', () => {
    expect(tsx).toContain('<SummaryRail');
    expect(tsx).toContain('ariaLabel="Tổng tiền cược"');
    expect(tsx).toContain("label: 'Tổng tiền cược (theo bộ lọc)'");
    expect(decls).not.toMatch(/deposit-tracker-totals/);
  });
});

// Card 20260927_152 (operator 2026-09-27: "try to keep filter section max 2
// rows only", "the width of control should relative to value it holds"): the
// page no longer owns the filter strip. `ListFilterBar` owns the layout and the
// shared sheet owns every control's width, so this sheet may declare NOTHING
// about a filter control. The row-packing pins that described the deleted
// `.deposit-tracker-filters` rules (content-sizing, the 168/149px date floors,
// the 240–280px select slot, the ≤900 full-width band) are replaced by the
// contract they were hiding — never re-pinned onto a rule that no longer
// exists.
const FILTER_SURFACE = /\.list-filter-bar|\.filter-bar|\.date-range-fields|\.ds-uui-select|\.filter-dropdown|\[data-input-wrapper\]|\[data-uui-control\]/;
const FILTER_LAYOUT_OR_WIDTH = /(?:^|;)\s*(?:display|flex|flex-wrap|flex-grow|grid|grid-template-columns|grid-column|align-items|justify-content|gap|width|min-width|max-width)\s*:/;

/** Every rule in the sheet whose selector names a filter surface. */
const filterRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, declarations]) => ({ selector: selector.trim(), declarations }))
  .filter((rule) => FILTER_SURFACE.test(rule.selector));

describe('deposit tracker filter strip (card 20260927_152)', () => {
  it('the page sheet declares no filter layout and no control width', () => {
    const offenders = filterRules
      .filter((rule) => FILTER_LAYOUT_OR_WIDTH.test(rule.declarations))
      .map((rule) => rule.selector);
    expect(offenders).toEqual([]);
  });

  it('no page-owned filter markup or grid survives', () => {
    expect(css).not.toMatch(/deposit-tracker-filters/);
    expect(css).not.toMatch(/grid-template-columns|grid-column\s*:/);
    expect(tsx).not.toContain('className="filter-bar');
    expect(tsx).not.toContain('deposit-tracker-filters__pair');
  });

  it('renders the shared strip — date pair, the status criterion, the two actions', () => {
    expect(tsx).toContain('<ListFilterBar');
    expect(tsx).toContain('<DateRangeFields');
    expect(tsx).toContain('<FilterDropdown');
    // Behaviour preserved: the page's own two actions stay reachable and the
    // status criterion keeps its accessible name.
    expect(tsx).toContain('>Lọc</Btn>');
    expect(tsx).toContain('>Thêm dòng</Btn>');
    expect(tsx).toContain('ariaLabel="Trạng thái hoàn cược"');
  });

  it('the filter surface stays flat — no shadow, gradient or 3D (§3)', () => {
    expect(css).not.toMatch(/box-shadow|gradient|perspective|rotate3d/);
  });
});
