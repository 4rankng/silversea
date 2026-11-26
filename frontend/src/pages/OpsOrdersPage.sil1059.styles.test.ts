import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1059 — the Bill/Booking code on /ops/orders is ONE token: house design
// law §4 says a code EXPANDS (`white-space: nowrap`, no clip, never broken
// mid-token) and spec §10.8.1 says every cell shows its content in full. The
// cell used to wrap, so 'YMJAW492344960' printed as 'YMJAW49234496' + '0'
// and the LCL chip fell onto a second line.
//
// The table is fixed-layout, so a nowrap cell needs a column WIDE ENOUGH —
// too narrow and the code paints over the neighbouring cell (the shared
// .tt-table cell comment says exactly that). The floor is derived from the
// real tokens and the longest real code, not from a restated literal.

const css = readFileSync(resolve(process.cwd(), 'src/pages/OpsOrdersPage.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function ruleBody(selector: string, source = css): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = source.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

/** The longest booking code the board can show (24 chars, measured live in
 *  the app's own fonts at 12px/600 → 182.6px). The ticket's own codes
 *  ('YMJAW492344960', 'EGLV149607019417') are shorter. */
const LONGEST_BOOKING = 'BK-S1021R-1795651428457';
/** The ' LẺ' StatusText chip that rides the same cell on an LCL lot
 *  (measured: dot 7px + gap 6px + the label). */
const LCL_CHIP_PX = 29;
/** The .tt-table cell gutters (12px each side). */
const CELL_GUTTER_PX = 24;
/** The measured average advance of a booking code at the data role: 182.6px
 *  over 24 characters = 7.61px at 12px = 0.634em. The house width-budget
 *  idiom uses 0.6em; the code carries letters (Be Vietnam Pro), so the
 *  advance is a shade wider — the test uses the measured factor. */
const CODE_ADVANCE_EM = 0.634;

describe('OpsOrdersPage — the Bill/Booking code prints on ONE line (SIL-1059, spec §10.8.1)', () => {
  it('never wraps the code and never clips it', () => {
    const code = ruleBody('.ops-orders__table .col-code');
    expect(code).toMatch(/white-space:\s*nowrap/);
    expect(code).toMatch(/overflow-wrap:\s*normal/);
    // The no-truncation doctrine bans ellipsis on a data cell.
    expect(code).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(code).not.toMatch(/overflow:\s*hidden/);
  });

  it('gives the column room for the longest code beside the LCL chip', () => {
    const code = ruleBody('.ops-orders__table .col-code');
    const width = Number(code.match(/width:\s*(\d+)px/)?.[1]);
    expect(width).toBeGreaterThan(0);
    const dataSize = Number(tokens.match(/--text-data-size:\s*(\d+)px/)?.[1]);
    expect(dataSize).toBeGreaterThan(0);
    const needed = LONGEST_BOOKING.length * dataSize * CODE_ADVANCE_EM + LCL_CHIP_PX + CELL_GUTTER_PX;
    expect(width, `the column must admit '${LONGEST_BOOKING}' + the LẺ chip`).toBeGreaterThanOrEqual(needed);
  });
});
