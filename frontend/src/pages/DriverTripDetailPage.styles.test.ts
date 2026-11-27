import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/DriverTripDetailPage.css'), 'utf8');

// HOT-06 (CR-011.2, 390×844) — the fixed black accept bar must never cover
// the page tail: the screen clears it with the bar's height + margin at
// every width, and the ≤1023px tier keeps its authored clearance (the
// measured bar + chrome ≈ 104px) well above the ≥80px floor.
describe('DriverTripDetailPage — accept-bar clearance (HOT-06)', () => {
  it('reserves ≥80px of bottom clearance under the fixed accept bar at every width', () => {
    expect(css).toMatch(
      /\.driver-task-screen--has-accept-bar,\s*\.driver-task-screen--has-complete-bar\s*\{[^}]*padding-bottom:\s*calc\(140px/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1023px\)[\s\S]*?\.driver-task-screen--has-accept-bar,\s*\.driver-task-screen--has-complete-bar\s*\{[^}]*padding-bottom:\s*calc\(104px/,
    );
  });
});
