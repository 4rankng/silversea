import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = existsSync(resolve(process.cwd(), 'src')) ? process.cwd() : resolve(process.cwd(), 'frontend');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const responsive = read('src/styles/responsive.css');
const portal = read('src/pages/portal/CustomerPortalLayout.css');
const login = read('src/pages/LoginPage.css');

/* Mobile edge-to-edge contract (card 111026151500): the app looks seamless
 * on Android and iOS — no top gap, no bottom gap, on any phone model.
 *
 * Three laws, each an extension of the counted-once rule already pinned for
 * the bottom band (mobile-viewport-fill-contract.styles.test.ts):
 *
 * 1. CUTOUT LAW — a screen-edge-fixed surface paints to the physical edge
 *    and clears the notch with max(base, env(safe-area-inset-left/right)).
 *    Portrait insets are 0, so these rules are portrait no-ops; they exist
 *    for landscape rotation (iOS notch 47-59px, Android display cutouts).
 *
 * 2. TOP LAW — the top safe area is counted exactly once per surface. The
 *    shell topbar owns it inside the app shell; out-of-shell surfaces
 *    (login, customer portal header, portaled drawers/sheets) own their
 *    own clearance. No in-shell page may re-count env(safe-area-inset-top).
 *
 * 3. VIEWPORT-UNIT LAW — a mobile-reachable height capped at 100vh must
 *    carry an adjacent 100dvh companion (the house pair pattern), because
 *    100vh is the iOS LARGE viewport: a dialog capped at 100vh can be
 *    taller than the visible area while the bottom toolbar is expanded,
 *    hiding its last row of actions. Inline TSX styles use 100dvh only.
 */

/* The ≤1023px block's first bare `.topbar { … }` rule (the header band). */
const tabletTopbar =
  responsive.match(/@media \(max-width: 1023px\)\s*\{[\s\S]*?\.topbar\s*\{[^}]*\}/)?.[0] ?? '';
/* The ≤640px block's first bare `.topbar { … }` rule. */
const phoneTopbar =
  responsive.match(/@media \(max-width: 640px\)\s*\{[\s\S]*?\.topbar\s*\{[^}]*\}/)?.[0] ?? '';
/* The slide-in sidebar override inside the ≤1023px block (the base sidebar
 * rule sits above the media header and cannot match this anchored regex). */
const slideInSidebar =
  responsive.match(/@media \(max-width: 1023px\)\s*\{[\s\S]*?\.sidebar\s*\{[^}]*transform:\s*translateX\(-100%\)[^}]*\}/)?.[0] ?? '';

describe('mobile edge-to-edge — cutout law (landscape left/right insets)', () => {
  it('the shared topbar clears the notch sides at ≤1023px', () => {
    expect(tabletTopbar, '≤1023 .topbar rule exists').not.toBe('');
    expect(tabletTopbar).toMatch(
      /padding-inline:\s*max\(16px, env\(safe-area-inset-left, 0px\)\) max\(16px, env\(safe-area-inset-right, 0px\)\);/,
    );
    // The top inset stays counted once by the same rule.
    expect(tabletTopbar).toMatch(/padding-top:\s*env\(safe-area-inset-top, 0px\);/);
  });

  it('the shared topbar clears the notch sides at ≤640px', () => {
    expect(phoneTopbar, '≤640 .topbar rule exists').not.toBe('');
    expect(phoneTopbar).toMatch(/padding:\s*env\(safe-area-inset-top, 0px\) 10px 0;/);
    expect(phoneTopbar).toMatch(
      /padding-inline:\s*max\(10px, env\(safe-area-inset-left, 0px\)\) max\(10px, env\(safe-area-inset-right, 0px\)\);/,
    );
  });

  it('the slide-in sidebar paints to the edge while its content clears the cutout side', () => {
    expect(slideInSidebar, '≤1023 slide-in .sidebar rule exists').not.toBe('');
    expect(slideInSidebar).toMatch(
      /padding-inline:\s*max\(0px, env\(safe-area-inset-left, 0px\)\) max\(0px, env\(safe-area-inset-right, 0px\)\);/,
    );
  });

  it('the customer portal mobile chrome clears the notch sides', () => {
    const header = portal.match(/\.customer-shell__mobile-header\s*\{[^}]*\}/)?.[0] ?? '';
    expect(header, 'portal mobile header rule exists').not.toBe('');
    expect(header).toMatch(/padding:\s*env\(safe-area-inset-top, 0px\) 12px 0;/);
    expect(header).toMatch(
      /padding-inline:\s*max\(12px, env\(safe-area-inset-left, 0px\)\) max\(12px, env\(safe-area-inset-right, 0px\)\);/,
    );
    const tab = portal.match(/\.customer-shell__bottom-nav\s*\{[^}]*position:\s*fixed[^}]*\}/)?.[0] ?? '';
    expect(tab, 'portal fixed tab bar rule exists').not.toBe('');
    // The bottom inset stays in the shorthand (counted once); the inline
    // override below carries the cutout sides.
    expect(tab).toMatch(/padding:\s*6px 6px calc\(6px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    expect(tab).toMatch(
      /padding-inline:\s*max\(6px, env\(safe-area-inset-left, 0px\)\) max\(6px, env\(safe-area-inset-right, 0px\)\);/,
    );
  });
});

