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

  it('the preset segment is a 32px joined grid directly inside row 1 (adjacent to the trigger)', () => {
    const header = css.match(/\.detailed-plan-header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(header).toMatch(/gap:\s*10px;/);
    const segment = css.match(/\.detailed-plan-header__date\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(segment).toMatch(/height:\s*32px;/);
    expect(segment).toMatch(/display:\s*inline-grid;/);
  });

  it('row 2 is one continuous 32px ribbon — search 260px, Khách 180px, Xóa lọc pinned right', () => {
    const ribbon = css.match(/\.detailed-plan-ribbon\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(ribbon).toMatch(/display:\s*flex;/);
    expect(ribbon).toMatch(/height:\s*32px;/);
    expect(ribbon).toMatch(/gap:\s*8px;/);
    const search = css.match(/\.detailed-plan-ribbon__search\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(search).toMatch(/width:\s*260px;/);
    const customer = css.match(/\.detailed-plan-ribbon__customer\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(customer).toMatch(/width:\s*180px;/);
    const clear = css.match(/\.detailed-plan-filters__clear\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(clear).toMatch(/margin-left:\s*auto;/);
  });

  it('no elevated panel chrome on the new rows (flat law)', () => {
    const header = css.match(/\.detailed-plan-header\s*\{([^}]*)\}/)?.[1] ?? '';
    const ribbon = css.match(/\.detailed-plan-ribbon\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(header).not.toMatch(/box-shadow/);
    expect(ribbon).not.toMatch(/box-shadow/);
  });
});
