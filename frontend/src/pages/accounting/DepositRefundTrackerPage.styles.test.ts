import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260922_53 (TC-CCP-03): the tracker table must scroll horizontally
// (never clip the action column). Dates remain atomic; genuinely long Bill
// references use the shared complete-wrapping anatomy (QA-AUDIT-UI-88).
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
  // (`record-table ops-table` in `.record-table-wrap`), with the explicit shared
  // wide-text scroll adoption for customer/note/reference columns. It owns cell
  // padding, numeric alignment, token wrapping and the ≤1100px labelled
  // record-card band. The pins below therefore describe the mechanism that
  // replaced the workarounds — never re-pinned onto a rule that no longer
  // exists.
  it('imports and renders the shared base instead of a page-private skin', () => {
    expect(tsx).toContain("import '../../styles/record-table.css';");
    expect(tsx).toContain("import '../../styles/operational-table-typography.css';");
    expect(tsx).toContain('className="record-table-wrap record-table-wrap--scroll"');
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
    // exactly the documented cases (SIL-1172 retest R5): the date/ordinal
    // token cells; the recovery annotation wrapping at WORD boundaries inside
    // its money token cell (the nowrap sentence inflated the money column's
    // min-content ~200px); and the Trạng thái label relaxing the StatusText
    // primitive's inline nowrap to word-boundary wraps so the twelve-column
    // run fits the 1129px canvas. Long Bill references wrap completely
    // through the shared reference owner (QA-AUDIT-UI-88). The 2026-09-27
    // invoice-tracking regression was a nowrap rule with no such reason —
    // the check still catches one, because it must name these selectors.
    const whiteSpaceRules = [...decls.matchAll(/[^{}]*\{[^}]*white-space\s*:[^}]*\}/g)].map((m) => m[0].split('{')[0].trim());
    expect(whiteSpaceRules, 'only the documented token cells may set white-space').toEqual([
      '.deposit-col--token',
      ".deposit-tracker-page .record-table td[data-label='Trạng thái'] > span",
      '.deposit-col--recovery',
    ]);
  });

  it('every cell carries the data-label the card band prints, money aligned', () => {
    // 11 labelled facts (SIL-764 added Phân loại) + the action cell's named label.
    expect(tsx.match(/data-label=/g)?.length).toBe(12);
    expect(tsx).toContain('<td data-label="Phân loại">');
    expect(tsx).toContain('<td data-label="Số tiền cược" className="num deposit-col--token">');
    expect(tsx).toContain('<td data-label="Ngày nộp CV" className="deposit-col--token">');
    expect(tsx).toContain('<td data-label="Ngày dự kiến hoàn cược" className="deposit-col--token">');
  });

  it('the action cell rides the shared action slot', () => {
    // AUI-03 (audit 2026-11-27) + SIL-1172 (QA wave a8f059c0): the action
    // column is a real named column — the header PRINTS "Thao tác" (the
    // sr-only label read as an empty column title on the board) and every
    // cell carries the data-label. SIL-1172 retest R5 (owner DOM, 1440,
    // canvas 1129px): the side-by-side run (150 + 6 + 109 = 265px) crushed
    // the column or hung past the right edge — the buttons STACK on desktop
    // (each on its own full-width line inside a 164px floor) and the cell
    // joins the dense 6px gutter.
    expect(tsx).toContain('<td data-label="Thao tác" className="record-table__action">');
    expect(tsx).toContain('<th>Thao tác</th>');
    expect(css).toMatch(/\.deposit-tracker-page \.record-table th:last-child,\s*\.deposit-tracker-page \.record-table td:last-child\s*\{\s*min-width:\s*164px;\s*\}/);
    expect(css).toMatch(/@container \(min-width:\s*1101px\)\s*\{\s*\.deposit-tracker-page \.record-table td\.record-table__action > \.btn\s*\{\s*display:\s*flex;\s*width:\s*100%;\s*\}/);
    expect(css).toMatch(/\.deposit-tracker-page \.record-table tbody td\.record-table__action\s*\{\s*padding-inline:\s*6px;\s*\}/);
    const shared = readFileSync(resolve(process.cwd(), 'src/styles/record-table.css'), 'utf8');
    expect(shared).toMatch(/@container \(max-width:\s*1100px\)[\s\S]*?\.record-table tbody td\.record-table__action\s*\{[^}]*display:\s*flex;[^}]*gap:\s*8px;[^}]*padding:\s*8px 12px;/);
    expect(shared).toMatch(/\.record-table tbody td\.record-table__action:empty\s*\{\s*display:\s*none;\s*\}/);
  });

  it('the shared wide-text floor leaves the two-button action run on screen (SIL-816 UI-03)', () => {
    // Measured at the 1440 workboard (2026-11-13 drive): the action run
    // ("Ngày CV / số tiền" 150px + "Đã hoàn cược" 109px) hung past the
    // viewport edge while KHÁCH HÀNG + GHI CHÚ each carried the shared 18ch
    // human-text floor. The page sheet owns no table skin, so the fit budget
    // lives in the shared floor — a re-widening silently re-breaks the run.
    const shared = readFileSync(resolve(process.cwd(), 'src/styles/record-table.css'), 'utf8');
    expect(shared).toMatch(/\.record-table tbody td\.record-table__text\s*\{\s*min-width:\s*12ch;/);
  });

  it('SIL-832: dense-board gutters hold the action run inside the 1440px canvas', () => {
    // Regression (14/11 build 237af351): the SIL-819 wrap law re-widened the
    // Phân loại/Hãng tàu min-content and the 12-column run (~1169px) overtook
    // the 1144px canvas — "Ngày CV / số tiền" clipped at x=1441 on every row.
    // The SIL-816 UI-02 gutter trade (thead 8px / td 6px, action cell
    // excluded) recovers ~130px without touching the buttons, the 12ch
    // floors, or the SIL-819 wrap law.
    expect(decls).toMatch(/\.deposit-tracker-page \.record-table thead th\s*\{\s*padding-inline:\s*8px\s*;?\s*\}/);
    expect(decls).toMatch(/\.deposit-tracker-page \.record-table tbody td:not\(\.record-table__action\)\s*\{\s*padding-inline:\s*6px\s*;?\s*\}/);
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

  it('SIL-1298 — the Trạng thái floor holds the label at one line, never the 3-line stack', () => {
    // The SIL-1172 word-wrap law collapsed the column to its longest word
    // (63px local / 44px staging) and 'Chưa hoàn cược' stacked
    // "Chưa / hoàn / cược". The 78px floor + the short labels ('Chưa hoàn'/
    // 'Đã hoàn' — the expected's "nhãn ngắn hơn" branch) read on ONE line;
    // the full name needed 92px and broke the 1129px canvas law.
    expect(css).toMatch(/td\[data-label='Trạng thái'\]\s*\{[^}]*min-width:\s*78px/);
  });

  it('overdue alert line renders danger ink and the dismiss control clears the §5 hit-area law', () => {
    expect(ruleFor('\\.deposit-tracker-warnings__item--danger')).toMatch(/color:\s*var\(--danger-text/);
    expect(ruleFor('\\.deposit-tracker-warnings__dismiss')).toMatch(/min-width:\s*24px/);
    expect(ruleFor('\\.deposit-tracker-warnings__dismiss')).toMatch(/min-height:\s*24px/);
    expect(css).toMatch(/pointer:\s*coarse/);
  });

  it('the verbatim alert line renders plain text — no decorative icons (§1)', () => {
    // ticket 18/11 Task 3.4 supersedes the §1 alert lead literal
    // ("Kiểm tra check cược số lượng" → "Cảnh báo quá hạn nộp công văn hoàn
    // cược"); the §1 law itself stands — plain text + <strong>, no icon.
    expect(tsx).toMatch(/Cảnh báo quá hạn nộp công văn hoàn cược: <strong>/);
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
// page no longer owns the filter strip. `FilterBar` owns the layout and the
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
    expect(tsx).toContain('<FilterBar');
    expect(tsx).toContain('<DateRangeFields');
    expect(tsx).toContain('<FilterDropdown');
    // Behaviour preserved: the page's own two actions stay reachable and the
    // status criterion keeps its accessible name.
    expect(tsx).toContain('>Lọc</Btn>');
    expect(tsx).toContain('>Thêm cược</Btn>');
    expect(tsx).toContain('ariaLabel="Trạng thái hoàn cược"');
  });

  it('the filter surface stays flat — no shadow, gradient or 3D (§3)', () => {
    expect(css).not.toMatch(/box-shadow|gradient|perspective|rotate3d/);
  });
});
