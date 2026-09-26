import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260926_10 (CHIEF spec groups 1/4/6): missing-value text renders as
// one muted italic voice — never bold; the date-shortcut group carries a
// 'Thời gian' label; Xóa lọc disables with no active filters; the pager sits
// under a 1px rule.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('detail-overhaul missing-value + filter-group contract (card 20260926_10)', () => {
  it('missing-value line class renders 13px gray italic, not bold', () => {
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    const rule = css.match(/\.detailed-plan-grid__line--missing\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('font-style: italic');
    expect(rule).toContain('color: var(--ink-3');
    expect(rule).not.toMatch(/font-weight:\s*(6|7|8)00/);
  });

  it('filters carry the Thời gian group label and a disabled-aware clear', () => {
    const src = read('src/features/dispatch/detailed-plan/DetailedPlanFilters.tsx');
    expect(src).toContain('Thời gian');
    expect(src).toContain('hasActiveFilters');
  });

  it('grid footer pager sits under a 1px top rule', () => {
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/detailed-plan-grid__footer\s*\{[^}]*border-top:\s*1px solid/);
  });
});
