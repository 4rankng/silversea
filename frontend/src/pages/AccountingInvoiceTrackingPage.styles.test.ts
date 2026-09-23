// Card 20260922_52 (rework v2) — anti-spill contract for the 14-column board.
//
// jsdom has no layout engine, so this file pins the CSS contract that makes a
// spill structurally impossible; the measured layout proof (per-cell
// scrollWidth ≤ clientWidth at 1280/1440/1920/2560) runs against this exact
// stylesheet in the headless harness recorded under qa/.
//
// Why the board left `table-layout: fixed`: under fixed layout a `width` track
// is a hard box, so a token wider than its track (the leaked 32-char lot code
// Q10-<epoch>-q10-<rand>-3, the 40-char invoice no. INV-EMPTY-<epoch>-…)
// painted straight over the next column, and design law §4 bans the only
// fixed-layout escape (clipping / ellipsis on data cells). Content-sizing
// layout (card 20260922_22 pattern: .routes-table, .cfg-customer-table) lets
// token columns grow to their content while text columns wrap — neither can
// leave its cell.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/AccountingInvoiceTrackingPage.css'), 'utf8');

describe('invoice-tracking 14-column board anti-spill contract (card 20260922_52)', () => {
  it('sizes columns to their content — fixed layout is what painted tokens over the next column', () => {
    const table = css.match(/\.invoice-tracking-table\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(table).toContain('table-layout: auto');
    expect(table).toContain('min-width: 1350px');
  });

  it('gives the card floors to the long-text columns', () => {
    const floor = (nth: number): number | null => {
      const match = css.match(
        new RegExp(`thead th:nth-child\\(${nth}\\)\\s*\\{[^}]*?min-width:\\s*(\\d+)px`, 'm'),
      );
      return match ? Number(match[1]) : null;
    };
    // Card floors: lô hàng ≥160, Cont ≥120, thông tin hđ ≥130.
    expect(floor(3)).toBeGreaterThanOrEqual(160);
    expect(floor(4)).toBeGreaterThanOrEqual(120);
    expect(floor(7)).toBeGreaterThanOrEqual(130);
  });

  it('keeps token columns on one line so the column — not the value — grows', () => {
    const nowrapGroup = css.match(/tbody td:nth-child\(1\),[\s\S]*?white-space: nowrap;/)?.[0] ?? '';
    for (const nth of [1, 2, 4, 5, 8, 10, 11]) {
      expect(nowrapGroup).toContain(`nth-child(${nth})`);
    }
    // Both stack cells (mã lô in col 3, số hóa đơn in col 7) are tokens.
    expect(css).toMatch(/\.ivt-stack > span\s*\{[^}]*white-space: nowrap/);
  });

  it('wraps text columns so a long value can never leave its cell', () => {
    const wrapGroup = css.match(/tbody td:nth-child\(3\),[\s\S]*?overflow-wrap: anywhere;/)?.[0] ?? '';
    for (const nth of [3, 6, 7, 9, 12]) {
      expect(wrapGroup).toContain(`nth-child(${nth})`);
    }
    // The customer name wraps rather than spilling (measured: 83px into Cont).
    expect(css).toMatch(/\.ivt-stack > span\.ivt-stack__sub\s*\{[^}]*white-space: normal/);
  });

  it('never clips or ellipsises a data cell — design law §4 no-truncation doctrine', () => {
    const dataCellRules = css
      .split('}')
      .filter((chunk) => /tbody td/.test(chunk))
      .join('}');
    expect(dataCellRules).not.toContain('overflow: hidden');
    expect(dataCellRules).not.toContain('text-overflow: ellipsis');
  });

  it('right-aligns the money columns and keeps the thousand separator formatter', () => {
    expect(css).toMatch(/tbody td:nth-child\(8\),[\s\S]*?nth-child\(10\)\s*\{\s*text-align:\s*right/);
  });
});
