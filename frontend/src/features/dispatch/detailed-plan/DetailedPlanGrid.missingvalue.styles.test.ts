import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260926_10 groups 4 (missing-value voice) + card 20260926_50: the
// missing-value text renders muted italic — never bold; the _10 'Thời gian'
// label row is superseded (labels live inside the two-tier header controls);
// Xóa lọc stays disabled-aware via hasActiveFilters; pager sits under a 1px
// rule.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('detail-overhaul missing-value + header contract (cards 20260926_10/_50)', () => {
  it('missing-value line class renders 13px gray italic, not bold', () => {
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    const rule = css.match(/\.detailed-plan-grid__line--missing\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('font-style: italic');
    expect(rule).toContain('color: var(--ink-3');
    expect(rule).not.toMatch(/font-weight:\s*(6|7|8)00/);
  });

  it('ribbon filters integrate their labels; Xóa lọc stays disabled-aware', () => {
    const src = read('src/features/dispatch/detailed-plan/DetailedPlanFilters.tsx');
    expect(src).toContain('Khách: Tất cả');
    expect(src).toContain('Hướng');
    expect(src).toContain('hasActiveFilters');
    expect(src).not.toContain('Thời gian');
  });

  it('grid footer pager sits under a 1px top rule', () => {
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/detailed-plan-grid__footer\s*\{[^}]*border-top:\s*1px solid/);
  });
});
