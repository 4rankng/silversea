import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1202 (QA wave a8f059c0, 1440px) — the journey card's booking-code pill
// wrapped MID-CODE to two lines (96×40px instead of 22px) for 13–14 char
// codes (MATS8353309000, HANGE7672300, W4A1-FCL-01, SMSKHPG2611842…).
// P2-13's interim fix held one line with an ELLIPSIS — an ellipsis on an
// identity code is banned soft-clip (no-truncation doctrine §4). The law:
// the pill EXPANDS — it sizes to its content, never clips, never breaks
// mid-token, at every viewport.
const css = readFileSync(resolve(process.cwd(), 'src/pages/DriverTripsPage.css'), 'utf8');

function ruleBody(selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = css.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

describe('DriverTripsPage — the journey-card bill pill expands, never clips (SIL-1202)', () => {
  it('sizes to content: no shrink, no min/max-width cap on the pill', () => {
    const pill = ruleBody('.driver-journey-card__bill');
    expect(pill).toMatch(/flex:\s*0 0 auto/);
    expect(pill).not.toMatch(/flex:\s*0 1 auto/);
    expect(pill).not.toMatch(/min-width/);
    expect(pill).not.toMatch(/max-width/);
  });

  it('one line with no clip: nowrap without overflow hidden or ellipsis', () => {
    const pill = ruleBody('.driver-journey-card__bill');
    expect(pill).toMatch(/white-space:\s*nowrap/);
    expect(pill).not.toMatch(/overflow:\s*hidden/);
    expect(pill).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(pill).not.toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('the UI-15a one-line header law still stands — the pill must not re-wrap the row', () => {
    const rules = [...css.matchAll(/\.driver-journey-card__header\s*\{([^}]*)\}/g)].map((match) => match[1]);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain('flex-wrap: wrap');
    expect(rules[1]).toContain('flex-wrap: nowrap');
  });
});
