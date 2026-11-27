// SIL-701 (id 821) — /accounting/chot-debit: the NGÀY track cut the last
// digit of the date ("01/11/2026" rendered as "01/11/202").
//
// Measured on the running board (local dev, 1440px, 12px Inter Digits):
//   selection tick 13.2px + 2px gap + "04/11/2026" 74.3px + the cell's 20px
//   padding = 109.5px of content in a 96px track → 4px of overflow, the last
//   digit clipped at the column edge.
//
// SIL-772 rebuilt the board as the nine fixed Rev2 tracks: the date is the
// second LINE of the Lô cell (columns.tsx), the 10% Lô track ≈114px at the
// 1440px canvas (SIL-835 floor 1136px sits below that measured canvas), and
// the board NEVER grows past the canvas — which is also what keeps the 1440px
// window (and the 1920px operating width) free of the horizontal scrollbar
// the QA FAILs measured.
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
    // The floor keeps the money tracks from being crushed; since SIL-835
    // (owner QA 14/11) it sits BELOW the measured 1440px canvas (≈1142px) so
    // the board fills that window with NO horizontal scrollbar, and only
    // narrower canvases degrade to the wrap's scroll.
    expect(body).toMatch(/min-width:\s*1136px/);
  });

  it('the date line never wraps and rides tabular digits', () => {
    const body = ruleWith('.debit-lot-date', /white-space:\s*nowrap/);
    expect(body).toMatch(/white-space:\s*nowrap/);
    expect(body).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('a money VALUE never wraps (SIL-838: no missing label exists to wrap)', () => {
    expect(ruleWith('.debit-line__value', /white-space:\s*nowrap/)).toMatch(/white-space:\s*nowrap/);
    expect(ruleWith('.debit-board td.debit-col--money', /white-space:\s*nowrap/))
      .toMatch(/white-space:\s*nowrap/);
    // SIL-838 điểm 3 — the 'Thiếu …' prose and its wrap carve-outs are gone:
    // a missing value renders an EMPTY cell, so no `.debit-missing` selector
    // survives in the stylesheet.
    expect(css).not.toMatch(/debit-missing/);
  });

  it('SIL-772 — cột tổng phía Phải trả có nhãn "Tổng trả" (không phải "Tổng 1")', () => {
    const col = BOARD_COLUMNS.find((candidate) => candidate.key === 'tongTraChiPhiNgoai');
    expect(col).toBeDefined();
    expect(col?.label).toBe('Tổng trả & Chi phí ngoài');
    // The rollup line label stays the customer's word ("Tổng trả"), rendered
    // by the cell — not the generic "Tổng 1".
    expect(col?.cell.toString()).toContain('Tổng trả');
  });

  it('tracks map onto the current column order and sum to 100% for both FCL and LCL', () => {
    const expectedOrder = ['lo', 'soBillBook', 'hangHoaCont', 'thongSo', 'phuongTien', 'cucPhaiThu', 'tongThu', 'cucPhaiTra', 'tongTraChiPhiNgoai', 'loiNhuan', 'ghiChuDoiSoat'];
    expect(BOARD_COLUMNS.map((candidate) => candidate.key)).toEqual(expectedOrder);

    const fclShares: Record<number, number> = {
      1: 9.5, 2: 10.5, 3: 8.5, 5: 9.5, 6: 14, 7: 8, 8: 14, 9: 8.5, 10: 8.5, 11: 9,
    };
    const lclShares: Record<number, number> = {
      1: 9.5, 2: 10, 4: 9, 5: 9.5, 6: 14, 7: 8, 8: 14, 9: 8.5, 10: 8.5, 11: 9,
    };
    expect(Object.values(fclShares).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Object.values(lclShares).reduce((a, b) => a + b, 0)).toBe(100);

    for (const [col, share] of Object.entries(fclShares)) {
      expect(css).toMatch(new RegExp(`\\.debit-board--fcl thead th:nth-child\\(${col}\\)\\s*\\{\\s*width:\\s*${share}%;\\s*\\}`));
    }
    for (const [col, share] of Object.entries(lclShares)) {
      expect(css).toMatch(new RegExp(`\\.debit-board--lcl thead th:nth-child\\(${col}\\)\\s*\\{\\s*width:\\s*${share}%;\\s*\\}`));
    }
  });

  it('SIL-835 r2 — the Lô lead slot collapses when the row renders its checkbox', () => {
    // The 1.1em tick reservation double-charges the Lô line ~17px once the
    // checkbox owns that slot (selectable rows) — exactly the budget that
    // made 16-char codes bleed. The checkbox REPLACES the tick slot; the
    // code position stays stable across every selectable row.
    expect(css).toMatch(/\.debit-lot-ref:has\(\.debit-row-checkbox\) \.debit-row-tick\s*\{\s*display:\s*none;\s*\}/);
  });

  it('SIL-865 — the Lô column renders no internal SHP-* code anywhere', () => {
    // Hotfix CR-009.1 (21/11): the customer removed the internal code from
    // the board's Lô column — the four-line contract is ngày / khách hàng /
    // nhà máy / tuyến. The long-face span and its CSS are gone with it.
    const lot = BOARD_COLUMNS.find((candidate) => candidate.key === 'lo');
    expect(lot).toBeDefined();
    expect(lot?.cell.toString()).not.toContain('LotCodeSpan');
    expect(lot?.cell.toString()).toContain('debit-lot-date');
    expect(css).not.toMatch(/debit-lot-code/);
  });

  it('SIL-835 — Số Bill/Book wraps cleanly inside its 9% track instead of bleeding onto Hàng hóa & Cont', () => {
    // QA FAIL 19/11 (builds ad4f0597 + 4db2d62f): white-space: nowrap on
    // .debit-bill-book inside the 9% (~99px) track pushed 18-char codes like
    // R4B-A14-EMPTY-8F29 (152px) over the neighboring Hàng hóa & Cont cell.
    // The cell now wraps cleanly with no clip/ellipsis while preserving the
    // 1136px grid floor and 10-column shares.
    const rule = ruleWith('.debit-board td.debit-col--billbook .debit-bill-book', /white-space:\s*normal/);
    expect(rule).toMatch(/display:\s*block/);
    expect(rule).toMatch(/max-width:\s*100%/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule).toMatch(/word-break:\s*normal/);
    expect(rule).not.toMatch(/white-space:\s*nowrap/);
    expect(rule).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).not.toMatch(/overflow:\s*hidden/);
  });
});
