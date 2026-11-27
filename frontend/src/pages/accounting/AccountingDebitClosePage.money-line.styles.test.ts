import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/pages/accounting/AccountingDebitClosePage.css'),
  'utf8',
);

// KB ch10 QA 27/11 — the rate input owns the FULL cell width (width: 100%;
// min-width: 0): the fixed 15% money track is the only width law, so a
// formatted value can never escape the input, overlap its own label or clip
// the TỔNG THU cell next door. A ch/px floor is what let the value escape —
// it may not return. The stacked Chi phí ngoài input keeps its own 13ch
// standard (its own 8.5% track, its own owner ruling) — this suite pins the
// rate line only. The phone card face keeps its own 100% override
// (#root .ledger-record__fact …) — different surface, different geometry.

describe('debit money line — rate input owns the cell (KB ch10 QA 27/11)', () => {
  it('the rate line is a single-column stack with no intrinsic input floor', () => {
    expect(css).toMatch(
      /\.debit-line--rate\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    expect(css).toMatch(
      /\.debit-line--rate \.debit-line__value\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-items:\s*flex-start;[^}]*min-width:\s*0;/,
    );
    expect(css).toMatch(
      /\.debit-line--rate \.debit-ext-cost\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
    );
    // The retired inline pair must not survive anywhere in the sheet.
    expect(css).not.toMatch(/minmax\(88px,\s*auto\)/);
  });

  it('no ch/px floor may return on the rate input — the track is the only width law', () => {
    const desktopRate = css.match(/\.debit-line--rate \.debit-ext-cost\s*\{[^}]*\}/)?.[0] ?? '';
    expect(desktopRate).toContain('width: 100%');
    expect(desktopRate).not.toMatch(/width:\s*\d+ch/);
    expect(desktopRate).not.toMatch(/min-width:\s*\d+(ch|px)/);
    // The stacked Chi phí ngoài input keeps its 13ch standard — its own
    // track, its own ruling; the full-width law is scoped to .debit-line--rate.
    expect(css).toMatch(/\.debit-line--stacked \.debit-ext-cost\s*\{[^}]*width:\s*13ch;/);
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
