import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/layout/sidebar.css'), 'utf8');

describe('sidebar user menu layering', () => {
  it('keeps the profile menu above sticky operational workspace controls', () => {
    expect(css).toMatch(/\.sidebar-footer\s*\{[^}]*z-index:\s*var\(--z-overlay\);/);
  });

  it('reserves a footer-height scroll clearance so nav items cannot park under the pinned user button (SIL-570)', () => {
    // The nav scroller carries one footer-height of bottom padding: during a
    // 100dvh browser-UI transition or the collapse animation the footer pins
    // to the live viewport edge, and a fully scrolled item must stop its own
    // height above it (same clearance mechanism as the sticky-header
    // scroll-padding law).
    expect(css).toMatch(
      /--sidebar-footer-reserve:\s*72px;/,
    );
    expect(css).toMatch(
      /\.sidebar-nav,\s*\.sidebar__nav\s*\{[^}]*padding:\s*10px 10px calc\(var\(--sidebar-footer-reserve\) \+ 14px\);/,
    );
    // The collapsed rail overrides the nav padding — it must keep the reserve.
    const appShell = readFileSync(resolve(process.cwd(), 'src/components/layout/app-shell.css'), 'utf8');
    expect(appShell).toMatch(
      /\.app\.sidebar-closed \.sidebar-nav\s*\{[^}]*padding:\s*8px 4px calc\(var\(--sidebar-footer-reserve, 72px\) \+ 8px\);/,
    );
    // Opaque footer: a transient underlap paints the footer, never a ghost
    // item behind it.
    expect(css).toMatch(/\.sidebar-footer\s*\{[^}]*background:\s*var\(--sb-gradient-end\);/);
  });
});
