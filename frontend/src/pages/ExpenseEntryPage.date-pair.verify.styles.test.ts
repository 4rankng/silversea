import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260925_6 — site-wide pairing sweep verify-only check on
 * /expenses/new (ExpenseEntryPage). The validity date pair (Hiệu lực từ /
 * Hiệu lực đến) was already fixed in card 20260923 QA-088 — `.expense-validity-pair`
 * is the canonical one-cell wrapper. This test pins the structural
 * contract so a regression that puts the two dates back into separate
 * cells trips before merge.
 */

const css = readFileSync(resolve(process.cwd(), 'src/pages/ExpenseEntryPage.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/ExpenseEntryPage.tsx'), 'utf8');

describe('ExpenseEntryPage validity-pair regression guard (card 20260925_6 verify)', () => {
  it('one `.expense-validity-pair` cell wraps both date inputs', () => {
    const wrapperIdx = source.indexOf('expense-validity-pair"');
    expect(wrapperIdx, 'validity pair wrapper missing').toBeGreaterThan(0);
    const fromIdx = source.indexOf('validFrom', wrapperIdx);
    const toIdx = source.indexOf('validTo', wrapperIdx);
    expect(fromIdx).toBeGreaterThan(wrapperIdx);
    expect(toIdx).toBeGreaterThan(fromIdx);
  });

  it('the wrapper is a full-row 2-col internal grid, no elevated chrome', () => {
    expect(css).toMatch(/\.expense-validity-pair\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/);
    expect(css).toMatch(/\.expense-validity-pair\s*\{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.expense-validity-pair\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    // No panel / shadow / border on the pair shell — rides the form grid surface.
    const block = css.match(/\.expense-validity-pair\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).not.toMatch(/background/);
    expect(block).not.toMatch(/box-shadow/);
    expect(block).not.toMatch(/border/);
  });
});
