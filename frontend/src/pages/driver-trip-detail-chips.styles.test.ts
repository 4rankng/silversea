import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/* Ticket 36d0183d: the trip-detail operation chips ("Tác vụ") and the
 * close-status chip are new chrome on the driver mobile surface. Per the
 * size-consistency scale (design-system contract): chips are pills with
 * 4/8–10px padding and the shared caption role; the collapse toggle is a real control
 * and carries the 44px coarse-pointer floor (control-density contract — the
 * compact base and the coarse override ship together). @media behavior isn't
 * reliably testable through jsdom rendering, so this asserts on the raw CSS
 * text — same pattern as driver-mobile-full-bleed.styles.test.ts.
 */
describe('driver trip-detail chips style contract (36d0183d)', () => {
  const css = read('src/pages/DriverTripDetailPage.css');

  it('chips render as neutral pills with compact type', () => {
    const block = css.slice(css.indexOf('.driver-task-ops-chip'));
    expect(block).toMatch(/border-radius:\s*999px/);
    expect(block).toMatch(/padding:\s*4px 10px/);
    expect(block).toMatch(/font-size:\s*var\(--text-caption-size\)/);
  });

  it('close-status chip uses the shared compact header type', () => {
    const block = css.slice(css.indexOf('.driver-task-close-chip'));
    expect(block).toMatch(/border-radius:\s*999px/);
    expect(block).toMatch(/font-size:\s*var\(--text-caption-size\)/);
  });

  it('collapse toggle keeps the 44px coarse-pointer floor', () => {
    expect(css).toMatch(/\.driver-task-ops-toggle \{[^}]*\}/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.driver-task-ops-toggle \{\s*min-height:\s*var\(--control-touch-h, 44px\);\s*\}\s*\}/);
  });
});
