import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260925_47 (audit, header-wrap band): table headers read 1 line or an
// even 2-line wrap. Two levers:
//   1. global zero-specificity `text-wrap: balance` on `thead th` so every
//      wrapped header re-distributes evenly (one-line headers untouched);
//   2. per-table track shares that hold each header's longest word.
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('table headers wrap evenly (card 20260925_47)', () => {
  it('global thead layer balances wrapped headers', () => {
    const css = read('src/styles/operational-table-typography.css');
    expect(css).toMatch(/:where\(table thead th\)\s*\{[^}]*text-wrap:\s*balance/);
  });

  it('operational tables keep their nowrap + keep-all header discipline', () => {
    const css = read('src/styles/operational-table-typography.css');
    expect(css).toMatch(/:where\(table thead th\)\s*\{[^}]*font-size:\s*var\(--ops-table-header-size\)/);
  });
});
