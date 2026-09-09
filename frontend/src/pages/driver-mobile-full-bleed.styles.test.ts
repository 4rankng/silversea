import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/* Real-device bug report (driver iPhone screenshot, /my-trips): the list
 * page left a gray gutter between the green header and the white tab
 * card, with a second "double background" tone underneath the cards.
 * 2026-08-29: the journey container is now full-bleed (no horizontal
 * padding) and one solid white surface under the header — there is
 * nothing left for narrow-phone @media rules to tighten. The detail
 * page sticky accept bar keeps its 430px/320px side-padding hooks
 * because that bar is the only inline-padded driver widget that still
 * needs the gutter-shrink. @media query behavior isn't reliably
 * testable through jsdom rendering, so this asserts on the raw CSS
 * text — same pattern as canvas-fit-polish.styles.test.ts.
 */
describe('driver mobile full-bleed contract', () => {
  it('/my-trips list page is one full-bleed white surface under the header', () => {
    const css = read('src/pages/DriverTripsPage.css');
    // The legacy inset "14px 14px 32px" padding is gone — the page is
    // edge-to-edge below the green topbar.
    expect(css).not.toMatch(/\.driver-journey \{\s*padding:\s*14px\s+14px\s+32px/);
    // The page below the header is one solid white surface (matches the
    // tab card so there is no visible seam between the two).
    expect(css).toMatch(/\.driver-journey \{\s*[^}]*background:\s*var\(--surface\)/);
  });

  it('trip-detail sticky accept bar tightens side padding at the same breakpoints as the screen', () => {
    const css = read('src/pages/DriverTripDetailPage.css');
    expect(css).toMatch(/@media \(max-width: 430px\) \{[\s\S]*?\.driver-task-accept-sticky \{\s*padding-left: 10px;\s*padding-right: 10px;/);
    expect(css).toMatch(/@media \(max-width: 320px\) \{[\s\S]*?\.driver-task-accept-sticky \{\s*padding-left: 8px;\s*padding-right: 8px;/);
  });

  it('journey card footer opts back up to the 48px driver primary-action floor on phones', () => {
    const css = read('src/pages/DriverTripsPage.css');
    // Authored floor on the footer (the card's primary action) ...
    expect(css).toMatch(/\.driver-journey-card__footer \{[^}]*min-height: 48px/);
    // ... plus the ID-specificity opt-up so the global `#root button` ≤640px
    // 44px floor cannot squash it.
    expect(css).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?#root \.driver-journey-card__footer \{\s*min-height: 48px;?\s*\}/);
  });
});
