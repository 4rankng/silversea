import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

/**
 * Treasury density contract — the Sổ quỹ / ngân hàng page rides the shared
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
    // .record-table .num owns --font-data and the right edge; the page only
    // stops the money cells from wrapping.
    expect(pageCss).toMatch(/\.treasury-table td\.num\s*\{\s*white-space:\s*nowrap;/);
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
