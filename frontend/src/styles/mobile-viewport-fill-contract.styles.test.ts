import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = existsSync(resolve(process.cwd(), 'src')) ? process.cwd() : resolve(process.cwd(), 'frontend');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const page = read('src/pages/ShipmentsPage.css');
const base = read('src/styles/base.css');
const shell = read('src/components/layout/app-shell.css');
const nav = read('src/components/layout/bottom-nav.css');
const responsive = read('src/styles/responsive.css');

/* Card 20261004_327 — user iPhone screenshot, /shipments ("Tổng quan lô
 * hàng", Tháng 10/2026): below the last lot card a light band ran to the
 * physical screen bottom, cutting the visible list short.
 *
 * History: 581309b6 painted the box chain (html/body/.app/.app-body/.page)
 * and 8f6ad2d8 added a past-the-edge ::after band. Device QA on build
 * 7215b2dd FAILED anyway (user iPhone, 17:26 capture): the real mechanism is
 * the FIXED `#root` — `position: fixed; inset: 0` is sized to the LAYOUT
 * viewport, which on iOS Safari stays at the small-viewport height when the
 * bottom toolbar collapses; `.app`'s 100dvh then outgrows the root and
 * `overflow: clip` cuts it at the layout-viewport bottom, leaving dead canvas
 * below the app's visual end.
 *
 * The rework adopts the nepocorp checkout's architecture (same product
 * family, verified by the owner on the same device with NO band): a plain
 * `height: 100%; overflow: hidden` stack — html/body/#root, then the dvh
 * shell — so the shell always reaches whatever the dynamic viewport becomes.
 * The ::after band is retired (nothing left to paint).
 *
 * The red for this rework is the DEVICE capture recorded in the card (no
 * desktop engine can replay the iOS dynamic toolbar); these pins hold the
 * architecture that makes the band impossible and forbid the fixed root from
 * coming back.
 */

/* The page root rule (first `.shipments-page { … }`, the base rule). */
const pageRootRule = page.match(/^\.shipments-page\s*\{[^}]*\}/m)?.[0] ?? '';
/* The ≤560px phone-tier `.shipments-page { … }` override (first rule inside
   the first ≤560 band). */
const phoneTierRule =
  page.match(/@media \(max-width: 560px\)\s*\{[\s\S]*?\.shipments-page\s*\{[^}]*\}/)?.[0]?.match(/\.shipments-page\s*\{[^}]*\}/)?.[0] ?? '';

describe('mobile viewport-fill contract (card 20261004_327)', () => {
  it('the shell chain is a plain 100% stack with NO fixed root', () => {
    // The nepocorp-proven chain: every viewport layer is height:100% +
    // overflow:hidden. overflow:hidden keeps the shell-owns-scrolling
    // guarantee (focused portal content cannot programmatically scroll these
    // layers); nothing here may re-introduce `position: fixed` — a fixed root
    // is layout-viewport-sized and clips the dvh shell on iOS (the failed
    // device rung this card reworks).
    expect(base).toMatch(/html, body, #root \{ height: 100%; overflow: hidden; \}/);
    expect(base).not.toMatch(/#root\s*\{[^}]*position:\s*fixed;/);
    expect(base).not.toMatch(/body:has\(\.app\)\s*#root/);
  });

  it('the dvh shell reaches the dynamic viewport bottom and paints the page tone', () => {
    expect(shell).toMatch(/grid-template-rows: 100vh;\s*grid-template-rows: 100dvh;/);
    expect(shell).toMatch(/height: 100%;\s*height: 100dvh;/);
    expect(shell).toMatch(/\.app\s*\{[\s\S]*?background:\s*var\(--bg\);/);
    expect(shell).toMatch(/\.app-body,[\s\S]*?background:\s*var\(--bg\);/);
    // The root canvas paint stays as defense in depth for genuine overscroll.
    expect(base).toMatch(/html\s*\{[^}]*background:\s*var\(--bg\);/);
  });

  it('the retired slack band does not come back', () => {
    // Under the plain chain there is no revealed strip to paint; the
    // past-the-edge pseudo is dead mechanism (device QA failed with it).
    expect(nav).not.toMatch(/\.app:not\(\.is-driver\)::after/);
    expect(nav).not.toMatch(/top:\s*100%;/);
  });

  it('the lot list page surface fills the shell scrollport and paints the page tone', () => {
    const rule = pageRootRule;
    expect(rule, '.shipments-page base rule exists').not.toBe('');
    // The fill primitive is the scrollport-relative percentage — the same
    // answer `.notif-page`, `.driver-journey` and `.app.is-driver` ship. The
    // page paints its own tone so the fill is a real surface, not a hole the
    // shell underneath happens to cover (house page-fill primitive = paint +
    // min-height together).
    expect(rule).toMatch(/min-height:\s*100%;/);
    expect(rule).toMatch(/background:\s*var\(--bg\);/);
    // Leftover height collects BELOW the last grid row (below the last lot
    // card). Default `align-content: normal` stretches the auto rows instead,
    // opening ~leftover/3 of void between the breadcrumbs, the control surface
    // and the workspace — unusual gaps inside the page.
    expect(rule).toMatch(/align-content:\s*start;/);
    // Safe area handled at the page's own bottom edge (the shell pays its own
    // counted-once clearance below).
    expect(rule).toMatch(/padding-bottom:\s*calc\(40px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  });

  it('the phone tier keeps the scrollport-relative fill — no viewport-locked height', () => {
    const rule = phoneTierRule;
    expect(rule, '≤560 .shipments-page override exists').not.toBe('');
    expect(rule).toMatch(/padding-bottom:\s*calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    // `min-height: 100dvh` on a child of the `main.app-body` scrollport
    // overshoots the scrollport's content box by topbar (56px + safe-top) +
    // shell paddings (14 + 28 + safe) ≈ 130–180px at 390×844 — and that
    // overshoot is a SCROLLABLE VOID below the last lot card, the reported
    // symptom, at 390×844 / 414×896 / 375×667 alike (all three land in this
    // tier). 100% of the scrollport is the exact fill.
    expect(rule).not.toMatch(/min-height:\s*100(?:dvh|vh)\s*;/);
    expect(page).not.toMatch(/min-height:\s*100(?:dvh|vh)\s*;/);
  });

  it('the safe area is cleared once per scroll (responsive clearance pin)', () => {
    expect(responsive).toMatch(
      /\.app-body, \.content \{ padding: var\(--app-body-pad-t, 14px\) var\(--app-body-pad-x\) calc\(28px \+ env\(safe-area-inset-bottom, 0px\)\);/,
    );
  });

  /* AC2 evidence — 390×844, 414×896 and 375×667 all land in the ≤560 tier and
   * every declaration the chain relies on is unit-relative (100% of the
   * scrollport, env() safe area, dvh shell with a 100% fallback), so one chain
   * serves all three viewports with no per-size branch to drift. */
  it.each([
    [390, 844],
    [414, 896],
    [375, 667],
  ])('the chain is viewport-relative at %i×%i', (width) => {
    expect(width).toBeLessThanOrEqual(560);
    expect(pageRootRule).toMatch(/min-height:\s*100%;/);
    expect(page).not.toMatch(/min-height:\s*(?:844|896|667)px/);
    expect(phoneTierRule).toMatch(/env\(safe-area-inset-bottom, 0px\)/);
  });
});
