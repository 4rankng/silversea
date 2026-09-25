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

describe('deposit tracker filter row-packing (card 20260924_13, law §5)', () => {
  it('bar children are content-sized — no control stretches to a full row', () => {
    expect(ruleFor('\\.deposit-tracker-filters > \\*')).toMatch(/flex:\s*0 1 auto/);
    expect(ruleFor('\\.deposit-tracker-filters > \\.btn')).toMatch(/flex:\s*0 0 auto/);
  });

  it('the date pair shares fixed compact widths (ListFilterBar parity: 168px, 149 floor)', () => {
    expect(ruleFor('\\.deposit-tracker-filters \\[data-input-wrapper\\]')).toMatch(/width:\s*168px/);
    expect(ruleFor('\\.deposit-tracker-filters \\[data-input-wrapper\\]')).toMatch(/min-width:\s*149px/);
  });

  it('Trạng thái sits in a 240–280px slot — auto width, never width:100%', () => {
    const select = ruleFor('\\.deposit-tracker-filters \\.ds-uui-select');
    expect(select).toMatch(/width:\s*auto/);
    expect(select).toMatch(/min-width:\s*240px/);
    expect(select).toMatch(/max-width:\s*280px/);
    expect(select).not.toMatch(/width:\s*100%/);
  });

  it('mobile ≤900 — Từ/Đến pair on one row, Trạng thái full row, action buttons row (card 20260925_1 short-value pairing)', () => {
    const mobile = css.match(/@media \(max-width: 900px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    // The date pair rides the pair wrapper: 2-column grid, not a column stack.
    expect(mobile).toMatch(/\.deposit-tracker-filters__pair\s*\{[^}]*display:\s*grid/);
    expect(mobile).toMatch(/\.deposit-tracker-filters__pair\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    // Mark-up: date pair wrapper carries Từ ngày + Đến ngày.
    expect(tsx).toMatch(/className="deposit-tracker-filters__pair"[\s\S]*?Từ ngày[\s\S]*?Đến ngày/);
    // Select + buttons keep their full row under the pair (the direct-child
    // selector above covers both `.ds-uui-select` and `.btn` siblings).
    expect(mobile).toMatch(/\.deposit-tracker-filters \.ds-uui-select/);
    // One control height per context — phones rise to 44px touch floor.
    expect(mobile).toMatch(/min-height:\s*var\(--filter-control-h\)/);
    // The standing flat law carries over: no shadow, no gradient.
    expect(mobile).not.toMatch(/box-shadow|gradient/);
  });

  it('the filter bar stays flat — no shadow or 3D surface (§3)', () => {
    expect(ruleFor('\\.deposit-tracker-filters')).not.toMatch(/box-shadow|gradient/);
  });
});
