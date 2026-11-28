import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/DriverTripDetailPage.css'), 'utf8');

// HOT-06 (CR-011.2, 390×844) — the fixed black accept bar must never cover
// the page tail. SIL-1346 (28/11 audit, /my-trips/690): the authored floor
// now includes the bottom-nav strip it stacks above (--bottom-nav-h at
// ≤1023px), and useFixedActionClearance publishes the bar's real covered
// height as --fixed-action-clearance — max() picks the larger, so a taller
// bar (wrapped notices, larger type) can never under-reserve.
describe('DriverTripDetailPage — accept-bar clearance (HOT-06, SIL-1346)', () => {
  it('reserves the authored floor and the measured clearance at every width', () => {
    expect(css).toMatch(
      /\.driver-task-screen--has-accept-bar,\s*\.driver-task-screen--has-complete-bar\s*\{[^}]*padding-bottom:\s*max\(\s*calc\(140px \+ env\(safe-area-inset-bottom, 0px\)\),\s*var\(--fixed-action-clearance, 0px\)\)/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1023px\)[\s\S]*?\.driver-task-screen--has-accept-bar,\s*\.driver-task-screen--has-complete-bar\s*\{[^}]*padding-bottom:\s*max\(\s*calc\(var\(--bottom-nav-h, 66px\) \+ 104px\),\s*var\(--fixed-action-clearance, 0px\)\)/,
    );
  });

  it('reserves the completion checklist height above the nav strip', () => {
    expect(css).toMatch(
      /\.driver-task-screen--has-complete-bar\s*\{[^}]*padding-bottom:\s*max\(\s*calc\(148px \+ env\(safe-area-inset-bottom, 0px\)\),\s*var\(--fixed-action-clearance, 0px\)\)/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1023px\)[\s\S]*?\.driver-task-screen--has-complete-bar\s*\{[^}]*padding-bottom:\s*max\(\s*calc\(var\(--bottom-nav-h, 66px\) \+ 168px\),\s*var\(--fixed-action-clearance, 0px\)\)/,
    );
  });
});
