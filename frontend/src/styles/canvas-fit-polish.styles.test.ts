import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/* Responsive-polish wave: wide operational tables switch to their record/card
   view before the ~1112px laptop canvas would force an internal scroll, and
   touch filter strips wrap instead of swiping. */
describe('canvas-fit responsive polish contract', () => {
  it('recoverable-costs shows record cards below 1500px instead of scrolling the 1540px ledger', () => {
    const css = read('src/features/recoverable-costs/RecoverableCostsWorkspace.css');
    expect(css).toContain('@media(max-width:1500px){.recoverable-costs__ledger{display:none}');
    expect(css).not.toContain('@media(max-width:1199px)');
  });

  it('workflow profitability table becomes labelled records below 1500px', () => {
    const css = read('src/pages/WorkflowFinance.css');
    expect(css).toContain('@media(max-width:1500px){.workflow-profitability__table{border:0}');
    expect(css).not.toContain('@media(max-width:1150px)');
  });

  it('role work inbox cards render below the 1050px-table canvas threshold', () => {
    const css = read('src/components/work-inbox/RoleWorkInbox.css');
    expect(css).toMatch(/@media \(max-width: 1345px\) \{\s*\.role-work-inbox__table-wrap \{ overflow: visible;/);
    expect(css).toContain('.role-work-inbox__tabs { flex-wrap: wrap; gap: 6px; }');
  });

  it('finance truck-trip table compresses instead of scrolling below 1345px', () => {
    const css = read('src/pages/FinancePage.css');
    expect(css).toContain('@media (max-width: 1345px) {\n  .truck-trip-table { min-width: 0; }');
  });

  it('debt-detail filters wrap and the accounting ledger stacks with Nợ/Có labels on phones', () => {
    const css = read('src/pages/DebtDetailPage.css');
    expect(css).not.toMatch(/\.dd-filters[^{]*\{[^}]*overflow-x: auto/);
    expect(css).toContain(`.dd-accounting-row > :nth-child(4)::before { content: 'Nợ'; }`);
    expect(css).toContain(`.dd-accounting-row > :nth-child(5)::before { content: 'Có'; }`);
  });

  it('trip-list pagination wraps instead of swiping on phones', () => {
    const css = read('src/pages/trip-list/responsive.css');
    expect(css).toContain('.trip-list-page .pagination {\n    justify-content: center;\n    flex-wrap: wrap;');
  });

  it('payables category chips wrap without the swipe fade mask', () => {
    const css = read('src/pages/PayableListPage.css');
    expect(css).toContain('.payables-page .payables-category-chips {\n    gap: 6px;\n    flex-wrap: wrap;');
    expect(css).not.toContain('mask-image: linear-gradient(90deg, #000 calc(100% - 28px)');
  });
});
