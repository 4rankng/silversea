import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/clerk/ClerkShipmentCreatePage.css'), 'utf8');

/**
 * Create-lot field states: when a control boundary hosts an invalid control,
 * the error styling must WIN over the focus ring — a focused invalid field
 * shows a red ring, never the green focus glow beside the red error.
 */
describe('create-lot control-boundary state styling', () => {
  it('error+focus shows the red ring, overriding the green focus glow', () => {
    const start = css.indexOf(".csc-control-boundary:has([aria-invalid='true']):focus-within");
    expect(start).toBeGreaterThanOrEqual(0);
    const blockStart = css.indexOf('{', start);
    const blockEnd = css.indexOf('}', blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toMatch(/box-shadow: 0 0 0 3px color-mix\(in srgb, var\(--danger/);
  });

  it('plain focus ring stays green (accent) for valid fields', () => {
    const start = css.indexOf('.csc-control-boundary:focus-within');
    expect(start).toBeGreaterThanOrEqual(0);
    const blockStart = css.indexOf('{', start);
    const blockEnd = css.indexOf('}', blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain('var(--accent');
  });
});
