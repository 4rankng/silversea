// SIL-701 (id 821) — /accounting/chot-debit: the NGÀY track cut the last
// digit of the date ("01/11/2026" rendered as "01/11/202").
//
// Measured on the running board (local dev, 1440px, 12px Inter Digits):
//   selection tick 13.2px + 2px gap + "04/11/2026" 74.3px + the cell's 20px
//   padding = 109.5px of content in a 96px track → 4px of overflow, the last
//   digit clipped at the column edge.
//
// SIL-772 rebuilt the board as the nine fixed Rev2 tracks: the date is the
// second LINE of the Lô cell (columns.tsx), the 13% Lô track ≈195px at the
// 1480px fixed-layout floor, and the board NEVER grows past the canvas —
// which is also what keeps the 1920px operating width free of the horizontal
// scrollbar the QA FAIL measured.
//
// WHAT THIS PINS: the no-clip law at its new home — the date line never
// wraps (one value, one line), rides tabular digits, and the fixed-layout
// floor stands so the tracks cannot be crushed below the measured content.
// It does NOT re-measure the font — the driver does that on the running
// board at 390/768/1440 (qa/2026-11-07-lane-r4/).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOARD_COLUMNS } from './AccountingDebitClosePage.columns';

const css = readFileSync(resolve(process.cwd(), 'src/pages/accounting/AccountingDebitClosePage.css'), 'utf8')
  // The comments carry the measurement that justifies each track; they are
  // not part of any selector.
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule body whose SELECTOR list contains the given selector. */
function ruleBodies(selector: string): string[] {
  const bodies: string[] = [];
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  for (const match of css.matchAll(rulePattern)) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

/** The rule body that carries the declaration — the board declares one
 *  selector in several rules (a shared sticky block, then its own track). */
function ruleWith(selector: string, declaration: RegExp): string {
  const bodies = ruleBodies(selector);
  const found = bodies.find((body) => declaration.test(body));
  expect(found, `no rule of "${selector}" carries ${declaration}`).toBeTruthy();
  return found!;
}

describe('SIL-701 — chốt debit: ngày hiển thị đủ DD/MM/YYYY trên lưới 9 nhóm', () => {
  it('the board is a fixed nine-track grid that never grows past the canvas', () => {
    const body = ruleWith('.debit-board', /table-layout:\s*fixed/);
    expect(body).toMatch(/table-layout:\s*fixed/);
    expect(body).toMatch(/width:\s*100%/);
    // The floor keeps the money tracks from being crushed below the measured
    // content; the 1920px canvas (measured ≈1438px) clears it, so no
    // horizontal scrollbar there — the AC the QA FAIL measured.
    expect(body).toMatch(/min-width:\s*1380px/);
  });

  it('the date line never wraps and rides tabular digits', () => {
    const body = ruleWith('.debit-lot-date', /white-space:\s*nowrap/);
    expect(body).toMatch(/white-space:\s*nowrap/);
    expect(body).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('a money VALUE never wraps; a missing money label WRAPS instead of being cut', () => {
    expect(ruleWith('.debit-line__value', /white-space:\s*nowrap/)).toMatch(/white-space:\s*nowrap/);
    expect(ruleWith('.debit-line__value .debit-missing', /white-space:\s*normal/))
      .toMatch(/white-space:\s*normal/);
    expect(ruleWith('.debit-board td.debit-col--money', /white-space:\s*nowrap/))
      .toMatch(/white-space:\s*nowrap/);
    expect(ruleWith('.debit-board td.debit-col--money .debit-missing', /white-space:\s*normal/))
      .toMatch(/white-space:\s*normal/);
  });

  it('SIL-772 — cột tổng phía Phải trả có nhãn "Tổng trả" (không phải "Tổng 1")', () => {
    const col = BOARD_COLUMNS.find((candidate) => candidate.key === 'tongTraChiPhiNgoai');
    expect(col).toBeDefined();
    expect(col?.label).toBe('Tổng trả & Chi phí ngoài');
    // The rollup line label stays the customer's word ("Tổng trả"), rendered
    // by the cell — not the generic "Tổng 1".
    expect(col?.cell.toString()).toContain('Tổng trả');
  });

  it('SIL-772 — the nth-child track shares map onto the CURRENT column order', () => {
    // The fixed grid keys its nine widths on header position (same-class
    // columns carry different shares), so a silent BOARD_COLUMNS reorder
    // would migrate widths to the wrong groups. Pin the mapping itself:
    // position i must still be the key this width was measured for.
    const expectedOrder = ['lo', 'hangHoaCont', 'phuongTien', 'cucPhaiThu', 'tongThu', 'cucPhaiTra', 'tongTraChiPhiNgoai', 'loiNhuan', 'ghiChuDoiSoat'];
    expect(BOARD_COLUMNS.map((candidate) => candidate.key)).toEqual(expectedOrder);
    const expectedShares = [13, 11, 11, 12, 8, 12, 11, 8, 14];
    expectedOrder.forEach((key, index) => {
      expect(css).toContain(`.debit-board thead th:nth-child(${index + 1}) { width: ${expectedShares[index]}%; }`);
    });
  });
});
