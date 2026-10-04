import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20261004_335 — width-budget residuals of the fixed-column action-run
// bleed class (cards 20261004_324 / 20261004_331). 331's shared
// `justify-content: safe flex-end` (components/Table.css) stops the run painting
// LEFT over the neighbour cell, but two frozen action columns still budgeted
// less than the run itself: `/suppliers` colgroup 60px (36px content vs a 66px
// fine / 86px coarse run) and `/customers` colgroup 80px (56px content). The
// run kept its start edge in-cell and hung 10-50px past the TABLE's right edge.
//
// These contracts pin the 324-style budget: the frozen action column must admit
// the worst-case run at the coarse-pointer 40px button floor (2 square
// `--control-touch-h` buttons + the `.row-actions` gap + 2× record-table cell
// padding), computed from the REAL shared contracts — not restated literals.
// The grant lives ONLY in colgroup/th width sources (the ones the shared
// record-table card band hides), so the ≤1100px record-card band and the ≤820px
// mobile card list cannot see it; and it must never squeeze a declared width
// set narrower than the table (fixed-layout squeeze — /accounting/phoi-phieu's
// "57px needles", 2026-09-29 ruling) nor starve a data token of its one-line
// width (table law: wrap, never truncate).

function read(relativePath: string) {
  const direct = resolve(process.cwd(), relativePath);
  if (existsSync(direct)) return readFileSync(direct, 'utf8');
  return readFileSync(resolve(process.cwd(), 'frontend', relativePath), 'utf8');
}

function matchNumber(source: string, pattern: RegExp, label: string): number {
  const value = Number(source.match(pattern)?.[1]);
  expect(Number.isFinite(value), `${label}: ${pattern}`).toBe(true);
  return value;
}

const tokens = read('src/styles/tokens.css');
const tableCss = read('src/components/Table.css');
const recordTableCss = read('src/styles/record-table.css');
const responsiveCss = read('src/styles/responsive.css');
const suppliersSource = read('src/pages/SupplierListPage.tsx');
const customersSource = read('src/pages/CustomersPage.tsx');
const suppliersCss = read('src/pages/SupplierListPage.css');
const customersCss = read('src/pages/CustomersPage.css');

