import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260927_152 — /dispatch-detail's filter plane is the SHARED strip.
 *
 * The screen used to declare its own two-tier 80px header and its own ribbon
 * (card 20260926_50: a 36px flex row, a 260px search shell, a hand-rolled range
 * trigger, a drawer trigger with its own count badge). The operator's ruling of
 * 2026-09-27 replaced every page-local filter plane with one law: the strip is
 * `ListFilterBar`, the criteria a list does not share live in `FilterDropdown`,
 * and the page declares NO filter layout at all.
 *
 * These guards hold the cutover and `DetailedPlanGrid.css`'s DELETED note: a
 * re-added `display:flex`, width floor or `grid-column` on the strip is the
 * regression the operator photographed ("some control the value very short but
 * why the fuck it does take full row").
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
const tsx = read('src/features/dispatch/detailed-plan/DetailedPlanFilters.tsx');

describe('DetailedPlanFilters rides the shared strip (card 20260927_152)', () => {
  it('mounts the shared bar, its search slot and the shared Bộ lọc dropdown', () => {
    expect(tsx).toContain('<ListFilterBar');
    expect(tsx).toContain('<FilterDropdown');
    expect(tsx).toContain('<DateRangeFields');
    expect(tsx).toContain('ariaLabel="Khoảng ngày vận chuyển"');
    // The day scope is the shared boxed button group (operator ruling
    // 2026-09-27: one segmented shape app-wide), and the from/to group is the
    // one shared two-field control — never a range picker, never a page-local
    // pair.
    expect(tsx).toContain('variant="boxed"');
    expect(tsx).not.toContain('DateRangePopover');
    expect(tsx).not.toContain('DateRangePresetSelect');
    // No page-owned trigger, badge, search shell or drawer.
    expect(tsx).not.toContain('detailed-plan-ribbon');
    expect(tsx).not.toContain('detailed-plan-filters__count');
    expect(tsx).not.toContain('<Drawer');
  });

  it('keeps the panel — and its quick-facet group — as the dialog body (the lock selectors)', () => {
    // `design-lock/expectations/dispatch.mjs` opens `Bộ lọc` by clicking the
    // first `/^Bộ lọc/` button and then asserts `.detailed-plan-filter-panel__quick`
    // is visible inside the dialog; both selectors must keep resolving.
    expect(tsx).toContain('detailed-plan-filter-panel__quick');
    expect(css).toMatch(/^\.detailed-plan-filter-panel \{[^}]*display:\s*grid/m);
    expect(css).toMatch(/\.detailed-plan-filter-panel__quick\s*\{[^}]*display:\s*grid/);
    // Xóa lọc stays a rendered bar action under its locked class.
    expect(tsx).toContain('detailed-plan-filters__clear');
    expect(css).toContain('.detailed-plan-filters__clear.is-idle');
  });

  it('declares no strip layout of its own — no ribbon rules, no header row slot, no control width', () => {
    // Rule blocks (line-start selectors), not prose: the DELETED note above
    // names the retired selectors on purpose.
    expect(css).not.toMatch(/^\.detailed-plan-ribbon/m);
    expect(css).not.toMatch(/^\.detailed-plan-header__(?:row|date|range|assign)/m);
    expect(css).not.toMatch(/^\.(?:drawer\.)?detailed-plan-filter-drawer/m);
    expect(css).not.toMatch(/^\.detailed-plan-filters__(?:count|select|hour)\s*\{/m);
    // No page rule gives a filter control a fixed width or a stretch.
    expect(css).not.toMatch(/^\.detailed-plan-filters__field\s*\{[^}]*min-width:\s*\d+px/m);
    expect(css).not.toMatch(/^\.detailed-plan-filters__(?:field|points|hour-inputs)[^{]*\{[^}]*width:\s*100%/m);
    // The page chrome left is the title row, and it is layout-free.
    const header = css.match(/\.detailed-plan-header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(header).not.toBe('');
    expect(header).not.toMatch(/display:\s*(?:flex|grid)/);
    expect(header).not.toMatch(/(?:^|;)\s*(?:width|min-width|height)\s*:/);
    expect(header).not.toMatch(/box-shadow/);
  });

  it('keeps the shared button group the only segment shape (no bespoke segment CSS)', () => {
    expect(css).not.toMatch(/\.detailed-plan-header__preset/);
    const primitive = read('src/design-system/Tabs.css');
    expect(primitive).toMatch(/\.ds-tabs--boxed \{[^}]*border:\s*1px solid var\(--line\);/);
    expect(primitive).toMatch(/\.ds-tabs--boxed \.ds-tabs__btn--active \{[^}]*outline:\s*1px solid var\(--line-2/);
  });
});
