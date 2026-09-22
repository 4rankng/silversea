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
});
