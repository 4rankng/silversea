import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The record-table card band keys on the CONTAINER width, so a narrow-column
// table whose column set actually fits (3-5 column ledgers) misclassifies as
// a phone card band on desktop. The `--table` adoption is the primitive's
// documented escape: table geometry returns from tablet up (phones keep the
// card band), outranking every band rule. This pin holds the contract: the
// modifier restores the table display set, kills the inline label eyebrow,
// and stays scoped to the opt-in wrap.
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const css = read('src/styles/record-table.css').replace(/\s+/g, ' ');

function ruleBody(selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = css.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

describe('record-table --table adoption (record-table-wrap--table)', () => {
  it('is gated to tablet-and-wider viewports so phones keep the card band', () => {
    const media = css.match(/@media \(min-width: 768px\)\s*\{[\s\S]*?\.record-table-wrap--table/);
    expect(media).toBeTruthy();
  });

  it('restores the table display set for the opt-in wrap', () => {
    expect(ruleBody('.record-table-wrap--table .record-table')).toMatch(/display:\s*table/);
    expect(ruleBody('.record-table-wrap--table .record-table thead')).toMatch(/display:\s*table-header-group/);
    expect(ruleBody('.record-table-wrap--table .record-table tbody')).toMatch(/display:\s*table-row-group/);
    expect(ruleBody('.record-table-wrap--table .record-table tbody tr')).toMatch(/display:\s*table-row/);
    expect(ruleBody('.record-table-wrap--table .record-table tbody th, .record-table-wrap--table .record-table tbody td'))
      .toMatch(/display:\s*table-cell/);
  });

  it('drops the card band label eyebrow inside table mode', () => {
    expect(ruleBody('.record-table-wrap--table .record-table tbody td::before')).toMatch(/content:\s*none/);
  });
});
