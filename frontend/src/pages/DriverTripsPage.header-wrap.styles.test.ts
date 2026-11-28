import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/DriverTripsPage.css'), 'utf8');

// SIL-1270 (QA 28/11): the header WRAPS at every width instead of forcing
// one line. UI-15a's ≥1024px nowrap law clipped the shrink-0 "Giờ chạy" chip
// at the measured 304px desktop card column (32px overflow — "08:0" cut off).
// Contract now: the header may wrap so the chip drops whole to its own
// right-aligned line; the chip itself never breaks mid-datetime. One-line
// rendering still happens naturally whenever tag + bill + chip fit.
describe('DriverTripsPage journey-card header wrap law (SIL-1270)', () => {
  it('keeps ONE wrapping header rule — no nowrap band forces the row onto one line', () => {
    const rules = [...css.matchAll(/\.driver-journey-card__header\s*\{([^}]*)\}/g)].map((match) => match[1]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('flex-wrap: wrap');
    expect(rules[0]).not.toContain('flex-wrap: nowrap');
    expect(css).not.toMatch(/flex-wrap:\s*nowrap/);
  });

  it('the "Giờ chạy" chip wraps as a whole — never shrinks or breaks mid-datetime', () => {
    const time = css.match(/\.driver-journey-card__time\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(time).toContain('white-space: nowrap');
    expect(time).toContain('flex-shrink: 0');
  });

  it('wrapped lines pack left — no justify-content spreads the tag/bill identity block apart', () => {
    const header = css.match(/\.driver-journey-card__header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(header).not.toMatch(/justify-content:\s*space-/);
  });
});