describe('mobile edge-to-edge — standalone login owns its edges', () => {
  // /login renders outside the app shell (App.tsx unauthenticated branch),
  // so no shell topbar counts the top inset for it — the page itself must.
  const mobileBlock = login.match(/@media \(max-width: 900px\)\s*\{[\s\S]*\}/)?.[0] ?? '';

  it('the hero panel pads below the status bar and paints the strip itself', () => {
    const visual = mobileBlock.match(/\.login-visual\s*\{[^}]*\}/)?.[0] ?? '';
    expect(visual, '≤900 .login-visual rule exists').not.toBe('');
    expect(visual).toMatch(/padding-top:\s*env\(safe-area-inset-top, 0px\);/);
  });

  it('the page clears the landscape notch sides; the footer keeps its single bottom count', () => {
    const page = mobileBlock.match(/\.login-page\s*\{[^}]*\}/)?.[0] ?? '';
    expect(page, '≤900 .login-page rule exists').not.toBe('');
    expect(page).toMatch(
      /padding-inline:\s*max\(0px, env\(safe-area-inset-left, 0px\)\) max\(0px, env\(safe-area-inset-right, 0px\)\);/,
    );
    const footer = mobileBlock.match(/\.login-footer\s*\{[^}]*\}/)?.[0] ?? '';
    expect(footer).not.toBe('');
    expect(footer).toMatch(/padding:\s*8px 20px calc\(16px \+ env\(safe-area-inset-bottom\)\);/);
  });
});

/* Top counted-once class law. The allowlist names page-level CSS files that
 * own their top clearance OUTSIDE the shell scrollport — overlay chrome,
 * fullscreen preview surfaces, and out-of-shell pages — mirroring the
 * bottom-band allowlist in mobile-viewport-fill-contract.styles.test.ts. */
const ALLOWED_ENV_TOP_FILES = new Set([
  'AuditLogPage.css', // detail drawer/modal header is an overlay surface
  'SettlementPrintPage.css', // fullscreen print-preview chrome owns its surface
  'ShipmentsPage.css', // .cus-shipment-drawer head is a portaled drawer surface
  'LoginPage.css', // renders outside the app shell — owns all four edges
  'CustomerPortalLayout.css', // portal's own fixed header owns its chrome
]);

function pageCssFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) pageCssFiles(p, acc);
    else if (e.name.endsWith('.css')) acc.push(p);
  }
  return acc.sort();
}

describe('mobile edge-to-edge — top inset counted once per surface', () => {
  it('no in-shell page CSS re-counts the top safe area outside the allowlist', () => {
    const offenders: string[] = [];
    for (const file of pageCssFiles(resolve(root, 'src/pages'))) {
      const base = file.split('/').pop() ?? file;
      // Comments are documentation, not declarations — strip them so the
      // law reads only real CSS (same rule as the bottom-band law).
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const hits = [...text.matchAll(/(?:padding|padding-top|padding-block-start)\s*:[^;}]*env\(safe-area-inset-top/g)];
      if (hits.length && !ALLOWED_ENV_TOP_FILES.has(base)) {
        offenders.push(`${base}: ${hits[0][0].trim()}`);
      }
    }
    expect(offenders, 'env(safe-area-inset-top) counted again in page padding').toEqual([]);
  });
});

/* Viewport-unit hygiene: every 100vh must travel with an adjacent 100dvh
 * companion (the house pair pattern — declared on the same line or the
 * immediately following line). 100vh alone is the iOS large viewport and
 * lets a capped dialog overhang the visible area behind the collapsed
 * toolbar. Inline TSX styles must use 100dvh directly. */
function srcFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) srcFiles(p, acc);
    else if ((e.name.endsWith('.css') || e.name.endsWith('.tsx')) && !e.name.includes('.test.')) acc.push(p);
  }
  return acc.sort();
}

describe('mobile edge-to-edge — 100vh always pairs with 100dvh', () => {
  it('no mobile-reachable viewport cap rides 100vh alone', () => {
    const offenders: string[] = [];
    for (const file of srcFiles(resolve(root, 'src'))) {
      const rel = file.slice(root.length + 1);
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes('100vh')) continue;
        const paired =
          lines[i].includes('100dvh') || (i + 1 < lines.length && lines[i + 1].includes('100dvh'));
        if (!paired) offenders.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
      }
    }
    expect(offenders, '100vh without an adjacent 100dvh companion').toEqual([]);
  });
});
