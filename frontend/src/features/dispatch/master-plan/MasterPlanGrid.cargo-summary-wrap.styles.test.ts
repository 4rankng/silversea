// SIL-1219 (id 1401) — /dispatch 390/360px: the Sản lượng bar kept its
// nowrap stats chips and the right-aligned zone hint in an internal
// overflow rail while the page never scrolls horizontally, so the hint's
// plate number read chopped mid-string ('15H-055' losing '.79'; at 360px
// even the 'Huyện:' label clipped). The ≤640px band lets the bar wrap and
// gives the hint its own full-width line whose text wraps at spaces;
// desktop keeps the single-line advisory strip (card 20260930_246).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SIL-1219 — the cargo summary bar wraps on phones, the zone hint reads whole', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('the phone band wraps the bar and floats the hint to its own line', () => {
    const band = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(band, 'phone band exists').toBeTruthy();
    expect(band).toMatch(/\.master-plan-cargo-summary \{[^}]*flex-wrap: wrap;/);
    const hint = band.match(/\.master-plan-cargo-summary__zone-hint \{([^}]*)\}/)?.[1] ?? '';
    expect(hint).toMatch(/flex: 1 1 100%;/);
    expect(hint).toMatch(/white-space:\s*normal;/);
  });

  it('desktop keeps the nowrap single-line strip', () => {
    const bar = css.match(/\.master-plan-cargo-summary \{([^}]*)\}/)?.[1] ?? '';
    expect(bar).toMatch(/flex-wrap: nowrap;/);
    expect(bar).toMatch(/overflow-x: auto;/);
  });
});
