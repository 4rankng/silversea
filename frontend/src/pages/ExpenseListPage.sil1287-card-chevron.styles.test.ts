import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1287 (QA R31): every mobile card ended with a full-width empty band
// holding only the detail chevron. The band rule (15/09) hid the cell, but a
// dead specificity left the chevron row visible on staging. The contract now:
// the chevron is a compact detail affordance pinned to the card's top-right
// corner — never its own band, never gone.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('SIL-1287 — card-mode chevron is a corner affordance, not a band', () => {
  const css = read('src/pages/ExpenseListRecordTable.css').replace(/\s+/g, ' ');

  it('pins the card band row as the corner positioning context', () => {
    expect(css).toMatch(/\.expense-record-table tbody tr:not\(:has\(td\[colspan\]\)\)\s*\{\s*position:\s*relative/);
  });

  it('pins the action cell to the card corner instead of reserving a row', () => {
    expect(css).toMatch(/\.expense-record-table tbody tr td\.expense-record-table__action\s*\{\s*position:\s*absolute/);
    // The old dead rule must not come back as the fix.
    expect(css).not.toMatch(/\.expense-record-table td\.expense-record-table__action\s*\{\s*display:\s*none/);
  });

  it('keeps the corner affordance at a ≥24px tap target', () => {
    expect(css).toMatch(/min-width:\s*(2[4-9]|[3-9]\d)px/);
    expect(css).toMatch(/min-height:\s*(2[4-9]|[3-9]\d)px/);
  });
});
