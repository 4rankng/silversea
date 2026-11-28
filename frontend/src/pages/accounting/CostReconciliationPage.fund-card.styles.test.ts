// SIL-1217 (id 1399) — /accounting/hoan-ung 390px: the Quỹ cá nhân card's
// money facts clipped off the viewport edge ('ĐÃ TẤT TOÁN QUA PHIẾU 777.'
// losing '000 ₫'; the measured spans ran to x=422–441 in a 390px viewport
// with docScrollWidth=390, so nothing could bring them back). Root cause:
// the table face's `.record-table .num` nowrap rode into the shared
// record-card band, where the label shares the value's line — the whole
// fact measured 226px inside a 186px track. The band now drops the nowrap
// so the fact wraps at spaces; the amount stays atomic on the .money span
// (one text node, never split from its ₫).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SIL-1217 — the record-card money fact wraps, its amount stays atomic', () => {
  const shared = readFileSync(resolve(process.cwd(), 'src/styles/record-table.css'), 'utf8');

  it('the card band drops the .num table-face nowrap so the label wraps at spaces', () => {
    const band = shared.match(/@container \(max-width: 1100px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(band, 'card band exists').toBeTruthy();
    const numRule = band.match(/\.record-table tbody td\.num \{([^}]*)\}/)?.[1] ?? '';
    expect(numRule).toMatch(/text-align:\s*left;/);
    expect(numRule).toMatch(/white-space:\s*normal;/);
  });

  it('the table face keeps its single-line numeric law outside the band', () => {
    const outside = shared.replace(/@container \(max-width: 1100px\) \{[\s\S]*?\n\}/g, '');
    const numRule = outside.match(/\.record-table \.num \{([^}]*)\}/)?.[1] ?? '';
    expect(numRule).toMatch(/white-space:\s*nowrap;/);
    expect(numRule).toMatch(/overflow-wrap:\s*normal;/);
  });
});
