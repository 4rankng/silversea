import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260925_6 — site-wide pairing sweep verify-only check on
 * DetailedPlanGrid date-scope controls. The `__date-scope-controls`
 * is a 3-track grid (`140px auto auto` for date-input + mode-switch
 * + clear) so the date input and its mode-switch sit on one row,
 * never as two orphan rows.
 */

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

describe('DetailedPlanGrid date-scope regression guard (card 20260925_6 verify)', () => {
  it('date-scope-controls is a 3-track row grid (date + mode + clear)', () => {
    expect(css).toMatch(/\.detailed-plan-filters__date-scope-controls\s*\{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.detailed-plan-filters__date-scope-controls\s*\{[^}]*grid-template-columns:\s*140px\s+auto\s+auto;/);
  });

  it('the date mode is a 3-col grid of shortcuts inside the same row', () => {
    expect(css).toMatch(/\.detailed-plan-filters__date-mode\s*\{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.detailed-plan-filters__date-mode\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  });

  it('no elevated panel chrome on either control cluster', () => {
    const scopeBlock = css.match(/\.detailed-plan-filters__date-scope\s*\{([^}]*)\}/)?.[1] ?? '';
    const modeBlock = css.match(/\.detailed-plan-filters__date-mode\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(scopeBlock).not.toMatch(/box-shadow/);
    expect(scopeBlock).not.toMatch(/background/);
    expect(modeBlock).not.toMatch(/box-shadow/);
  });
});
