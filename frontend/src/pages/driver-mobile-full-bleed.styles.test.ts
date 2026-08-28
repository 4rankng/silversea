import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/* Real-device bug report (driver iPhone screenshot, /my-trips): the list and
 * detail pages left disproportionate side gutter on phone widths — the
 * detail page already tightens its padding below 430px/320px, the list page
 * never did. @media query behavior isn't reliably testable through jsdom
 * rendering, so this asserts on the raw CSS text — same pattern as
 * canvas-fit-polish.styles.test.ts.
 */
describe('driver mobile full-bleed contract', () => {
  it('/my-trips list page tightens side padding on phone widths, mirroring the detail page', () => {
    const css = read('src/pages/DriverTripsPage.css');
    expect(css).toMatch(/@media \(max-width: 430px\) \{\s*\.driver-journey \{\s*padding-left: 10px;\s*padding-right: 10px;/);
    expect(css).toMatch(/@media \(max-width: 320px\) \{\s*\.driver-journey \{\s*padding-left: 8px;\s*padding-right: 8px;/);
    expect(css).toMatch(/\.driver-journey-card \{\s*padding: 12px;\s*\}/);
  });

  it('trip-detail sticky accept bar tightens side padding at the same breakpoints as the screen', () => {
    const css = read('src/pages/DriverTripDetailPage.css');
    expect(css).toMatch(/@media \(max-width: 430px\) \{[\s\S]*?\.driver-task-accept-sticky \{\s*padding-left: 10px;\s*padding-right: 10px;/);
    expect(css).toMatch(/@media \(max-width: 320px\) \{[\s\S]*?\.driver-task-accept-sticky \{\s*padding-left: 8px;\s*padding-right: 8px;/);
  });
});
