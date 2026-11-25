import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

// SIL-993 — phone card band (/shipments, 390/360px): the row's eyebrow label
// and the schedule status are ONE fact each and must read whole.
//
// Measured at 390px before the fix: the "Chứng từ" cell rendered
//   line 1  CHỨNG
//   line 2  TỪ MSCU851REPRO002-
//   line 3  UIR4
// because the cell's `overflow-wrap: anywhere` only offers CONDITIONAL breaks
// inside the value token, and an ordinary break point (the label's own space)
// always wins over a conditional one. The same rule split "Chưa chốt lịch"
// into "Chưa chốt" / "lịch" at 360px.
//
// The fix removes the ordinary break point (nowrap), so the LABEL is whole and
// the value token is the thing that yields.
describe('shipments phone card band labels (SIL-993)', () => {
  it('keeps the fact eyebrow label on one line', () => {
    expect(css).toMatch(
      /\.cus-dashboard-table \.cus-inline-trigger::before\s*\{[^}]*white-space:\s*nowrap;/,
    );
  });

  it('keeps the "Chưa chốt lịch" status on one line', () => {
    expect(css).toMatch(/\.cus-schedule-missing\s*\{[^}]*white-space:\s*nowrap;/);
  });

  it('does not hide the value that shares the label line', () => {
    // nowrap is scoped to the label pseudo — the value keeps its own wrap law
    // (the base "words wrap whole" rule on .cus-multiline-cell stays).
    const eyebrow = css.match(
      /\.cus-dashboard-table \.cus-inline-trigger::before\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(eyebrow).not.toMatch(/display:\s*none/);
    expect(css).toMatch(
      /\.cus-multiline-cell strong,\s*\n\.cus-multiline-cell span\s*\{[^}]*overflow-wrap:\s*anywhere;/,
    );
  });
});
