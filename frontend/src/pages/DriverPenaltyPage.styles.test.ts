import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/DriverPenaltyPage.css'), 'utf8');

// SIL-1346 (audit 28/11): /my-penalties capped itself at the 720px driver
// measure while /my-earnings fills a 960px centered column — the penalty
// page left ~40% of the desktop shell empty beside a left-aligned column.
// The two driver summary screens now share ONE container idiom: same
// max-width, same ≥1024px breathing-room padding (the shell is full-bleed
// at those widths, so the column owns its own inset).
describe('DriverPenaltyPage — container matches /my-earnings (SIL-1346)', () => {
  it('caps the page to the 960px earnings column instead of the driver measure', () => {
    const block = css.match(/\.driver-penalty-page\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).toMatch(/max-width:\s*960px/);
    expect(block).toMatch(/margin:\s*0 auto/);
    // The old 720px measure must not survive anywhere in the container rule.
    expect(block).not.toMatch(/driver-measure/);
  });

  it('keeps the earnings ≥1024px padding idiom instead of always-on page padding', () => {
    expect(css).toMatch(
      /@media \(min-width: 1024px\) \{\s*\.driver-penalty-page \{\s*padding: 16px 0 32px;\s*\}\s*\}/,
    );
    const block = css.match(/\.driver-penalty-page\s*\{([^}]*)\}/)?.[1] ?? '';
    // Below 1024px the shell owns the inset — no second page padding.
    expect(block).not.toMatch(/padding/);
  });
});
