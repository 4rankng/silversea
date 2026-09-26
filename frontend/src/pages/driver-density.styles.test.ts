import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/* Card 20260926_26 (CHIEF items 1-4): density + type scale for the driver
 * task-detail surface.
 *
 * ITEM 1 — fact rows become single-line settings rows: label left, value
 * right, 44-52px tall with 12px vertical padding (was label-above-value).
 * ITEM 2 — data type scale: label 12-13px muted, value 15-16px primary.
 * ITEM 3 — hairline dividers between rows instead of whitespace; card
 * padding already sits at/below the 16px target.
 * ITEM 4 — title block compresses to two lines: back + mã (Số Bill /
 * Booking) on line 1, location + status pill on line 2 (~120px, was ~250px).
 *
 * @media behavior isn't reliably testable through jsdom, so this asserts on
 * the raw CSS text — same pattern as driver-mobile-full-bleed.styles.test.ts.
 */
describe('driver density contract (20260926_26)', () => {
  const css = read('src/pages/DriverTripDetailPage.css');

  it('ITEM 1: fact rows are single-line settings rows (label left, value right)', () => {
    const block = css.slice(css.indexOf('.driver-task-fact {'));
    expect(block).toMatch(/display:\s*flex/);
    expect(block).toMatch(/align-items:\s*center/);
    // Label hugs the left; value takes the remaining width and right-aligns.
    const labelBlock = css.slice(css.indexOf('.driver-task-fact__label {'));
    expect(labelBlock).toMatch(/flex:\s*none/);
    const valueBlock = css.slice(css.indexOf('.driver-task-fact__value {'));
    expect(valueBlock).toMatch(/text-align:\s*right/);
  });

  it('ITEM 1: rows sit in the 44-52px band with 12px vertical padding', () => {
    const block = css.slice(css.indexOf('.driver-task-fact {'));
    expect(block).toMatch(/min-height:\s*48px/);
    expect(block).toMatch(/padding:\s*12px 0/);
  });

  it('ITEM 3: hairline divider between rows, none under the last row', () => {
    const block = css.slice(css.indexOf('.driver-task-fact {'));
    expect(block).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(css).toMatch(/\.driver-task-fact:last-child \{\s*border-bottom:\s*0;\s*\}/);
  });

  it('ITEM 2: label 12-13px muted; value 15-16px primary', () => {
    const labelBlock = css.slice(css.indexOf('.driver-task-fact__label {'));
    const labelSize = Number(labelBlock.match(/font-size:\s*(\d+(?:\.\d+)?)px/)?.[1]);
    expect(labelSize).toBeGreaterThanOrEqual(12);
    expect(labelSize).toBeLessThanOrEqual(13);
    expect(labelBlock).toMatch(/color:\s*var\(--ink-3\)/);
    const valueBlock = css.slice(css.indexOf('.driver-task-fact__value {'));
    const valueSize = Number(valueBlock.match(/font-size:\s*(\d+(?:\.\d+)?)px/)?.[1]);
    expect(valueSize).toBeGreaterThanOrEqual(15);
    expect(valueSize).toBeLessThanOrEqual(16);
    expect(valueBlock).toMatch(/color:\s*var\(--ink\)/);
  });

  it('ITEM 3: card padding stays at/below 16px and card gaps stay in the 8-12px band', () => {
    const sectionBlock = css.slice(css.indexOf('.driver-task-section {'));
    const pad = Number(sectionBlock.match(/padding:\s*(\d+)px/)?.[1]);
    expect(pad).toBeLessThanOrEqual(16);
    const margin = Number(sectionBlock.match(/margin-top:\s*(\d+)px/)?.[1]);
    expect(margin).toBeGreaterThanOrEqual(8);
    expect(margin).toBeLessThanOrEqual(12);
  });

  it('ITEM 4: the info grid renders as full-width settings rows at every viewport', () => {
    // The ≥641px 2-col bento belonged to the label-above-value structure;
    // settings rows span the card width (same idiom as the fuel facts block).
    expect(css).not.toMatch(/\.driver-task-grid[^{]*\{[^}]*grid-template-columns:\s*repeat\(2/);
  });

  it('ITEM 4: the title block compresses to two lines', () => {
    // Line 1: back + mã; line 2: location + status pill. The standalone
    // route line is gone (ports carry the route in the info grid), and the
    // header never renders the eyebrow on the detail screen.
    expect(css).not.toMatch(/\.driver-task-header__route/);
    const headerBlock = css.slice(css.indexOf('.driver-task-header {'));
    expect(headerBlock).toMatch(/align-items:\s*center/);
  });

  it('call affordance keeps its 44px target without inflating the row', () => {
    const callBlock = css.slice(css.indexOf('.driver-task-fact__call {'));
    expect(callBlock).toMatch(/width:\s*var\(--control-touch-h, 44px\)/);
    expect(callBlock).toMatch(/height:\s*var\(--control-touch-h, 44px\)/);
  });
});
