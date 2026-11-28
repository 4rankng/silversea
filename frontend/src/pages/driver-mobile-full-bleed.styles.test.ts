import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/* Real-device bug report (driver iPhone screenshot, /my-trips): the list
 * page left a gray gutter between the green header and the white tab
 * card, with a second "double background" tone underneath the cards.
 * 2026-08-29: the journey container is now full-bleed (no horizontal
 * padding). KB §10.8.3 later restored the sage page canvas app-wide
 * (SIL-523): the board paints the same --surface-2 ground as the trip
 * detail screen and the cards stay white on it. The detail
 * page sticky accept bar keeps its 430px/320px side-padding hooks
 * because that bar is the only inline-padded driver widget that still
 * needs the gutter-shrink. @media query behavior isn't reliably
 * testable through jsdom rendering, so this asserts on the raw CSS
 * text — same pattern as canvas-fit-polish.styles.test.ts.
 */
describe('driver mobile full-bleed contract', () => {
  it('/my-trips list page is a full-bleed sage canvas with white cards', () => {
    const css = read('src/pages/DriverTripsPage.css');
    // The legacy inset "14px 14px 32px" padding is gone — the page is
    // edge-to-edge below the green topbar.
    expect(css).not.toMatch(/\.driver-journey \{\s*padding:\s*14px\s+14px\s+32px/);
    // KB §10.8.3: the official app ground is the sage tone — the same
    // --surface-2 canvas the trip-detail screen paints — and cards stay
    // white (--surface) so they sit on the ground instead of vanishing
    // into a white-on-white board.
    expect(css).toMatch(/\.driver-journey \{\s*[^}]*background:\s*var\(--surface-2\)/);
    expect(css).toMatch(/\.driver-journey-card \{[^}]*background:\s*var\(--surface\)/);
  });

  it('trip-detail sticky accept bar tightens side padding at the same breakpoints as the screen', () => {
    const css = read('src/pages/DriverTripDetailPage.css');
    expect(css).toMatch(/@media \(max-width: 430px\) \{[\s\S]*?\.driver-task-accept-sticky \{\s*padding-left: 10px;\s*padding-right: 10px;/);
    expect(css).toMatch(/@media \(max-width: 320px\) \{[\s\S]*?\.driver-task-accept-sticky \{\s*padding-left: 8px;\s*padding-right: 8px;/);
  });

  it('journey card footer uses the current house budget without a phone opt-up', () => {
    const css = read('src/pages/DriverTripsPage.css');
    expect(css).toMatch(/\.driver-journey-card__footer \{[^}]*min-height: var\(--control-h\)/);
    expect(css).not.toMatch(/#root \.driver-journey-card__footer \{[^}]*min-height:/);
    // Keep the real action affordance and its neutral history variant.
    expect(css).toMatch(/\.driver-journey-card__footer \{[^}]*cursor: pointer/);
    expect(css).toMatch(/\.driver-journey-card__footer--quiet \{[^}]*background: var\(--surface\)/);
  });

  it('copy affordance reaches the 44×44 tap floor at phone widths (QA 28/11 UX-06)', () => {
    const css = read('src/pages/DriverTripDetailPage.css');
    // The ≤767px band floors the FOCUSABLE BOX at the house touch token
    // (--control-touch-h = 44px, pinned in control-density.styles.test) —
    // padding-box growth, not icon growth. Desktop keeps the compact 28px
    // ghost: the base rule's fixed width/height stand outside the band.
    expect(css).toMatch(/\.driver-copy-btn \{\s*[^}]*width: 28px;\s*height: 28px;/);
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{\s*\.driver-task-screen \.driver-copy-btn \{\s*width: var\(--control-touch-h\);\s*height: var\(--control-touch-h\);\s*\}\s*\}/,
    );
  });
});
