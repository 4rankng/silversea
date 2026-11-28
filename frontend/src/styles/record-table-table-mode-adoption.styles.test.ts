import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 28/11 desktop audit (S3 card reflow): /users, /suppliers, /hr/roster and
// /penalties collapsed into the record-table card band whenever the pinned
// sidebar pushed their record-table-wrap below the 1100px container-query
// floor, even though their 4-8 column tables fit the narrower canvas. Each
// page now adopts the documented `record-table-wrap--table` opt-in so real
// table geometry returns from tablet up (the card band stays below 768px).
// This pin holds every adoption so a refactor cannot silently drop one.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('record-table table-mode adoption per page', () => {
  it.each([
    ['src/features/users/components/UserTable.tsx'],
    ['src/pages/HrRosterPage.tsx'],
    ['src/features/penalties/components/PenaltyTable.tsx'],
    ['src/pages/SupplierListPage.tsx'],
  ])('declares record-table-wrap--table on %s', (file) => {
    expect(read(file)).toContain('record-table-wrap record-table-wrap--table');
  });

  it('keeps the shell content column shrinkable when the sidebar is pinned open', () => {
    const shell = read('src/components/layout/app-shell.css')
      .replace(/\s+/g, ' ');
    // The main content container must not impose an intrinsic min-width
    // floor: flex:1 + min-width:0 let the grid's minmax(0,1fr) track shrink
    // it (and the record-table-wrap container queries with it).
    expect(shell).toMatch(/\.app-body, \.content \{ flex: 1;[^}]*min-width: 0;/);
  });
});
