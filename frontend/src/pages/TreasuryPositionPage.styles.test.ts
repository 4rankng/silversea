import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

/**
 * Treasury density contract — the Sổ quỹ / Ngân hàng page rides the shared
 * operational sizing (record-table + --ops-table-* tokens from /dispatch),
 * never a private font scale. See docs/design-guidelines.md.
 */
describe('treasury position page density contract', () => {
  const pageCss = read('src/pages/TreasuryPositionPage.css');
  const pageTsx = read('src/pages/TreasuryPositionPage.tsx');

  it('renders records through the shared record-table base, not a private list', () => {
    expect(pageTsx).toContain("import '../styles/record-table.css'");
    expect(pageTsx).toContain("import '../styles/operational-table-typography.css'");
    expect(pageTsx).toMatch(/record-table ops-table treasury-table/);
    expect(pageTsx).not.toContain('WorkflowFinance.css');
  });

  it('maps every text size onto the global operational tokens', () => {
    expect(pageCss).toMatch(/font-size:\s*var\(--ops-table-/);
    // The 20px KPI rail that used --fs-xl is retired: the summary strip is the
    // shared SummaryRail, so this sheet carries no per-route display size.
    expect(pageCss).not.toMatch(/font-size:\s*var\(--fs-xl\)/);
    expect(pageCss).not.toMatch(/font-size:\s*\d+px/);
  });

  it('leaves the numeric type treatment to the shared table base', () => {
    // The outer labelled record must wrap the label separately from the
    // atomic money. Otherwise a negative balance escapes a phone fact cell.
    expect(pageCss).not.toMatch(/\.treasury-table td\.num\s*\{\s*white-space:\s*nowrap;/);
    // P2-05 (audit 2026-11-27): the Sổ quỹ ledger's NGÀY token is atomic —
    // the ban above covers only .num cells.
    expect(pageCss).toMatch(/\.treasury-table td\[data-label='Ngày'\]\s*\{\s*white-space:\s*nowrap;\s*min-width:\s*96px;\s*\}/);
    for (const field of ['openingBalance', 'totalIn', 'totalOut', 'bookBalance']) {
      expect(pageTsx).toContain(`<span className="data-token">{formatCurrency(account.${field})}</span>`);
    }
    expect(pageCss).not.toMatch(/font-family:\s*var\(--font-data\)/);
    expect(pageCss).not.toMatch(/tabular-nums/);
  });

  it('delegates the summary strip, the loading state and the notices to the shared primitives', () => {
    expect(pageTsx).toMatch(/<SummaryRail\s/);
    expect(pageTsx).toMatch(/<SkeletonTable\s/);
    expect(pageTsx).toMatch(/<Alert\b/);
    // Retired, not renamed — a future edit may not reintroduce either.
    expect(pageTsx).not.toMatch(/treasury-(rail|notice)/);
    expect(pageCss).not.toMatch(/treasury-(rail|notice)/);
  });

  it('retires the card-row scaffold from the shared finance sheet', () => {
    const sharedCss = read('src/pages/WorkflowFinance.css');
    // The whole card-row family (rows, money grids, pills, toolbar) died with
    // the record-table migration; only notice/form/summary/profitability live.
    expect(sharedCss).not.toContain('workflow-row');
    expect(sharedCss).not.toContain('workflow-money');
    expect(sharedCss).not.toContain('workflow-pill');
    expect(sharedCss).not.toContain('workflow-toolbar');
    expect(sharedCss).not.toContain('workflow-choice');
  });
});

/**
 * Sổ quỹ đối soát (ticket 18/11 Task 3.5a) — the fund reconciliation strip:
 * Quỹ tiền mặt (CASH) vs Quỹ tài khoản ngân hàng (BANK) side-by-side, closed
 * by the đối soát line. It rides the same record-table base as the account
 * sheet — the same density contract, no private card or font scale.
 */
describe('treasury fund reconciliation strip contract (ticket 18/11 Task 3.5a)', () => {
  const pageCss = read('src/pages/TreasuryPositionPage.css');
  const pageTsx = read('src/pages/TreasuryPositionPage.tsx');

  it('renders the strip through the shared record-table base, not a private card', () => {
    expect(pageTsx).toContain('aria-label="Đối soát quỹ"');
    const strip = pageTsx.slice(pageTsx.indexOf('Đối soát quỹ'), pageTsx.indexOf('Danh sách tài khoản ghi sổ'));
    expect(strip).toContain('record-table ops-table treasury-table');
    expect(strip).not.toMatch(/treasury-recon__card|treasury-recon-grid/);
  });

  it('keeps the strip type on the operational tokens', () => {
    expect(pageCss).toMatch(/\.treasury-recon__title\s*\{[^}]*font-size:\s*var\(--ops-table-supporting-size\)/s);
    expect(pageCss).toMatch(/\.treasury-table__recon-note\s*\{[^}]*font-size:\s*var\(--ops-table-meta-size\)/s);
    expect(pageCss).not.toMatch(/treasury-recon[^}]*(font-size:\s*var\(--fs-|font-size:\s*\d+px)/s);
  });

  it('labels the four nguồn tiền (K6.17) and the Tiền mặt − Ngân hàng đối soát line', () => {
    expect(pageTsx).toContain("'Quỹ tiền mặt'");
    expect(pageTsx).toContain("'Quỹ công ty'");
    expect(pageTsx).toContain("'Quỹ tài khoản ngân hàng ACB chuyên hoàn cược'");
    expect(pageTsx).toContain("'Quỹ tạm ứng của giao nhận'");
    expect(pageTsx).toContain('Đối soát (Tiền mặt − Ngân hàng)');
    // The deltas render from the read projection, never recomputed client-side.
    expect(pageTsx).toContain('data.fundBreakdown.inDelta');
    expect(pageTsx).toContain('data.fundBreakdown.outDelta');
    expect(pageTsx).toContain('data.fundBreakdown.balanceDelta');
  });
});
