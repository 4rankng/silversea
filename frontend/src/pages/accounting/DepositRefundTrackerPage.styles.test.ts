import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260922_53 (TC-CCP-03): the tracker table must scroll horizontally
// (never clip the action column) and date/bill tokens must stay on one line.
// Rule-local CSS assertions per the no-truncation test idiom.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const css = read('src/pages/accounting/DepositRefundTrackerPage.css');
const tsx = read('src/pages/accounting/DepositRefundTrackerPage.tsx');

const ruleFor = (selector: string): string => {
  const match = css.match(new RegExp(String.raw`${selector}\s*\{([^}]*)\}`));
  expect(match, `rule ${selector} present`).toBeTruthy();
  return match![1];
};

describe('deposit tracker table — scroll + token integrity (card 20260922_53)', () => {
  it('wrapper scrolls horizontally instead of clipping', () => {
    expect(ruleFor('.deposit-tracker-page \\.table-wrap')).toMatch(/overflow-x:\s*auto/);
  });

  it('date and bill tokens carry white-space: nowrap', () => {
    expect(ruleFor('\\.deposit-tracker-table \\.bill')).toMatch(/white-space:\s*nowrap/);
    expect(ruleFor('\\.deposit-tracker-table \\.date-cell')).toMatch(/white-space:\s*nowrap/);
  });

  it('actions column keeps nowrap and a safe right padding', () => {
    expect(ruleFor('\\.deposit-tracker-table \\.actions')).toMatch(/white-space:\s*nowrap/);
    expect(ruleFor('\\.deposit-tracker-table \\.actions')).toMatch(/padding-right:\s*14px/);
  });

  it('the three date cells carry the date-cell class in the TSX', () => {
    expect(tsx.match(/className="date-cell"/g)?.length).toBe(3);
  });

  it('status chip obeys the law §1 pill ban (no stadium radius)', () => {
    expect(css.includes('999px')).toBe(false);
    expect(ruleFor('.deposit-status')).toMatch(/border-radius:\s*8px/);
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