// ── Shared geometry the budgets are derived from (card 324 idiom) ──────────
const compactH = matchNumber(tokens, /--control-compact-h:\s*(\d+)px/, 'compact control');
const touchH = matchNumber(tokens, /--control-max-h:\s*(\d+)px/, 'touch control ceiling');
expect(tokens).toContain('--control-touch-h: var(--control-max-h)');
// responsive.css raises EVERY bare button to the touch floor's min-width on
// coarse pointers at any width — the worst-case run must budget against it.
expect(responsiveCss).toMatch(
  /@media \(pointer: coarse\)[\s\S]*?:is\(#root, body\) button,[\s\S]*?min-width: var\(--control-touch-h\)/,
);
expect(compactH).toBeLessThanOrEqual(touchH);
const actionsGap = matchNumber(tableCss, /\.row-actions\s*\{[^}]*gap:\s*(\d+)px/, 'row-actions gap');
const cellPaddingX = matchNumber(recordTableCss, /\.record-table tbody td\s*\{[^}]*padding:\s*\d+px (\d+)px/, 'record-table td padding');

// A `.row-actions` run of two square buttons inside one action cell.
const fineRun = 2 * compactH + actionsGap;
const worstCaseRun = 2 * touchH + actionsGap;

// ── Card-band/table-mode boundary, derived from the shared band ────────────
// The shared record table becomes record cards at `@container (max-width: N)`
// and hides `colgroup, thead` there — so the fixed-column budgets only exist
// above the largest such N, and width grants placed in colgroup/th are
// invisible to the card band.
const cardBandMax = Math.max(
  ...[...recordTableCss.matchAll(/@container \(max-width: (\d+)px\)/g)].map((m) => Number(m[1])),
);
expect(Number.isFinite(cardBandMax)).toBe(true);
const tableModeFloor = cardBandMax;
expect(recordTableCss).toMatch(
  /\.record-table colgroup,\s*\.record-table thead \{\s*display: none;/,
);

// ── Parsers for the two TSX width sources ─────────────────────────────────
type ColWidth = { kind: 'pct' | 'px' | 'auto'; value: number };

function parseColgroup(source: string, anchor: string): ColWidth[] {
  const block = source.match(new RegExp(`${anchor}[\\s\\S]*?<colgroup>([\\s\\S]*?)</colgroup>`))?.[1];
  expect(block, `${anchor}: colgroup`).toBeTruthy();
  return [...block!.matchAll(/<col\b[^>]*>/g)].map((tag) => {
    const width = tag[0].match(/width: '?([\d.]+)(%)?'?/);
    if (!width) return { kind: 'auto' as const, value: 0 };
    return { kind: width[2] ? ('pct' as const) : ('px' as const), value: Number(width[1]) };
  });
}

function actionThWidthHint(source: string): number | null {
  // The action column is the last `<th>` of the first thead row — its px hint
  // is the fixed layout's second width source (CSS 2.1 §17.5.2.2); both
  // sources must clear the budget (card 324 pinned the same pair).
  const head = source.match(/<thead>[\s\S]*?<tr>([\s\S]*?)<\/tr>/)?.[1] ?? '';
  const ths = [...head.matchAll(/<th\b[^>]*>/g)].map((m) => m[0]);
  expect(ths.length, 'thead row has an action th').toBeGreaterThan(0);
  const hint = ths[ths.length - 1].match(/width: (\d+)/);
  return hint ? Number(hint[1]) : null;
}

// Single-line data-token floors at the cell's data role (12px), tabular mono
// ≈ 0.6em advance: "1.350.000 ₫" = 11 chars, a VN tax code ≤ 13, a spaced
// phone "0912 345 678" = 12. The table law is wrap-not-truncate, but a token
// that no longer fits its column shreds mid-value — these floors keep the
// token columns honest at the 1100px table-mode floor.
const dataSize = matchNumber(tokens, /--text-data-size:\s*(\d+)px/, 'data text size');
const dataCharPx = dataSize * 0.6;
const moneyTokenChars = '1.350.000 ₫'.length;
const taxTokenChars = 13;
const phoneTokenChars = '0912 345 678'.length;

describe('supplier/customer action columns keep their width budgets (action-column width class)', () => {
  it('suppliers action column holds the worst-case row-action run at every width source', () => {
    const cols = parseColgroup(suppliersSource, 'suppliers-page__grid');
    expect(cols).toHaveLength(8);
    const actionCol = cols[cols.length - 1];
    // AC1 — px budget, not a share: a frozen px column is what the run must
    // fit in; content = column − 2× cell padding.
    expect(actionCol.kind).toBe('px');
    expect(actionCol.value - 2 * cellPaddingX).toBeGreaterThanOrEqual(fineRun);
    expect(actionCol.value - 2 * cellPaddingX).toBeGreaterThanOrEqual(worstCaseRun);
    // Second width source: the action th hint must clear the same budget.
    const hint = actionThWidthHint(suppliersSource);
    expect(hint).not.toBeNull();
    expect(hint! - 2 * cellPaddingX).toBeGreaterThanOrEqual(worstCaseRun);
  });

  it('suppliers declared widths fit the table-mode floor so the budget cannot be squeezed away', () => {
    // Fixed-layout squeeze (2026-09-29 ruling): when declared column widths
    // exceed the table width the columns shrink proportionally — a 112px
    // grant declared beside 92% of shares is only worth ~109.6px at the
    // 1100px floor (85.6px content < 86px run). The declared set must fit.
    const cols = parseColgroup(suppliersSource, 'suppliers-page__grid');
    const declaredAtFloor = cols.reduce(
      (sum, col) => sum + (col.kind === 'pct' ? (col.value / 100) * tableModeFloor : col.value),
      0,
    );
    expect(declaredAtFloor).toBeLessThanOrEqual(tableModeFloor);
  });

  it('suppliers token columns keep one-line widths for tax code, phone and money at the floor', () => {
    // AC2 no-truncation — the grant is funded by rebalancing wrap-yield text
    // columns, never by starving a token column below its single-line width.
    const cols = parseColgroup(suppliersSource, 'suppliers-page__grid');
    const widthAtFloor = (col: ColWidth) =>
      col.kind === 'pct' ? (col.value / 100) * tableModeFloor : col.value;
    const [tax, phone, money] = [cols[3], cols[5], cols[6]];
    expect(widthAtFloor(tax) - 2 * cellPaddingX).toBeGreaterThanOrEqual(taxTokenChars * dataCharPx);
    expect(widthAtFloor(phone) - 2 * cellPaddingX).toBeGreaterThanOrEqual(phoneTokenChars * dataCharPx);
    expect(widthAtFloor(money) - 2 * cellPaddingX).toBeGreaterThanOrEqual(moneyTokenChars * dataCharPx);
  });

  it('customers action column holds the worst-case row-action run at every width source', () => {
    const cols = parseColgroup(customersSource, '<table className="record-table ops-table"');
    expect(cols).toHaveLength(7);
    const actionCol = cols[cols.length - 1];
    expect(actionCol.kind).toBe('px');
    expect(actionCol.value - 2 * cellPaddingX).toBeGreaterThanOrEqual(fineRun);
    expect(actionCol.value - 2 * cellPaddingX).toBeGreaterThanOrEqual(worstCaseRun);
    const hint = actionThWidthHint(customersSource);
    expect(hint).not.toBeNull();
    expect(hint! - 2 * cellPaddingX).toBeGreaterThanOrEqual(worstCaseRun);
  });

  it('customers grant is funded without costing the identity column any width', () => {
    // AC2 no-truncation — the customers table keeps ONE auto column (the
    // wrapping identity column) absorbing the remainder. The pre-card fixed
    // width set summed to 808px; if the grant grows that sum, the auto column
    // narrows at every width and the name cell's ellipsis point moves earlier.
    // The grant is funded from the wrap-yield contact column instead.
    const customersBaselineFixedSum = 808;
    const cols = parseColgroup(customersSource, '<table className="record-table ops-table"');
    expect(cols.filter((col) => col.kind === 'auto')).toHaveLength(1);
    expect(cols[1].kind).toBe('auto');
    const fixedSum = cols.reduce((sum, col) => sum + (col.kind === 'px' ? col.value : 0), 0);
    expect(fixedSum).toBeLessThanOrEqual(customersBaselineFixedSum);
    // The funded-from contact column still fits its phone token on one line.
    const contact = cols[3];
    expect(contact.kind).toBe('px');
    expect(contact.value - 2 * cellPaddingX).toBeGreaterThanOrEqual(phoneTokenChars * dataCharPx);
  });

  it('neither page clips or truncates its action-run cell', () => {
    // AC2 — belt on the mechanism: the run yields by fitting its column, and
    // if it ever outgrows it `safe flex-end` spills toward the table edge —
    // never a clipping/ellipsis fix on the run (design law §4).
    for (const css of [suppliersCss, customersCss]) {
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1];
        if (!/row-actions|row-action|actions-cell|cell--actions/.test(selector)) continue;
        expect(rule[2]).not.toMatch(/overflow:\s*(hidden|clip)|text-overflow:\s*ellipsis/);
        // No CSS width on the action cell: in the card band the td is a grid
        // item and a width declaration would shrink it inside the card — the
        // budget lives in colgroup/th, which the shared band hides. (If a
        // future edit moves it to CSS it must be scoped `@container
        // (min-width: …)` above this floor.)
        expect(rule[2]).not.toMatch(/width:/);
      }
    }
  });
});
