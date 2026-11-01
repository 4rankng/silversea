import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20261004_324 — the TRẠNG THÁI "Đang dùng" pill on /config/factories wore a
// stray pencil glyph at its right edge on most rows. Mechanism: NOT stacking or
// absolute positioning — plain overflow. `.factories-table` is `table-layout:
// fixed`, which freezes the action column (colgroup 7% of the 1120px floor =
// 78.4px, px hint 76px) below the intrinsic width of its `.row-actions` run
// (2 square buttons + 6px gap + 2×12px cell padding = 90px fine pointer, 110px
// under the responsive.css `pointer: coarse` 40px button floor). A fixed column
// cannot grow to its content (the auto-layout routes/customers catalogs
// self-heal — card 20260922_22), so the flex run escaped out the cell's START
// edge (`justify-content: flex-end` overflow) and table cells paint overflow —
// the run's leftmost item is the Pencil button, which landed on the status cell.
// The status column was squeezed the same way (54.4px content vs ≈60px text),
// so the pill's right edge sat exactly where the glyph bled in.
//
// These contracts pin the budgets so the bleed mechanism cannot return: at the
// table's minimum width, the frozen column must hold (a) its status token on one
// line and (b) the worst-case action run — computed from the REAL shared
// contracts (control tokens, row-actions gap, record-table cell padding), not
// restated literals.

function read(relativePath: string) {
  const direct = resolve(process.cwd(), relativePath);
  if (existsSync(direct)) return readFileSync(direct, 'utf8');
  return readFileSync(resolve(process.cwd(), 'frontend', relativePath), 'utf8');
}

const tokens = read('src/styles/tokens.css');
const tableCss = read('src/components/Table.css');
const recordTableCss = read('src/styles/record-table.css');
const factoriesSource = read('src/pages/config/FactoriesConfigPage.tsx');
const configPageCss = read('src/pages/config/config-page.css');
const routesCss = read('src/pages/config/RoutesConfigPage.css');

function matchNumber(source: string, pattern: RegExp, label: string): number {
  const value = Number(source.match(pattern)?.[1]);
  expect(Number.isFinite(value), `${label}: ${pattern}`).toBe(true);
  return value;
}

