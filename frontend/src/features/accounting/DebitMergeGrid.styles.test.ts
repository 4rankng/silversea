// SIL-1269 (id 1551) — nhãn 'Ghép cước cùng Bill …' chồng lên cột CƯỚC: the
// shared .debit-merge-cell__line nowrap let the THÔNG SỐ label lines run past
// their hug-and-wrap cell and paint over the money beside them. Inside thongSo
// the stack fills the cell and its label lines wrap in place; every other
// __line user keeps the token nowrap law. These pins guard that split.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim().replace(/\s+/g, ' '),
  body: m[2],
}));

describe('DebitMergeGrid THÔNG SỐ label containment — SIL-1269', () => {
  it('label lines wrap inside the thongSo cell instead of painting over CƯỚC', () => {
    const line = rules.find((r) => r.selector === ".debit-merge__table td[data-col='thongSo'] .debit-merge-cell__line");
    expect(line?.body).toMatch(/white-space:\s*normal/);
    expect(line?.body).toMatch(/overflow-wrap:\s*break-word/);
  });

  it('the label stack fills the cell so its lines can never run past the column', () => {
    const stack = rules.find((r) => r.selector === ".debit-merge__table td[data-col='thongSo'] .debit-merge-cell--stack");
    expect(stack?.body).toMatch(/display:\s*flex/);
  });

  it('the shared token nowrap law survives outside thongSo', () => {
    const base = rules.find((r) => (
      /(^|,)\s*\.debit-merge-cell__line\s*(,|$)/.test(r.selector) && !r.selector.includes('thongSo')
    ));
    expect(base?.body).toMatch(/white-space:\s*nowrap/);
  });
});
