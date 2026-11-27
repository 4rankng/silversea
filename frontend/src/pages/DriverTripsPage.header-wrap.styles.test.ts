import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/DriverTripsPage.css'), 'utf8');

// UI-15a (QA 27/11): on desktop the journey-card header must stay on ONE
// line — the bill chip compresses before the shrink-0 "Giờ chạy" chip ever
// drops to a second line. Mobile (<1024px) keeps the wrapping behaviour, so
// the nowrap must ride a ≥1024px band — and because media queries add no
// specificity, that band must come AFTER the base rule in the sheet or the
// base flex-wrap: wrap wins the cascade (probe-caught on the live board).
describe('DriverTripsPage journey-card header one-line law (UI-15a)', () => {
  it('forces the header onto one line inside a ≥1024px band that follows the base rule', () => {
    const rules = [...css.matchAll(/\.driver-journey-card__header\s*\{([^}]*)\}/g)].map(match => match[1]);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain('flex-wrap: wrap');
    expect(rules[0]).not.toContain('flex-wrap: nowrap');
    expect(rules[1]).toContain('flex-wrap: nowrap');

    const baseIdx = css.indexOf('flex-wrap: wrap');
    const nowrapIdx = css.indexOf('flex-wrap: nowrap');
    const bandIdx = css.lastIndexOf('@media (min-width: 1024px)', nowrapIdx);
    expect(nowrapIdx, 'the nowrap must exist after the base wrap in source order').toBeGreaterThan(baseIdx);
    expect(bandIdx, 'the nowrap must live inside a ≥1024px band').toBeGreaterThan(baseIdx);
    expect(nowrapIdx, 'the nowrap must follow its band opener').toBeGreaterThan(bandIdx);
  });
});
