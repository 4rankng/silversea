// SIL-1220 (id 1402) — /shipments 1440px: the plan table's sort header
// 'PHÂN LOẠI & HÃNG TÀU' clipped to 'PHÂN LOẠI & HÃNG T' (the column ran
// ~141px, the one-line label 167px, no ellipsis, no wrap). The shared sort
// label span carries the FB-063 one-line law directly, which outranked the
// page's th/button wrap law by inheritance; this page re-targets the span
// itself with the ledger's proven 2-line header law (wrap at spaces, keep
// tokens whole, balance the lines) — the ⇅ icon stays a flex item of the
// span (SIL-1213) so it can never orphan onto a line of its own.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SIL-1220 — plan-table sort headers wrap at spaces instead of clipping', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('the span-level wrap law rides every plan-table sort header', () => {
    const rule = page.match(/\.cus-dashboard-table thead \.table-sort-button__label \{([^}]*)\}/)?.[1] ?? '';
    expect(rule, 'span re-target exists').toBeTruthy();
    expect(rule).toMatch(/white-space:\s*normal;/);
    expect(rule).toMatch(/word-break:\s*keep-all;/);
    expect(rule).toMatch(/text-wrap:\s*balance;/);
  });

  it('the shared one-line law itself stays untouched (per-surface re-target only)', () => {
    const shared = readFileSync(resolve(process.cwd(), 'src/styles/table-sort.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(shared).toMatch(/\.table-sort-button__label \{[^}]*white-space: nowrap;/);
    expect(shared).toMatch(/\.table-sort-button \{[^}]*white-space: nowrap;/);
  });
});
