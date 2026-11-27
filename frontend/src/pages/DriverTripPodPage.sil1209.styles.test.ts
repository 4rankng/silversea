import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1209 (QA wave a8f059c0, 1440px) — the driver e-POD screen opened a
// ~333px void between the documents card and the "Nộp chứng từ e-POD" card
// (160px above "Hoàn thành chuyến" on trip 35). Cause: the main column grew
// to absorb the leftover viewport height (`flex: 1`), so the completion card
// was pushed to the bottom of the screen while the cards above stayed at the
// top. The mobile band never showed it — there the content is taller than
// the viewport, so the column had no leftover height to absorb (19px gap).
//
// The law: the cards follow each other with ONE spacing at every width. The
// leftover height stays BELOW the last card; it never opens a hole between
// two cards.

const podCss = readFileSync(resolve(process.cwd(), 'src/pages/DriverTripPodPage.css'), 'utf8');
const detailCss = readFileSync(resolve(process.cwd(), 'src/pages/DriverTripDetailPage.css'), 'utf8');

function ruleBody(source: string, selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = source.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

/** The flex GROW factor of a rule body — 0 means the item keeps its content
 *  height and never absorbs the leftover space of its container. */
function growFactor(body: string): number {
  const shorthand = body.match(/(?:^|;)\s*flex:\s*([^;]+)/);
  if (shorthand) {
    const first = shorthand[1].trim().split(/\s+/)[0];
    return first === 'none' ? 0 : Number(first) || 0;
  }
  const longhand = body.match(/flex-grow:\s*([0-9.]+)/);
  return longhand ? Number(longhand[1]) : 0;
}

describe('DriverTripPodPage — the e-POD cards follow each other, no void (SIL-1209)', () => {
  it('the main column does not absorb the leftover viewport height', () => {
    const main = ruleBody(podCss, '.driver-trip-pod-main');
    // `flex: 1` here is what pushed the completion card to the bottom of the
    // screen and opened the ~333px hole at 1440px.
    expect(growFactor(main)).toBe(0);
    expect(main).not.toMatch(/flex-grow:\s*[1-9]/);
  });

  it('the screen column packs its cards from the top — the leftover height stays below', () => {
    const screen = ruleBody(podCss, '.driver-trip-pod-screen');
    expect(screen).toMatch(/justify-content:\s*flex-start/);
    // `space-between` would spread the cards apart again — the exact void.
    expect(screen).not.toMatch(/justify-content:\s*space-/);
  });

  it('the card spacing has one owner per width — no breakpoint re-declares it', () => {
    // The gap between the documents card and the completion card is the
    // section padding + the footer's margin-top. A per-width override would
    // break the single rhythm the mobile band (19px) already shows.
    expect([...podCss.matchAll(/\.driver-trip-pod-main\s*\{/g)]).toHaveLength(1);
    expect([...detailCss.matchAll(/\.driver-task-footer\s*\{/g)]).toHaveLength(1);
    expect(ruleBody(detailCss, '.driver-task-footer')).toMatch(/margin-top:/);
  });
});
