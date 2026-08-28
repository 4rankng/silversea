import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/* Real-device bug report (driver iPhone screenshot, /my-trips): the fixed
 * bottom-nav bar let scrolled-past card content bleed through behind it —
 * rgba(255,255,255,0.95) relied on backdrop-filter to mask the rest, but
 * that had no -webkit- prefix, so it silently never applied on Safari/iOS
 * (the exact browser real drivers use), leaving only 95% opacity to hide a
 * solid button behind it. @media query behavior isn't reliably testable
 * through jsdom rendering, so this asserts on the raw CSS text — same
 * pattern as canvas-fit-polish.styles.test.ts.
 */
describe('bottom-nav opacity contract', () => {
  it('is fully opaque, not relying on backdrop-filter alone to hide content underneath', () => {
    const css = read('src/components/layout/bottom-nav.css');
    expect(css).not.toContain('rgba(255, 255, 255, 0.95)');
    expect(css).toContain('background: var(--surface, #fff);');
    expect(css).toContain('-webkit-backdrop-filter: blur(14px);');
  });
});
