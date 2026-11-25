import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-990 — in the card band every fact is ONE line (LABEL rides the value),
// so the whole run must start at the cell's left edge. The `.num`
// right-alignment is a DESKTOP table law (there the figures stack under
// their own header); in a card it pushed the label into the middle of the
// card — the identity line sat flush left while "SỐ TIỀN ĐÃ ỨNG" floated
// mid-card (audit tablet 25/11, Báo cáo hoàn ứng).
const css = readFileSync(resolve(process.cwd(), 'src/styles/record-table.css'), 'utf8');

describe('record-table card band — the fact lines share one left edge (SIL-990)', () => {
  const band = css.slice(css.indexOf('@container (max-width: 1100px)'));

  it('left-aligns the numeric facts inside the card band', () => {
    expect(band).toMatch(/\.record-table tbody td\.num \{[^}]*text-align:\s*left;/s);
  });

  it('keeps the desktop table law — the figures stay right-aligned in a table', () => {
    const table = css.slice(0, css.indexOf('@container (max-width: 1100px)'));
    expect(table).toMatch(/\.record-table \.num \{[^}]*text-align:\s*right;/s);
  });
});
