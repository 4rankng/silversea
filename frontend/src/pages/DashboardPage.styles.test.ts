import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/DashboardPage.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/DashboardPage.tsx'), 'utf8');

describe('dashboard introduction wrapping — DASH-POLISH-001', () => {
  it('keeps highlighted comparisons in the prose flow with an explicit visual gap', () => {
    expect(css).toMatch(/\.dash-wf \.wf-sum__change\s*\{[^}]*display:\s*inline;[^}]*padding-inline-start:\s*0\.15em;[^}]*line-height:\s*inherit;/);
    expect(source).toContain('className="wf-sum__change wf-sum__change--positive"');
    expect(source).toContain('className="wf-sum__change wf-sum__change--negative"');
  });

  it('allows the summary column and long account names to wrap beside the actions', () => {
    expect(css).toMatch(/\.dash-wf \.wf-head__copy\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.dash-wf \.wf-head \.wf-sum\s*\{[^}]*line-height:\s*1\.55;[^}]*overflow-wrap:\s*anywhere;/);
  });

  it('shows the actual revenue and describes a zero comparison baseline explicitly', () => {
    expect(source).toContain('<b>{formatNumber(revenue)} ₫</b>');
    expect(source).toContain("revenueMoM === 'Mới' ? 'Tháng trước chưa có doanh thu'");
    expect(source).not.toContain("có doanh thu{' '}");
  });
});
