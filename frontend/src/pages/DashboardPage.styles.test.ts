import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/DashboardPage.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/DashboardPage.tsx'), 'utf8');

describe('dashboard introduction wrapping — DASH-POLISH-001', () => {
  it('keeps highlighted comparisons in the prose flow with an explicit visual gap', () => {
    expect(css).toMatch(/\.dash-wf \.wf-sum__change\s*\{[^}]*display:\s*inline;[^}]*padding-inline-start:\s*0\.15em;[^}]*line-height:\s*inherit;/);
    expect(source).toContain("revenueMoM.direction === 'up' ? ' wf-sum__change--positive'");
    expect(source).toContain("revenueMoM.direction === 'down' ? ' wf-sum__change--negative' : ''");
  });

  it('allows the summary column and long account names to wrap beside the actions', () => {
    expect(css).toMatch(/\.dash-wf \.wf-head__copy\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.dash-wf \.wf-head \.wf-sum\s*\{[^}]*line-height:\s*1\.55;[^}]*overflow-wrap:\s*anywhere;/);
  });

  it('shows the actual revenue and describes a zero comparison baseline explicitly', () => {
    expect(source).toContain("const revenue = d?.revenue ?? null;");
    expect(source).toContain("<b>{revenue === null ? '—' : formatNumber(revenue)} ₫</b>");
    expect(source).toContain("revenueMoM.label === 'Mới' && revenue > 0 ? 'Tháng trước chưa có doanh thu'");
    expect(source).toContain('revenue !== null && prevPnlReport && prevRevenue != null');
    expect(source).not.toContain("có doanh thu{' '}");
  });
});

// QA 28/11 wave — fleet card and KPI strip.
describe('dashboard QA 28/11 — fleet scope labels and KPI grid balance', () => {
  it('labels the transit stat with its trip scope (95 trips is not 49 trucks)', () => {
    expect(source).toContain('Chuyến đang chạy');
  });

  it('the narrow KPI grid is a uniform 2-column card grid — no full-width orphan card', () => {
    // The fifth card must never span the strip: five cards in a shared-border
    // strip put it alone on a stretched third row (the QA orphan).
    expect(css).not.toMatch(/\.dash-wf \.wf-kpi:nth-child\(5\)/);
    // Below 1060px the strip dissolves into separate bordered cards, so the
    // odd-count last cell is plain page background, not a border-colored hole.
    expect(css).toMatch(/\.dash-wf \.wf-kpis\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*background:\s*transparent;[^}]*border:\s*0;/);
  });
});
