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

// QA 28/11 T13 — the band clipped 'TỔNG PHẢI…' headers and the right money
// columns at its edge with no scrollbar and no affordance. The band adopts the
// shared scroll-hint lane (styles/scroll-hint.css, the
// AccountingDebitClosePage anatomy): the section is the presentation-only
// host, the lane div is the ONE scroll container (overflow + the 240px cap
// moved off the host), so the cut columns scroll into reach and the fade +
// 'Kéo ngang' chip announce the cut edge only while the lane overflows.
describe('QA 28/11 T13 — settlement band scroll-hint lane', () => {
  const band = readFileSync(resolve(process.cwd(), 'src/features/shipments/debit/DebitLotSettlementSummary.tsx'), 'utf8');

  it('the band section is the scroll-hint host and the lane div is its lane', () => {
    expect(band).toMatch(/className="debit-settlement-band scroll-hint"/);
    expect(band).toMatch(/className="debit-settlement-band__lane scroll-hint__lane"/);
  });

  it('the host carries no overflow; the lane owns the scroll box and the 240px cap', () => {
    const hostBlock = css.match(/\.debit-settlement-band\s*\{[^}]*\}/)?.[0] ?? '';
    expect(hostBlock).not.toMatch(/overflow/);
    expect(hostBlock).toMatch(/min-width:\s*0/);
    const laneBlock = css.match(/\.debit-settlement-band__lane\s*\{[^}]*\}/)?.[0] ?? '';
    expect(laneBlock).toMatch(/overflow:\s*auto/);
    expect(laneBlock).toMatch(/max-height:\s*240px/);
  });
});
