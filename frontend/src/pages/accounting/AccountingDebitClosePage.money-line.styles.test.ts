import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/pages/accounting/AccountingDebitClosePage.css'),
  'utf8',
);

// Owner ruling 27/11 r2 — a table money input takes ONE STANDARD width
// (13ch ≈ 95px at the caption face, the invoice-input 12ch law's sibling):
// wide enough for every formatted VND placeholder, identical on every rate
// line, never stretched to the cell width. The 100%-of-cell law it replaces
// made all eight inputs huge; the placeholder-driven ch-hack before that
// made them ragged. The phone card face keeps its own 100% override
// (#root .ledger-record__fact …) — different surface, different geometry.

describe('debit money line — uniform standard input width (owner 27/11 r2)', () => {
  it('the rate line is a single-column stack with no intrinsic input floor', () => {
    expect(css).toMatch(
      /\.debit-line--rate\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    expect(css).toMatch(
      /\.debit-line--rate \.debit-line__value\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-items:\s*flex-start;[^}]*min-width:\s*0;/,
    );
    expect(css).toMatch(
      /\.debit-line--rate \.debit-ext-cost\s*\{[^}]*width:\s*13ch;[^}]*min-width:\s*0;/,
    );
    // The retired inline pair must not survive anywhere in the sheet.
    expect(css).not.toMatch(/minmax\(88px,\s*auto\)/);
  });

  it('every desktop table money input carries the same standard width', () => {
    expect(css).toMatch(/\.debit-line--rate \.debit-ext-cost\s*\{[^}]*width:\s*13ch;/);
    expect(css).toMatch(/\.debit-line--stacked \.debit-ext-cost\s*\{[^}]*width:\s*13ch;/);
    // No desktop rule may stretch a rate input to its cell again.
    const desktopRate = css.match(/\.debit-line--rate \.debit-ext-cost\s*\{[^}]*\}/)?.[0] ?? '';
    expect(desktopRate).not.toContain('width: 100%');
  });

  it('the phone card face keeps its full-width override', () => {
    const phoneBlocks = [...css.matchAll(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/g)].map(
      (match) => match[1],
    );
    expect(phoneBlocks.some((b) => b.includes('input.debit-ext-cost') && b.includes('width: 100%'))).toBe(true);
    expect(phoneBlocks.every((b) => !b.includes('.debit-line--rate'))).toBe(true);
  });

  it('never cuts the money label or the amount', () => {
    expect(css).not.toMatch(/\.debit-line__label\s*\{[^}]*text-overflow:\s*ellipsis;/);
    expect(css).toMatch(/\.debit-line__value\s*\{[^}]*white-space:\s*nowrap;/);
  });
});
