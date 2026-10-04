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
 * hàng", Tháng 10/2026): below the last lot card (customer card LONG MINH) a
 * large white band / void ran to the physical screen bottom. Two compounding
 * holes, the card-20260927_149 family (layout viewport vs visual viewport on
 * iOS — the same "dải trắng" that card fixed below the tab bar):
 *
 *  1. the background layer stopped at the app's boxes, so any strip the
 *     browser reveals beyond the layout viewport (toolbar collapse, in-app
 *     WebView retaining a bottom strip, PWA standalone) painted the WebKit
 *     default — foreign WHITE — to the physical bottom. The proven mechanism
 *     (card 20260927_1, retired for the tab-bar geometry by 149 only because
 *     a fixed bar's own box covers the bottom — there is no bar on the
 *     admin/CUS shell) is the ROOT CANVAS paint plus a band painted past the
 *     layout-viewport bottom edge (`top: 100%`).
 *  2. the content container (`.shipments-page`) did not fill the shell
 *     scrollport, so below the last lot card the page surface ended in a void.
 *
 * Pre-fix pixel behavior is device-verified only (no desktop engine can replay
 * the iOS visual viewport); these pins hold the CSS contract that makes the
 * band impossible at every viewport state. Rungs 1–2 were already landed at
 * HEAD by 581309b6 before this test existed and are pinned read-only here;
 * the red this test was observed failing on is the residual holes (the ≤560
 * viewport-locked overshoot, the missing band, the undirected fill leftover).
 */

/* The page root rule (first `.shipments-page { … }`, the base rule). */
const pageRootRule = page.match(/^\.shipments-page\s*\{[^}]*\}/m)?.[0] ?? '';
/* The ≤560px phone-tier `.shipments-page { … }` override (first rule inside
   the first ≤560 band). */
const phoneTierRule =
  page.match(/@media \(max-width: 560px\)\s*\{[\s\S]*?\.shipments-page\s*\{[^}]*\}/)?.[0]?.match(/\.shipments-page\s*\{[^}]*\}/)?.[0] ?? '';
const slackBandRule = nav.match(/\.app:not\(\.is-driver\)::after\s*\{[^}]*\}/)?.[0] ?? '';

describe('mobile viewport-fill contract (card 20261004_327)', () => {
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

  it('the background layer covers the physical bottom: root canvas + past-the-edge band', () => {
    // Rung landed by 581309b6 (card 20260927_1's mechanism): the ROOT canvas
    // paints whatever strip the browser reveals beyond the layout viewport.
    expect(base).toMatch(/html\s*\{[^}]*background:\s*var\(--bg\);/);
    // Defense in depth for the bar-less shells: nothing in CSS can re-anchor a
    // fixed box to the larger viewport, so the page tone is painted INTO the
    // strip — `top: 100%` starts exactly at the layout-viewport bottom edge
    // (the pseudo's containing block) and extends past any revealed slack.
    // Scoped `:not(.is-driver)`: card 20260927_149's measured driver end state
    // (fixed bar + `--surface` canvas) is untouched.
    const band = slackBandRule;
    expect(band, 'non-driver slack band exists').not.toBe('');
    expect(band).toMatch(/position:\s*fixed;/);
    expect(band).toMatch(/top:\s*100%;/);
    expect(band).toMatch(/background:\s*var\(--bg\);/);
  });

  it('every shell layer paints the page tone and the safe area is cleared once per scroll', () => {
    // Read-only pins of the 581309b6 rungs + the responsive.css clearance —
    // the chain the fill relies on.
    expect(shell).toMatch(/\.app\s*\{[\s\S]*?background:\s*var\(--bg\);/);
    expect(shell).toMatch(/\.app-body,[\s\S]*?background:\s*var\(--bg\);/);
    expect(responsive).toMatch(
      /\.app-body, \.content \{ padding: var\(--app-body-pad-t, 14px\) var\(--app-body-pad-x\) calc\(28px \+ env\(safe-area-inset-bottom, 0px\)\);/,
    );
    expect(shell).toMatch(/grid-template-rows: 100vh;\s*grid-template-rows: 100dvh;/);
    expect(shell).toMatch(/height: 100%;\s*height: 100dvh;/);
  });

  /* AC2 evidence — 390×844, 414×896 and 375×667 all land in the ≤560 tier and
   * every declaration the chain relies on is unit-relative (100% of the
   * scrollport, env() safe area, top:100% of the layout viewport, dvh shell
   * with a 100% fallback), so one chain serves all three viewports with no
   * per-size branch to drift. */
  it.each([
    [390, 844],
    [414, 896],
    [375, 667],
  ])('the chain is viewport-relative at %i×%i', (width) => {
    expect(width).toBeLessThanOrEqual(560);
    expect(pageRootRule).toMatch(/min-height:\s*100%;/);
    expect(page).not.toMatch(/min-height:\s*(?:844|896|667)px/);
    expect(phoneTierRule).toMatch(/env\(safe-area-inset-bottom, 0px\)/);
    expect(slackBandRule).toMatch(/top:\s*100%;/);
  });
});