// Shared geometry the budget is derived from.
const compactH = matchNumber(tokens, /--control-compact-h:\s*(\d+)px/, 'compact control');
// SIL-583 r2: the coarse-pointer button floor is the REAL 44px §5 touch
// token (decoupled from the 40px ordinary ceiling, which --control-max-h
// still carries) — the worst-case action-run budget measures the real floor.
const touchH = matchNumber(tokens, /--control-touch-h:\s*(\d+)px/, 'touch floor');
expect(tokens).toMatch(/--control-max-h:\s*40px;/);
// responsive.css raises EVERY bare button to the touch floor on coarse pointers
// at any width — the worst-case run must budget against it.
expect(read('src/styles/responsive.css')).toMatch(
  /@media \(pointer: coarse\)[\s\S]*?:is\(#root, body\) button,[\s\S]*?min-width: var\(--control-touch-h\)/,
);
const actionsGap = matchNumber(tableCss, /\.row-actions\s*\{[^}]*gap:\s*(\d+)px/, 'row-actions gap');
const cellPaddingX = matchNumber(recordTableCss, /\.record-table tbody td\s*\{[^}]*padding:\s*\d+px (\d+)px/, 'record-table td padding');
expect(compactH).toBeLessThanOrEqual(touchH);

// The worst-case `.row-actions` run inside one action cell: two square buttons at
// the coarse-pointer floor plus the flex gap.
const worstCaseRun = 2 * touchH + actionsGap;

// SIL-467 (owner directive 24/10): the TRẠNG THÁI column is gone — the board is
// Khách hàng / Mã · Tên / Tuyến / Địa chỉ · Liên hệ at percentage shares plus a
// fixed-px action column. SIL-650 (id 755): the action column has ONE width
// source — the colgroup col is 120px and the th/td hint is 120px, so no engine's
// fixed-layout col-vs-cell precedence can resolve the column differently and
// drift the whole board's shares. With the 1000px table floor retired (the
// overflow driver the owner photographed), the run budget is now held at EVERY
// canvas width, not just at the old floor.
const factoriesColShares = (factoriesSource.match(/\{\[([0-9,\s]+)\]\.map\(\(width, index\)/)?.[1] ?? '')
  .split(',').map((share) => Number(share.trim()));
const factoriesActionColPx = matchNumber(factoriesSource, /<col style=\{\{ width: (\d+) \}\} \/>/, 'factories action col');
const factoriesFloorZero = configPageCss.match(/\.factories-table \{ min-width: 0; table-layout: fixed/)?.[0];
const factoriesActionBudget = factoriesActionColPx - 2 * cellPaddingX;

describe('config table action/status cells keep their budgets (glyph-bleed class)', () => {
  it('factories board holds its 4 percentage shares plus the fixed action column after SIL-467+SIL-650', () => {
    expect(factoriesColShares).toHaveLength(4);
    // The four data shares leave exactly the fixed action column's worth of
    // budget at the old 1000px floor canvas — percentages own the rest.
    expect(factoriesColShares.reduce((a, b) => a + b, 0)).toBe(88);
  });

  it('factories carries NO min-width floor — the overflow driver is gone (SIL-650)', () => {
    expect(factoriesFloorZero).toBeTruthy();
  });

  it('factories action column holds the worst-case row-action run at EVERY canvas width', () => {
    // AC1 + AC2 — the col is a fixed px, so the budget no longer depends on the
    // table width: if the run fits its frozen cell at one canvas it fits at all
    // of them, and the flex overflow that bled the Pencil onto its neighbour is
    // impossible (no overflow:hidden anywhere — design law §4 bans clipping
    // fixes).
    expect(factoriesActionBudget).toBeGreaterThanOrEqual(worstCaseRun);
  });

  it('factories px width hints agree with the col — ONE width source (SIL-650)', () => {
    // Fixed layout reads the <col> widths first (CSS 2.1 §17.5.2.2), but the
    // th/td px hints are a second width source and engines disagree on the
    // winner — that disagreement is what drifted the board on the owner's
    // browser. Col and hint must be the SAME number so either answer wins
    // identically.
    const headerActionPx = matchNumber(configPageCss, /\.factories-table thead th:nth-child\(5\),\n\.factories-table td\.record-table__action \{ width: (\d+)px/, 'factories action hint');
    expect(headerActionPx).toBe(factoriesActionColPx);
    expect(headerActionPx - 2 * cellPaddingX).toBeGreaterThanOrEqual(worstCaseRun);
  });

  it('factories desktop band cannot re-aim overflow at the status cell', () => {
    // Belt-and-braces on the mechanism itself: `safe` falls back to flex-start
    // under overflow, so any future run growth spills toward the table's right
    // edge (clipped by .table-scroll) instead of over the TRẠNG THÁI pill.
    // Scoped to the desktop band — the ≤1100px card band's absolute 44px action
    // box intentionally spills into the Tên cell's reserved 48px gutter.
    expect(configPageCss).toMatch(
      /@container \(min-width: 1101px\)[\s\S]*?\.factories-table \.row-actions \{[\s\S]*?justify-content: safe flex-end;/,
    );
  });

  it('routes action cell holds the worst-case run wherever the table freezes widths', () => {
    // AC3 instance — the routes 680–1100px window band is table-layout: fixed
    // (config-page.css) with the same .row-actions run; the desktop band is
    // auto-layout and self-heals. Every width the actions cell declares must
    // clear the coarse-pointer run or its Pencil bleeds onto the neighbouring
    // Ghi chú / Khoảng cách cell.
    const widths = [...routesCss.matchAll(/td\.routes-table__actions-cell \{ width: (\d+)px; \}/g)]
      .map((match) => Number(match[1]));
    expect(widths.length).toBeGreaterThanOrEqual(2);
    for (const width of widths) {
      expect(width - 2 * cellPaddingX).toBeGreaterThanOrEqual(worstCaseRun);
    }
  });
});
