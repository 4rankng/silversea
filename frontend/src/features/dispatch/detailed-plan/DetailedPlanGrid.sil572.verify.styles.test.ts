import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-572 (2026-10-29): the pinned Thao tác rail owns its width inside the
// last scrolling column — the Ghi chú cell reserves one rail-width of
// padding-inline-end so its live note buttons stop before the zone the sticky
// cell covers when the board scrolls. (At full scroll the rail sits over its
// own track and nothing is covered; mid-transit overlap is inherent to a
// pinned rail over a wider board — geometry documented on the ticket.)
const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

describe('pinned Thao tác rail width reservation (SIL-572)', () => {
  it('declares the rail reserve and pays it at the Ghi chú cell edge', () => {
    expect(css).toMatch(/--dpg-actions-reserve:\s*56px;/);
    expect(css).toMatch(
      /\.detailed-plan-grid td\.detailed-plan-grid__cell--notes\s*\{[^}]*padding-inline-end:\s*calc\(var\(--space-sm\) \+ var\(--dpg-actions-reserve\)\);/,
    );
  });
});
