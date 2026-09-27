import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260926_50 — two-tier 80px header lock. Row 1 (36px): title +
 * preset segment directly adjacent to the 220px dual-calendar range trigger.
 * Row 2 (32px): one continuous ribbon (search 260, Khách w-180, inline-label
 * selects, Xóa lọc at the tail). Flat chrome throughout — no shadows.
 */

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

describe('DetailedPlanGrid two-tier header regression guard (card 20260926_50)', () => {
  it('row 1 is a locked 36px flex row carrying title, preset segment and range trigger', () => {
    const header = css.match(/\.detailed-plan-header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(header).toMatch(/display:\s*flex;/);
    expect(header).toMatch(/height:\s*36px;/);
  });

  // Operator ruling 2026-09-27 ("this is our existing working button group and
  // I like it, please use this consistently globally"): the date scope is the
  // shared `ds-tabs--boxed` group. The page owns layout only — a bespoke
  // segment shape must not come back.
  it('the date scope is the shared button group inside row 1, with layout-only page CSS', () => {
    const header = css.match(/\.detailed-plan-header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(header).toMatch(/gap:\s*10px;/);
    const segment = css.match(/\.detailed-plan-header__date\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(segment).toMatch(/display:\s*inline-flex;/);
    expect(segment).not.toMatch(/border:\s*1px/);
    expect(segment).not.toMatch(/border-radius/);
    expect(css).not.toMatch(/\.detailed-plan-header__preset/);
    const primitive = readFileSync(resolve(__dirname, '../../../design-system/Tabs.css'), 'utf8');
    expect(primitive).toMatch(/\.ds-tabs--boxed \{[^}]*border:\s*1px solid var\(--line\);/);
    expect(primitive).toMatch(/\.ds-tabs--boxed \.ds-tabs__btn--active \{[^}]*outline:\s*1px solid var\(--line-2/);
  });

  // Superseded by the 2026-09-27 operator ruling ("why don't we group them in
  // bộ lọc"): the ribbon is the search plus the action cluster, and the four
  // quick facets live in the drawer. The guard now pins THAT, so a later
  // session cannot quietly restore the stacked-dropdown header.
  it('row 2 is one continuous 32px ribbon — search plus the action cluster, no facet grid', () => {
    const ribbon = css.match(/\.detailed-plan-ribbon\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(ribbon).toMatch(/display:\s*flex;/);
    expect(ribbon).toMatch(/min-height:\s*32px;/);
    expect(ribbon).toMatch(/gap:\s*8px;/);
    const search = css.match(/\.detailed-plan-ribbon__search\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(search).toMatch(/width:\s*260px;/);
    expect(css).not.toMatch(/\.detailed-plan-ribbon__quick/);
    expect(css).not.toMatch(/\.detailed-plan-ribbon__customer/);
    const actions = css.match(/\.detailed-plan-ribbon__actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(actions).toMatch(/display:\s*flex;/);
    expect(actions).toMatch(/gap:\s*8px;/);
    const clear = css.match(/\.detailed-plan-filters__clear\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(clear).toMatch(/margin-left:\s*0;/);
    const panel = css.match(/\.detailed-plan-filter-panel__quick\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(panel).toMatch(/display:\s*grid;/);
  });

  it('no elevated panel chrome on the new rows (flat law)', () => {
    const header = css.match(/\.detailed-plan-header\s*\{([^}]*)\}/)?.[1] ?? '';
    const ribbon = css.match(/\.detailed-plan-ribbon\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(header).not.toMatch(/box-shadow/);
    expect(ribbon).not.toMatch(/box-shadow/);
  });
});
