// SIL-1249 (1366×768, 5 container) — the missing-field hint beside the
// "Bắt buộc" chip is a ONE-LINE strip riding the topline row: the wrapped
// 4–6 line list used to push the container table down so container row 1 ran
// under the sticky action bar (TRỌNG LƯỢNG cắt, THỂ TÍCH bị che). Contract
// pins: single line + horizontal scroll for the full list (NO TRUNCATE —
// never an ellipsis), the title attribute carries the full list verbatim,
// and the strip flexes inline so the topline stays ONE row at any container
// count (a complete container row always sits above the action bar).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/clerk/ClerkShipmentCreatePage.css'), 'utf8');
const toplineSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/create/ShipmentCreateTopline.tsx'), 'utf8');

function missingBlock(): string {
  const match = css.match(/\.csc-topline__missing\s*\{[^}]*\}/);
  expect(match).toBeTruthy();
  return match![0];
}

describe('SIL-1249 — missing-field hint strip (one line, h-scroll, no truncate)', () => {
  it('renders as a single line with horizontal scroll — never wrapped, never ellipsized', () => {
    const block = missingBlock();
    expect(block).toMatch(/white-space:\s*nowrap/);
    expect(block).toMatch(/overflow-x:\s*auto/);
    // NO TRUNCATE: the full list is scroll-reachable — no ellipsis anywhere.
    expect(block).not.toMatch(/text-overflow/);
    expect(css).not.toMatch(/csc-topline__missing[^}]*text-overflow/);
  });

  it('flexes inline so the topline keeps one row at any container count', () => {
    const block = missingBlock();
    expect(block).toMatch(/flex:\s*1 1 /);
    expect(block).toMatch(/min-width:\s*0/);
  });

  it('the title attribute carries the full missing-field list verbatim', () => {
    expect(toplineSource).toMatch(/title=\{`Còn thiếu: \$\{missingLabels\.join\(', '\)\}`\}/);
  });
});
