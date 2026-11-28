import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-1254 (id 1531) — the settlement band (lớp tổng) money cells must be
 * right-aligned. The band base rule (`.debit-settlement-band th, td` —
 * specificity 0-1-1) out-ranked `.debit-settlement-band__money` (0-1-0), so
 * `text-align: left` won and the money cells + the "Tổng phải thu khách"
 * header sat at their column's left edge — past the fold at 1440 once the
 * band stretched with the board's min-content ("TỔNG PHẢI THU KHÁCH" cut at
 * the screen edge). The money rule must out-specify the base rule.
 */
const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8');

describe('SIL-1254 — settlement band money alignment', () => {
  it('the money rule out-specifies the band th/td base rule (right-align actually wins)', () => {
    expect(css).toMatch(
      /\.debit-settlement-band th\.debit-settlement-band__money,\s*\.debit-settlement-band td\.debit-settlement-band__money \{[^}]*text-align: right;/,
    );
  });
});
