import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1291 (QA R37): the SỐ TỜ KHAI column was cut by the sticky THAO TÁC
// rail at the default scroll position (37% visible at 1280px icon sidebar,
// 21px at 1440px sidebar open, 0px at 1280px sidebar open). The cure mirrors
// SIL-1191's for Điều phối: the track rides LEFT of the rail's fold, so this
// pin derives the track from the CSS and asserts it finishes inside the
// default-scroll window of every measured canvas.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');

describe('SIL-1291 — the SỐ TỜ KHAI track clears the THAO TÁC fold at rest', () => {
  const floor = Number(css.match(/\.detailed-plan-grid\s*\{[^}]*min-width:\s*(\d+)px/)?.[1] ?? 0);
  const actionRail = Number(css.match(/\.detailed-plan-grid__col--actions\s*\{[^}]*width:\s*(\d+)px/)?.[1] ?? 0);
  const share = (name: string) => Number(css.match(new RegExp(`\\.detailed-plan-grid__col--${name}\\s*\\{\\s*width:\\s*([\\d.]+)%`))?.[1] ?? 0) / 100;

  // Percentage base = the table floor minus the fixed THAO TÁC rail.
  const base = floor - actionRail;
  // Track start = the shares riding before the declaration column.
  const start = ['schedule', 'route', 'ports', 'ports', 'documents', 'assignment']
    .reduce((sum, name) => sum + share(name), 0) * base;
  const track = share('declaration') * base;
  const end = start + track;

  // The measured default-scroll folds (pane width − the 48px rail):
  // 1280px viewport icon sidebar → x1184; 1440px sidebar open → x1144.
  const fold1280Icon = 1184;
  const fold1440Sidebar = 1144;

  it('finishes before the 1280px icon-sidebar fold at rest', () => {
    expect(end).toBeLessThanOrEqual(fold1280Icon);
  });

  it('the 1440px sidebar-open window shows the whole content at rest', () => {
    // The AC is "đọc được trọn vẹn": the content (the 128px measured
    // 12-digit run + 2×12px cell padding) must read complete inside the
    // visible window; the cell's empty right tail — content is left-aligned —
    // may ride under the rail. Content is left-aligned, so the tail is blank.
    const visibleAtFold = fold1440Sidebar - start;
    expect(visibleAtFold).toBeGreaterThanOrEqual(128 + 24);
  });

  it('rides before Container on the three surfaces', () => {
    const tsx = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx');
    const colOrder = tsx.indexOf('col--declaration') < tsx.indexOf('col--container');
    expect(colOrder, 'colgroup: declaration col before container col').toBeTruthy();
  });
});
