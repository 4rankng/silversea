import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/DebtListPage.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/pages/DebtListPage.tsx'), 'utf8');
// Selector assertions read the RULES, not the prose: the sheet's comments name
// the deleted selectors on purpose (the record of what left and why).
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('debt customer-list filter strip (card 20260927_152)', () => {
  it('renders the shared bar, with the status chip as the only criterion it owns', () => {
    expect(tsx).toContain('<FilterBar');
    expect(tsx).toContain('quickFilters');
    expect(tsx).toContain("placeholder: 'Tìm khách hàng...'");
    expect(tsx).toContain("ariaLabel: 'Tìm công nợ theo khách hàng'");
    // No secondary criterion exists on this surface, so no `Bộ lọc` trigger.
    expect(tsx).not.toContain('<FilterDropdown');
  });

  it('declares no filter layout and no control width of its own', () => {
    // The page-local strip (`.debt-filter-bar` chrome, `.debt-filter-chips` flex
    // row, `.debt-filter-search` at `flex: 1 1 320px` with its own 180px floor
    // and a ≤640px `width: 100%`) is exactly how the operator's "some control
    // the value very short but why the fuck it does take full row" regression
    // returned twice: a page rule outranks the shared band. The bar owns both.
    expect(rules).not.toMatch(/\.debt-filter/);
    expect(rules).not.toMatch(/flex\s*:\s*1 1/);
    expect(rules).not.toMatch(/min-width\s*:\s*180px/);
    expect(rules).not.toMatch(/order\s*:\s*99/);
  });

  it('keeps the data card flat — the filter toolbar is the bar\'s own card, not a second surface', () => {
    expect(rules).toMatch(
      /\.debt-data-card\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/,
    );
  });
});
