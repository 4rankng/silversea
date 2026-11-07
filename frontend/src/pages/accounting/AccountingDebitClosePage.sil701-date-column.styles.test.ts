// SIL-701 (id 821) — /accounting/chot-debit: the NGÀY track cut the last
// digit of the date ("01/11/2026" rendered as "01/11/202").
//
// Measured on the running board (local dev, 1440px, 12px Inter Digits):
//   selection tick 13.2px + 2px gap + "04/11/2026" 74.3px + the cell's 20px
//   padding = 109.5px of content in a 96px track → 4px of overflow, the last
//   digit clipped at the column edge.
//
// WHAT THIS PINS: the MEASURED track (one custom property, shared with the
// sticky lot column), the tabular digits, and the wrapping of the missing
// money label. It does NOT re-measure the font — the driver does that on the
// running board at 390/768/1440 (qa/2026-11-07-lane-r4/).

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

describe('SIL-701 — chốt debit: cột NGÀY hiển thị đủ DD/MM/YYYY', () => {
  it('the date track is ONE property, sized by the measured floor and the font', () => {
    const track = ruleWith('.debit-board', /--debit-date-track/);
    expect(track).toMatch(/--debit-date-track:\s*max\(116px,\s*12ch\)/);

    const body = ruleWith('.debit-board td.debit-col--date', /width:\s*var\(--debit-date-track\)/);
    expect(body).toMatch(/width:\s*var\(--debit-date-track\)/);
    expect(body).toMatch(/min-width:\s*var\(--debit-date-track\)/);
    // The date never wraps — it is ONE value on ONE line.
    expect(body).toMatch(/white-space:\s*nowrap/);
    // Tabular digits: the date is a numeric column, so every row's date is
    // the same width whatever the loaded font is.
    expect(body).toMatch(/font-variant-numeric:\s*tabular-nums/);
    // No `max-width`: the track may grow, never clip.
    expect(body).not.toMatch(/max-width/);
  });

  it('the sticky identity pair follows the date track instead of a second number', () => {
    expect(ruleWith('.debit-board td.debit-col--lot', /left:\s*calc/))
      .toMatch(/left:\s*calc\(34px \+ var\(--debit-date-track\)\)/);
  });

  it('a missing money label WRAPS instead of being cut', () => {
    expect(ruleWith('.debit-board td.debit-col--money .debit-missing', /white-space:\s*normal/))
      .toMatch(/white-space:\s*normal/);
    // The money NUMBER still never wraps — a broken number is unreadable.
    expect(ruleWith('.debit-board td.debit-col--money', /white-space:\s*nowrap/))
      .toMatch(/white-space:\s*nowrap/);
  });

  it('SIL-701 — cột tổng phía Phải trả có nhãn "Tổng trả" (không phải "Tổng 1")', () => {
    const tong1Col = BOARD_COLUMNS.find((col) => col.key === 'tong1');
    expect(tong1Col).toBeDefined();
    expect(tong1Col?.label).toBe('Tổng trả');
    expect(tong1Col?.group).toBe('tra');
  });
});
