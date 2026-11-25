import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/pages/accounting/AccountingDebitClosePage.css'),
  'utf8',
);

// SIL-1001 — on the phone card band (≤640px) the money cell is 174px wide and
// a money line is a PAIR (label + input). The label was squeezed to its
// min-content (~32px) and broke into 2–3 lines ("Cước" / "thu", "Phát sinh
// (CUS)" = 3 lines) while the input kept 134px.
//
// The label and the input cannot share one row in a 174px cell, so the line
// stacks — the same shape the "Chi phí ngoài" line already uses (label above,
// full-width input). The desktop band keeps its inline pair.
const phoneBlocks = [...css.matchAll(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/g)].map(
  (match) => match[1],
);

describe('debit money line on the phone card band (SIL-1001)', () => {
  it('stacks the labeled money line so the label reads whole', () => {
    const block = phoneBlocks.find((b) => b.includes('.debit-line--rate'));
    expect(block).toBeDefined();
    expect(block).toMatch(/\.debit-line--rate\s*\{[^}]*display:\s*grid;[^}]*gap:\s*2px;/);
    expect(block).toMatch(/\.debit-line--rate \.debit-line__value\s*\{[^}]*justify-self:\s*stretch;/);
  });

  it('keeps the desktop money line stacked — the label never starves the input (K1.31/SIL-1052)', () => {
    // K1.31 (SIL-1052): the inline label+input pair could not guarantee the
    // placeholder room (the 1440 Cước thu track left the input 60px while
    // '3.952.000 ₫' measures 68px — the last digit died). The desktop band
    // rides the same stacked shape the phone band pinned at SIL-1001: label
    // above, full-track input. The base `.debit-line` stays an inline pair
    // for the read-only money lines.
    expect(css).toMatch(
      /\.debit-line\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/,
    );
    expect(css).toMatch(/\.debit-line--rate\s*\{[^}]*display:\s*grid;[^}]*gap:\s*2px;/);
    expect(css).toMatch(/\.debit-line--rate \.debit-line__value\s*\{[^}]*display:\s*flex;[^}]*justify-self:\s*stretch;[^}]*min-width:\s*0;/);
  });

  it('never cuts the money label or the amount', () => {
    expect(css).not.toMatch(/\.debit-line__label\s*\{[^}]*text-overflow:\s*ellipsis;/);
    expect(css).toMatch(/\.debit-line__value\s*\{[^}]*white-space:\s*nowrap;/);
  });
});
