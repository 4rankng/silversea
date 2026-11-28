import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1288 (QA R32): the lot code broke mid-code ('339IVN014 / 9295') because
// the shared td law (overflow-wrap: anywhere) shreds single tokens. The lot
// span is atomic — the column EXPANDS to the code (auto-layout table), never
// the reverse. This pin holds the pair against a future sweep re-inheriting
// the anywhere law.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('SIL-1288 — the lot code is an atomic token', () => {
  const css = read('src/pages/accounting/CostReconciliationPage.css').replace(/\s+/g, ' ');

  it('pins the nowrap + overflow-wrap:normal atomic pair on the lot cell', () => {
    expect(css).toMatch(/\.cost-reconciliation-page__lot\s*\{\s*white-space:\s*nowrap;\s*overflow-wrap:\s*normal;/);
  });
});
