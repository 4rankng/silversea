import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Audit 2026-11-27 (AUI-11/P2-11) — /ops/wallet: the scroll pane is the
// scrollport (overflow: auto + max-height) so the sticky header band and the
// trailing action column pin INSIDE the pane; the header surface stays
// opaque so rows never bleed through a pinned header. Scoped to the page
// root — the accountant tab's reuse of .ops-wallet__* keeps its own contract.
const css = readFileSync(resolve(process.cwd(), 'src/pages/OpsWalletPage.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const historyTsx = readFileSync(resolve(process.cwd(), 'src/features/ops/OpsExpenseHistory.tsx'), 'utf8');

function ruleBody(selector: string, source = css): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = source.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

describe('OpsWalletPage — the table pane owns its scrollport (audit 2026-11-27)', () => {
  it('scrolls both axes and caps the pane height', () => {
    const scroll = ruleBody('.ops-wallet__scroll');
    expect(scroll).toMatch(/overflow:\s*auto/);
    expect(scroll).toMatch(/max-height:\s*calc\(100dvh - var\(--topbar-h\) - 120px\)/);
    expect(scroll).toMatch(/container-type:\s*inline-size/);
  });

  it('pins an opaque header band inside the wide-container band', () => {
    const band = css.slice(css.indexOf('@container (min-width: 701px)'));
    expect(band).toMatch(/\.ops-wallet \.ops-wallet__table thead th\s*\{\s*position:\s*sticky;\s*top:\s*0;\s*z-index:\s*3;\s*background:\s*var\(--surface-2\);\s*border-bottom:\s*1px solid var\(--line-strong\);\s*\}/);
  });

  it('sticks the trailing action column with an opaque surface and a border seam', () => {
    const band = css.slice(css.indexOf('@container (min-width: 701px)'));
    expect(band).toMatch(/\.ops-wallet \.ops-wallet__table th:last-child,\s*\.ops-wallet \.ops-wallet__table td:last-child\s*\{\s*position:\s*sticky;\s*right:\s*0;\s*\}/);
    expect(band).toMatch(/\.ops-wallet \.ops-wallet__table thead th:last-child\s*\{\s*z-index:\s*4;\s*\}/);
    expect(band).toMatch(/\.ops-wallet \.ops-wallet__table tbody td:last-child\s*\{\s*z-index:\s*2;\s*background:\s*var\(--surface\);\s*border-left:\s*1px solid var\(--border-1\);\s*\}/);
  });

  it('never uses a box-shadow seam — the global flat-surface reset nulls them', () => {
    const band = css.slice(css.indexOf('@container (min-width: 701px)'));
    expect(band).not.toMatch(/box-shadow/);
  });
});

// SIL-1200 (QA wave a8f059c0, 1440px) — the 'Lịch sử chi phí' Bill/Booking
// code is ONE token (SIL-1059 law): it wrapped mid-code on 20+ rows under the
// fixed layout's equal shares + the shared `overflow-wrap: anywhere`. The
// cell expands (nowrap, no emergency break, no clip) and the TRACK admits the
// widest measured code — under `table-layout: fixed` only a width sizes the
// track (SIL-904 round 10), so the floor is a real width on the th.
describe('OpsWalletPage — the expense-history Bill/Booking code prints on ONE line (SIL-1200)', () => {
  /** Longest code measured in the audit: renders ≈159px at the 12px data role. */
  const LONGEST_BILL = 'QA-R38-BL1059U-33146';
  /** Measured advance of a bill code at the data role (OpsOrdersPage SIL-1059
   *  idiom): 182.6px over 24 chars at 12px = 0.634em. */
  const CODE_ADVANCE_EM = 0.634;
  const CELL_GUTTER_PX = 24;

  it('expands the code instead of breaking or clipping it (law §4)', () => {
    const cell = ruleBody('.ops-wallet .ops-wallet__table td.ops-wallet__cell--bill');
    expect(cell).toMatch(/white-space:\s*nowrap/);
    expect(cell).toMatch(/overflow-wrap:\s*normal/);
    expect(cell).toMatch(/word-break:\s*keep-all/);
    expect(cell).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(cell).not.toMatch(/overflow:\s*hidden/);
  });

  it('the history table rides the shared bill column contract', () => {
    expect(historyTsx).toMatch(/<th className="ops-wallet__col--bill">Bill \/ Booking<\/th>/);
    expect(historyTsx).toMatch(/<td className="ops-wallet__cell--bill" data-label="Bill \/ Booking">/);
  });

  it('sizes the track for the widest measured code beside the cell gutters', () => {
    const th = ruleBody('.ops-wallet .ops-wallet__table thead th.ops-wallet__col--bill');
    const width = Number(th.match(/width:\s*(\d+)px/)?.[1]);
    expect(width).toBeGreaterThan(0);
    const dataSize = Number(tokens.match(/--text-data-size:\s*(\d+)px/)?.[1]);
    expect(dataSize).toBeGreaterThan(0);
    const needed = LONGEST_BILL.length * dataSize * CODE_ADVANCE_EM + CELL_GUTTER_PX;
    expect(width, `the track must admit '${LONGEST_BILL}'`).toBeGreaterThanOrEqual(needed);
  });

  it('the phone card band gives the code a full-width slot (no mid-token break at 390/360)', () => {
    const band = css.slice(css.indexOf('@container (max-width: 700px)'));
    expect(band).toMatch(/\.ops-wallet__row > td\.ops-wallet__cell--bill\s*\{\s*grid-column:\s*1 \/ -1;\s*\}/);
  });
});
