import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/accounting/PhoiPhieuControlPage.css'), 'utf8');

describe('phôi phiếu board header contract (card 20260922_54)', () => {
  it('thead headers wrap at spaces only — never a mid-word fracture like CONTAINE/R', () => {
    const thead = css.match(/\.ppc-board thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(thead).toContain('word-break: keep-all');
    expect(thead).toContain('overflow-wrap: normal');
    expect(thead).not.toContain('overflow-wrap: anywhere');
    expect(thead).toContain('white-space: normal');
  });
});

describe('phôi phiếu board cell discipline (card 20260923_8 group B)', () => {
  it('atomic cells never fracture — date column and chi hộ/tiền đường value tokens pin nowrap (design law §4)', () => {
    expect(css).toMatch(/\.ppc-board td\.ppc-col--date\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.ppc-board \.ppc-value\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('atomic columns are budgeted explicitly — the fixed-layout board no longer equal-shares every column', () => {
    expect(css).toMatch(/\.ppc-board th\.ppc-col--select\s*\{[^}]*width:\s*3%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--chiho\s*\{[^}]*width:\s*14%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--money\s*\{[^}]*width: 11%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--status\s*\{[^}]*width:\s*8%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--date\s*\{[^}]*width:\s*10%/);
  });

  it('chi hộ affordance is an icon-only button with a ≥24px hit area (09-18 icon-action ruling, §5)', () => {
    expect(css).toMatch(/\.ppc-board \.ppc-icon-btn\s*\{[^}]*width:\s*26px/);
    expect(css).toMatch(/\.ppc-board \.ppc-icon-btn\s*\{[^}]*height:\s*26px/);
  });
});
