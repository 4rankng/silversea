import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/PayableListPage.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/pages/PayableListPage.tsx'), 'utf8');
// Selector assertions read the RULES, not the prose: the sheet's comment names
// the deleted selectors on purpose (the record of what left and why).
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('payables list filter strip (card 20260927_152)', () => {
  it('renders the shared bar, with the category group as the criterion it owns', () => {
    expect(tsx).toContain('<FilterBar');
    expect(tsx).toContain('quickFilters');
    expect(tsx).toContain("placeholder: 'Tìm nhà cung cấp...'");
    expect(tsx).toContain("ariaLabel: 'Tìm công nợ theo nhà cung cấp'");
    expect(tsx).toContain("inputProps: { name: 'supplierPayableSearch' }");
    // The category group is the shared boxed `Tabs` primitive (operator ruling
    // 2026-09-27: a segmented status group is never a bespoke segment).
    expect(tsx).toMatch(/<Tabs\s+variant="boxed"/);
    expect(tsx).toContain('ariaLabel="Lọc theo loại công nợ"');
    // No secondary criterion exists on this surface, so no `Bộ lọc` trigger.
    expect(tsx).not.toContain('<FilterDropdown');
  });

  it('declares no filter layout and no control width of its own', () => {
    // The page-local toolbar (a flex row with its own gap, a `flex: 1` spacer
    // and a 300px search shell whose input was `width: 100%`, plus a ≤640 band
    // that made the search `width: 100%; order: -1`) is exactly how the
    // operator's 2026-09-27 "why the fuck it does take full row" regression
    // returned twice: a page rule outranks the shared band. The bar owns both.
    // (SIL-470: the summary band's own `flex: 1 1` aging column is page-owned
    // layout of a page component — the ban stays scoped to filter surfaces.)
    expect(rules).not.toMatch(/\.payables-toolbar/);
    expect(rules).not.toMatch(/order\s*:\s*-1/);
    expect(rules).not.toMatch(/\.[a-z-]*(?:toolbar|filter|search)[a-z-]*[^{]*\{[^}]*flex\s*:\s*1 1/);
    // No page-local control height on a filter control (the page-actions button
    // rule keeps its own 44px tap target — that is not a filter surface).
    expect(rules).not.toMatch(/payables-toolbar__search[^{]*\{[^}]*min-height/);
  });

  it('keeps the data card flat — the filter toolbar is the bar\'s own card, not a second surface', () => {
    expect(rules).toMatch(
      /\.payables-data-card\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/,
    );
  });
});

// SIL-470 — data-dense: summary band ≤96px thay rail + 4 aging card; tên NCC
// 1 dòng (truncate + tooltip); sub-line chỉ khi có dữ liệu; 1 cột "Hạn nợ"
// mini stacked bar; row band 44–48px cho hàng 2 dòng.
describe('payables data-dense density (SIL-470)', () => {
  it('styles the summary band as a ≤96px ruled strip (no card chrome)', () => {
    expect(rules).toMatch(
      /\.payables-band\s*\{[^}]*display:\s*flex;[^}]*padding:\s*10px 0;[^}]*border-block:\s*1px solid var\(--line\);/,
    );
    // Band column heights: chips h20 + bar 8 + legend line ≈ 76px + 20 padding.
    expect(rules).toMatch(/\.payables-band__chip\s*\{[^}]*height:\s*20px;/);
    expect(rules).toMatch(/\.payables-band__bar\s*\{[^}]*height:\s*8px;/);
  });

  it('truncates the supplier name to one ~320px line with an ellipsis', () => {
    expect(rules).toMatch(
      /\.payables-supplier-name\s*\{[^}]*max-width:\s*320px;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/,
    );
  });

  it('keeps the aging cell a compact stacked bar with tabular overdue figure', () => {
    expect(rules).toMatch(/\.payables-aging-cell__bar\s*\{[^}]*width:\s*72px;[^}]*height:\s*6px;/);
    expect(rules).toMatch(
      /\.payables-aging-cell__overdue\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/,
    );
  });

  it('tightens the row band toward the 44–48px target', () => {
    expect(rules).toMatch(/\.payables-page \.record-table tbody td \{ padding-block: 7px; \}/);
  });

  it('deleted the aging-card grid CSS with the component (SIL-470)', () => {
    expect(rules).not.toMatch(/\.payables-aging-grid/);
    expect(rules).not.toMatch(/\.aging-card/);
  });
});
