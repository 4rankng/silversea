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
    // The collapsed rail overrides the nav padding — it must keep the reserve
    // and the expanded sidebar's vertical metrics (SIL-899 Y-parity).
    const appShell = readFileSync(resolve(process.cwd(), 'src/components/layout/app-shell.css'), 'utf8');
    expect(appShell).toMatch(
      /\.app\.sidebar-closed \.sidebar-nav\s*\{[^}]*padding:\s*10px 4px calc\(var\(--sidebar-footer-reserve, 72px\) \+ 14px\);/,
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

describe('SIL-899 — collapsed-rail Y parity (rail == hover bloom == expanded)', () => {
  const appShell = readFileSync(resolve(process.cwd(), 'src/components/layout/app-shell.css'), 'utf8');
  const hoverCss = readFileSync(resolve(process.cwd(), 'src/components/layout/sidebar-hover.css'), 'utf8');

  it('keeps the section header in flow on the rail with its expanded box, text swapped for a 1px hairline', () => {
    // The old display:none collapsed the header rows to 0px, so every icon
    // below the first group header drifted up (QA round 10: 18→338px) and
    // the bloom highlighted/opened the wrong item.
    expect(appShell).not.toMatch(/\.app\.sidebar-closed \.sidebar-section-label\s*\{[^}]*display:\s*none/);
    expect(appShell).toMatch(
      /\.app\.sidebar-closed \.sidebar-section-label\s*\{[^}]*pointer-events:\s*none;/,
    );
    expect(appShell).toMatch(
      /\.app\.sidebar-closed \.sidebar-section-label::after\s*\{[^}]*height:\s*1px;/,
    );
    // No vertical metric overrides: the rail header box == the expanded one.
    expect(appShell).not.toMatch(/\.app\.sidebar-closed \.sidebar-section-label\s*\{[^}]*min-height:/);
    expect(appShell).not.toMatch(/\.app\.sidebar-closed \.sidebar-section-label\s*\{[^}]*padding:/);
  });

  it('the bloom re-prints the header labels and drops the hairline', () => {
    expect(hoverCss).toMatch(
      /\.app\.sidebar-closed\.sidebar-hover-open \.sidebar-section-label\s*\{[^}]*pointer-events:\s*auto;/,
    );
    expect(hoverCss).toMatch(
      /\.app\.sidebar-closed\.sidebar-hover-open \.sidebar-section-label > span[^{]*\{[^}]*display:\s*inline;/,
    );
    expect(hoverCss).toMatch(
      /\.app\.sidebar-closed\.sidebar-hover-open \.sidebar-section-label::after\s*\{[^}]*content:\s*none;/,
    );
  });

  it('brand and nav vertical metrics are identical in all three states', () => {
    // Expanded base.
    expect(css).toMatch(/\.sidebar-brand\s*\{[^}]*padding:\s*18px 16px 16px;/);
    // Rail: same vertical paddings, only inline squeezed.
    expect(appShell).toMatch(
      /\.app\.sidebar-closed \.sidebar-brand\s*\{[^}]*padding:\s*18px 4px 16px;/,
    );
    // Bloom: the expanded paddings.
    expect(hoverCss).toMatch(
      /\.app\.sidebar-closed\.sidebar-hover-open \.sidebar-brand\s*\{[^}]*padding:\s*18px 16px 16px;/,
    );
    // Nav: same top padding + footer reserve everywhere.
    expect(css).toMatch(
      /\.sidebar-nav,\s*\.sidebar__nav\s*\{[^}]*padding:\s*10px 10px calc\(var\(--sidebar-footer-reserve\) \+ 14px\);/,
    );
    expect(appShell).toMatch(
      /\.app\.sidebar-closed \.sidebar-nav\s*\{[^}]*padding:\s*10px 4px calc\(var\(--sidebar-footer-reserve, 72px\) \+ 14px\);/,
    );
    expect(hoverCss).toMatch(
      /\.app\.sidebar-closed\.sidebar-hover-open \.sidebar-nav\s*\{[^}]*padding:\s*10px 10px calc\(var\(--sidebar-footer-reserve, 72px\) \+ 14px\);/,
    );
  });

  it('the brand descriptor stays on one line so the brand box is font-metric independent', () => {
    // If the descriptor wraps, the expanded/bloom brand grows taller than the
    // rail's (meta hidden) and the whole nav shifts — the Y-parity killer.
    expect(css).toMatch(/\.sidebar-brand-meta span\s*\{[^}]*white-space:\s*nowrap;/);
  });
});
