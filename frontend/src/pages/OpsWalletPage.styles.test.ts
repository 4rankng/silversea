import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1198/SIL-1199 (QA wave a8f059c0) — /ops/wallet: MAIN.app-body is the
// page's single vertical scroller. The old max-height panes owned the
// scrolling and moved wholesale under the page wheel while each table's
// sticky thead resolved against its pane — the headers left with the page.
// The wrappers now clip horizontally only (overflow-x: clip is not a scroll
// container), so each section's thead pins against .app-body flush under
// the topbar through the shared --sticky-thead-top negation. The action and
// approver tds keep table-cell layout so their dividers span the row.
// Scoped to the page root — the accountant tab's reuse of .ops-wallet__*
// keeps its own contract.
const css = readFileSync(resolve(process.cwd(), 'src/pages/OpsWalletPage.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const historyTsx = readFileSync(resolve(process.cwd(), 'src/features/ops/OpsExpenseHistory.tsx'), 'utf8');

function ruleBody(selector: string, source = css): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = source.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

describe('OpsWalletPage — the document is the single vertical scroller (SIL-1199)', () => {
  it('clips horizontally without ever becoming a scroll container', () => {
    const scroll = ruleBody('.ops-wallet__scroll').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(scroll).toMatch(/overflow-x:\s*clip/);
    expect(scroll).toMatch(/overflow-y:\s*visible/);
    expect(scroll).not.toMatch(/overflow:\s*auto/);
    expect(scroll).not.toMatch(/max-height/);
    expect(scroll).toMatch(/container-type:\s*inline-size/);
  });

  it('pins the opaque header band flush under the topbar via the shared token', () => {
    const band = css.slice(css.indexOf('@container (min-width: 701px)'));
    expect(band).toMatch(/\.ops-wallet \.ops-wallet__table thead th\s*\{\s*position:\s*sticky;\s*top:\s*var\(--sticky-thead-top, -24px\);\s*z-index:\s*3;\s*background:\s*var\(--surface-2\);\s*border-bottom:\s*1px solid var\(--line-strong\);\s*\}/);
  });

  it('keeps the action and approver tds on the table-cell axis (SIL-1198)', () => {
    const band = css.slice(css.indexOf('@container (min-width: 701px)'));
    expect(band).toMatch(/\.ops-wallet \.ops-wallet__table td\.ops-row-actions\s*\{\s*display:\s*table-cell;\s*text-align:\s*right;\s*\}/);
    expect(band).toMatch(/\.ops-wallet \.ops-wallet__table td\.ops-row-actions > \* \+ \*\s*\{\s*margin-inline-start:\s*6px;\s*\}/);
    expect(band).toMatch(/\.ops-wallet \.ops-wallet__table td\.ops-wallet__approver\s*\{\s*display:\s*table-cell;\s*\}/);
    // The trailing-column right-pin died with the pane: the fixed-layout
    // tables never overflow the rail horizontally.
    expect(band).not.toMatch(/position:\s*sticky;\s*\n\s*right:\s*0/);
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
  /** Longest code measured on the HEAD build (2026-11-28 local DOM probe):
   *  24 chars rendered 184.4px at the 12px data role — the 20-char audit
   *  code 'QA-R38-BL1059U-33146' renders ≈154px and fit the old track. */
  const LONGEST_BILL = 'EBKG19248801-SIL851PROBE';
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
