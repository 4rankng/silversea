import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/pages/accounting/AccountingDebitClosePage.css'),
  'utf8',
);

// Owner law 27/11 — a rate line STACKS at every width: the label sits above
// and the input takes the FULL cell width. The former desktop inline pair
// (label left + input right with an 88px floor) pushed the input past the
// fixed 15% money track onto the adjacent column and buried its own label —
// the money value visually escaped the input. SIL-1001's phone band needed
// no private override anymore: one shape serves every width.

describe('debit money line — stacked full-width law (owner 27/11)', () => {
  it('the rate line is a single-column stack with no intrinsic input floor', () => {
    expect(css).toMatch(
      /\.debit-line--rate\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    expect(css).toMatch(
      /\.debit-line--rate \.debit-line__value\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;[^}]*min-width:\s*0;/,
    );
    expect(css).toMatch(
      /\.debit-line--rate \.debit-ext-cost\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
    );
    // The retired inline pair must not survive anywhere in the sheet.
    expect(css).not.toMatch(/minmax\(88px,\s*auto\)/);
  });

  it('no phone-specific rate override remains — one stacked shape at all widths', () => {
    const phoneBlocks = [...css.matchAll(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/g)].map(
      (match) => match[1],
    );
    expect(phoneBlocks.every((b) => !b.includes('.debit-line--rate'))).toBe(true);
  });

  it('never cuts the money label or the amount', () => {
    expect(css).not.toMatch(/\.debit-line__label\s*\{[^}]*text-overflow:\s*ellipsis;/);
    expect(css).toMatch(/\.debit-line__value\s*\{[^}]*white-space:\s*nowrap;/);
  });
});
