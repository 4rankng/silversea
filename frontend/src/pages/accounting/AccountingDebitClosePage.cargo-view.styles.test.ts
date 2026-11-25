import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/pages/accounting/AccountingDebitClosePage.css'),
  'utf8',
);

// SIL-996 — the FCL/LCL segmented toggle overflowed the 390px phone viewport:
// the bar measured 405.5px wide (viewport 390px), so its right edge and the
// "21 lô" count fell off-screen.
//
// The labels are sentences ("Vận tải Hàng Cont (FCL) · 21 lô"), so the phone
// band gives both buttons an equal share of the width and lets the label wrap
// WHOLE — nothing is cut (KB §10.8.1). The desktop band keeps one line.
describe('debit cargo view toggle (SIL-996)', () => {
  it('keeps the desktop toggle on one line', () => {
    expect(css).toMatch(
      /\.debit-cargo-view__btn\s*\{[^}]*white-space:\s*nowrap;/,
    );
  });

  it('fits the phone viewport: the bar fills the page and both labels wrap whole', () => {
    const phone = css.match(
      /@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/,
    )?.[1] ?? '';
    expect(phone).toMatch(/\.debit-cargo-view\s*\{[^}]*width:\s*100%;/);
    expect(phone).toMatch(
      /\.debit-cargo-view__btn\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;[^}]*white-space:\s*normal;/,
    );
  });

  it('never hides the lot count of either mode', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/pages/accounting/AccountingDebitClosePage.tsx'),
      'utf8',
    );
    expect(source).toContain('Vận tải Hàng Cont (FCL) · {cargoCounts.FCL} lô');
    expect(source).toContain('Vận tải Hàng Lẻ (LCL) · {cargoCounts.LCL} lô');
    expect(css).not.toMatch(/\.debit-cargo-view__btn\s*\{[^}]*text-overflow:\s*ellipsis;/);
  });
});
