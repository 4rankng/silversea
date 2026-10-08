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
    // The bar paints a token, not a literal: `--surface` resolves to #FFFFFF
    // in src/styles/tokens.css, so the bar stays fully opaque with the
    // translucent rgba() fallback retired. Assert the opacity contract
    // (opaque token + the -webkit-prefixed blur stays for the tint) rather
    // than the retired `#fff` fallback literal.
    const bar = css.match(/\.bottom-nav \{[^}]*backdrop-filter[^}]*\}/)?.[0] ?? '';
    expect(bar, 'fixed bottom-nav rule exists').not.toBe('');
    expect(bar).toMatch(/background:\s*var\(--surface\);/);
    // The OPACITY contract is about the fill only — a translucent box-shadow
    // alpha (0.03 hairline) is a shadow, not the bar's own transparency.
    const fill = bar.match(/background(?:-color)?:\s*([^;]+);/)?.[1] ?? '';
    expect(fill, 'the bar has a background fill').not.toBe('');
    expect(fill, 'the bar fill must be fully opaque').not.toMatch(/rgba|hsla|\/\s*[\d.]+\s*\)/);
    expect(bar).toContain('-webkit-backdrop-filter: blur(14px);');
  });
});

/* Card 20260927_149 (user evidence 03/10): payroll and nepocorp render the
 * phone tab bar without any dead band beneath it on a real iPhone. Both pin
 * the bar to `position: fixed; bottom: 0` and paint the home-indicator strip
 * INSIDE the bar's own opaque box (`padding-bottom: env(safe-area-inset-)`)
 * while the scrolling content pays a clearance. The in-flow bar this replaces
 * depended on iOS dvh reflow — the one half CDP can never verify (visual
 * viewport ≠ layout viewport), which is exactly why the card sat blocked on
 * a device re-test. A fixed bar cannot leave uncovered space below itself:
 * its bottom edge is the viewport bottom at every viewport state, and its
 * own padding paints the safe-area strip. The fixed accept/complete bars on
 * the trip screen already offset by `--bottom-nav-h`, so the same token now
 * describes the true geometry instead of a coincidence of column flow.
 */
describe('bottom-nav fixed-layer contract (proven phone pattern)', () => {
  const css = () => read('src/components/layout/bottom-nav.css');
  const barRule = () => css().match(/\.bottom-nav \{[^}]*\}/gs)?.find(b => b.includes('env(safe-area-inset-bottom')) ?? '';

  it('driver bar is pinned to the viewport bottom, not in flow', () => {
    const bar = barRule();
    expect(bar, 'the ≤1023 bar rule exists').not.toBe('');
    expect(bar).toMatch(/position:\s*fixed;/);
    expect(bar).toMatch(/bottom:\s*0;/);
    expect(css()).not.toMatch(/\.bottom-nav \{[^}]*position:\s*relative/);
  });

  it('driver bar paints the home-indicator strip inside its own box', () => {
    const bar = barRule();
    expect(bar).toMatch(/padding-bottom:[^;]*env\(safe-area-inset-bottom/);
    expect(bar).toMatch(/background:\s*var\(--surface\);/);
  });

  it('driver content pays a nav clearance derived from the shared height token', () => {
    const media = css().match(/@media \(max-width: 1023px\) \{[\s\S]*$/)?.[0] ?? '';
    expect(
      media.match(/\.app\.is-driver \.app-body\s*\{[^}]*padding-bottom:\s*calc\(var\(--bottom-nav-h\)/),
      'driver app-body reserves the fixed bar height',
    ).not.toBeNull();
  });

  it('customer portal bar follows the same fixed pattern (same defect class)', () => {
    const portal = read('src/pages/portal/CustomerPortalLayout.css');
    const portalBar = portal.match(/\.customer-shell__bottom-nav \{[^}]*\}/gs)?.find(b => b.includes('safe-area-inset-bottom')) ?? '';
    expect(portalBar, 'the ≤1023 portal bar rule exists').not.toBe('');
    expect(portalBar).toMatch(/position:\s*fixed;/);
    expect(portalBar).toMatch(/bottom:\s*0;/);
  });
});
