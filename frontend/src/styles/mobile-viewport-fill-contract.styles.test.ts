import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
/* The ≤640px phone-tier `.shipments-page { … }` override (rework 2026-10-09:
 * one phone band, one tier — the tier zeroes the page's own trailing padding
 * because the ≤640 shell clearance below is the single trailing band). */
const phoneTierRule =
  page.match(/@media \(max-width: 640px\)\s*\{[^}]*\.shipments-page\s*\{[^}]*\}/)?.[0]?.match(/\.shipments-page\s*\{[^}]*\}/)?.[0] ?? '';

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
    // Rework 2026-10-09 (owner ruling): the page keeps only its flat rhythm
    // padding — the bottom safe area is counted ONCE, by the shell clearance
    // pin below. A second env() term here doubled the iPhone band (~120px).
    expect(rule).toMatch(/padding-bottom:\s*40px;/);
    expect(rule).not.toMatch(/env\(safe-area-inset-bottom/);
  });

  it('the phone tier keeps the scrollport-relative fill — no viewport-locked height', () => {
    const rule = phoneTierRule;
    expect(rule, '≤640 .shipments-page override exists').not.toBe('');
    // Rework 2026-10-09: the phone tier carries NO trailing padding at all —
    // the ≤640 shell clearance (max(16px, env)) is the single trailing band.
    expect(rule).toMatch(/padding-bottom:\s*0;/);
    expect(rule).not.toMatch(/env\(safe-area-inset-bottom/);
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
    // Rework 2026-10-09 (owner ruling "kill the bottom dead band"): the ≤640
    // shell band is exactly max(16px, env(safe-area-inset-bottom, 0px)) — one
    // flat floor plus ONE env() count for the whole app scroll. The 28px+env
    // term it replaces stacked with page-level env terms into a ~120px dead
    // band on home-indicator iPhones.
    expect(responsive).toMatch(
      /\.app-body, \.content \{ padding: var\(--app-body-pad-t, 14px\) var\(--app-body-pad-x\) max\(16px, env\(safe-area-inset-bottom, 0px\)\);/,
    );
    expect(responsive).not.toMatch(/calc\(28px \+ env\(safe-area-inset-bottom/);
  });

  /* AC2 evidence — 390×844, 414×896 and 375×667 all land in the ≤640 tier and
   * every declaration the chain relies on is unit-relative (100% of the
   * scrollport, dvh shell with a 100% fallback), so one chain serves all three
   * viewports with no per-size branch to drift. */
  it.each([
    [390, 844],
    [414, 896],
    [375, 667],
  ])('the chain is viewport-relative at %i×%i', (width) => {
    expect(width).toBeLessThanOrEqual(640);
    expect(pageRootRule).toMatch(/min-height:\s*100%;/);
    expect(page).not.toMatch(/min-height:\s*(?:844|896|667)px/);
    expect(phoneTierRule).toMatch(/padding-bottom:\s*0;/);
  });
});

/* Class law (rework 2026-10-09, owner ruling): the phone trailing band is
 * counted ONCE per scroll — the ≤640 shell (`.app-body, .content`) owns the
 * max(16px, env(safe-area-inset-bottom)) term. No page surface may count the
 * bottom safe area again. The allowlist is NOT a loophole: it names surfaces
 * that own their clearance OUTSIDE the shell scrollport (fixed bars, portaled
 * sheets, out-of-shell pages, overlay bodies) and therefore count env() for
 * their own surface only — the documented law in docs/design-guidelines.md. */
const ALLOWED_ENV_BOTTOM_FILES = new Set([
  'DriverTripDetailPage.css', // fixed driver task bars clear the Home indicator
  'ClerkShipmentCreatePage.css', // .csc-page owns clearance (shell neutralized via :has)
  'CustomerPortalLayout.css', // portal scrollport + its own fixed tab bar
  'LoginPage.css', // renders outside the app shell
  'TripEditPage.css', // fixed mobile edit bar
  'AuditLogPage.css', // detail-modal body is an overlay surface
  'customer-form.css', // drawer action bar is an overlay surface
  'ShipmentContainersPage.css', // portaled bottom-sheet rule ONLY (asserted below)
]);

function pageCssFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) pageCssFiles(p, acc);
    else if (e.name.endsWith('.css')) acc.push(p);
  }
  return acc.sort();
}

describe('phone-band trailing clearance class law (rework 2026-10-09)', () => {
  it('no page CSS re-counts the bottom safe area outside the allowlist', () => {
    const offenders: string[] = [];
    for (const file of pageCssFiles(resolve(root, 'src/pages'))) {
      const base = file.split('/').pop() ?? file;
      // Comments are documentation, not declarations — strip them so the law
      // reads only real CSS declarations (a comment quoting the pattern must
      // not become an offender, nor hide one).
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const hits = [...text.matchAll(/(?:padding|padding-bottom)\s*:[^;}]*env\(safe-area-inset-bottom/g)];
      for (const hit of hits) {
        const idx = hit.index ?? 0;
        if (base === 'ShipmentContainersPage.css') {
          // The sheet rule only: every hit must sit inside the portaled
          // bottom-sheet rule (its own surface, outside the shell scrollport).
          const sheetSpans = [...text.matchAll(/\.shipment-container-ledger__inline-editor--sheet[^{]*\{[^}]*\}/g)].map(
            (m) => [(m.index ?? 0), (m.index ?? 0) + m[0].length] as const,
          );
          if (!sheetSpans.some(([a, b]) => idx >= a && idx < b)) {
            offenders.push(`${base}: ${hit[0].trim()}`);
          }
        } else if (!ALLOWED_ENV_BOTTOM_FILES.has(base)) {
          offenders.push(`${base}: ${hit[0].trim()}`);
        }
      }
    }
    expect(offenders, 'env(safe-area-inset-bottom) counted again in page padding').toEqual([]);
  });
});
