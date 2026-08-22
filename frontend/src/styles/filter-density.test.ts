import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('global filter density contract', () => {
  it('keeps desktop filters compact and restores touch targets below 900px', () => {
    const tokens = read('src/styles/tokens.css');

    expect(tokens).toContain('--filter-control-h: var(--control-compact-h);');
    expect(tokens).toContain('--filter-control-font-size: var(--control-compact-font-size);');
    expect(tokens).toMatch(/@media \(max-width: 767px\)[\s\S]*--filter-control-h: var\(--control-touch-h\);/);
  });

  it('applies the shared contract to common and accounting filters', () => {
    const filterBar = read('src/components/FilterBar.css');
    const accounting = read('src/pages/AccountingWorkspacePage.css');
    const expense = read('src/pages/ExpenseListPage.css');
    const debt = read('src/pages/DebtListPage.css');
    const tripList = read('src/pages/trip-list/filters.css');

    for (const stylesheet of [filterBar, accounting, expense, debt, tripList]) {
      expect(stylesheet).toContain('var(--filter-control-h)');
      expect(stylesheet).toContain('var(--filter-control-font-size)');
    }
  });
});
