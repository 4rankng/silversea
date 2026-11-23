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

describe('CR-010.1 — collapsed-rail hover bloom', () => {
  const appShell = readFileSync(resolve(process.cwd(), 'src/components/layout/app-shell.css'), 'utf8');
  const hoverCss = readFileSync(resolve(process.cwd(), 'src/components/layout/sidebar-hover.css'), 'utf8');

  it('pins the grid tracks so the fixed hover pane cannot collapse the main column', () => {
    // position:fixed removes .sidebar from auto-placement; without explicit
    // tracks .app-main slid into the 48px rail column and the content went
    // zero-width (the "gray canvas" bug). Both children must own their track.
    expect(appShell).toMatch(/\.app > \.sidebar\s*\{[^}]*grid-column:\s*1;[^}]*\}/);
    expect(appShell).toMatch(/\.app > \.app-main\s*\{[^}]*grid-column:\s*2;[^}]*\}/);
  });

  it('opens the user dropdown over the pane at pane width — never parked past its clipping edge', () => {
    // The aside paints overflow: hidden, so a dropdown anchored past the
    // pane's right edge (the old off-pane park) was clipped invisible —
    // Đăng xuất unreachable. The hover pane re-anchors the rail's fixed
    // menu onto itself with the pane's own width.
    expect(hoverCss).toMatch(
      /\.app\.sidebar-closed\.sidebar-hover-open \.sidebar-user-dropdown\s*\{[^}]*left:\s*8px;[^}]*right:\s*auto;[^}]*width:\s*calc\(var\(--sidebar-w\) - 16px\);/,
    );
    expect(hoverCss).not.toContain('calc(var(--sidebar-w) + 8px)');
  });
});
