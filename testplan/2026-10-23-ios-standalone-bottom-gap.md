# Regression case — iOS standalone bottom-gap (gray band at physical bottom)

- Date: 2026-10-23 · Branch: `fix-ios-gap` · Consult: Gemini + DeepSeek
  (`/tmp/silversea-army2/consult-ios-gap-deepseek.md`, `…-gemini.md`)
- Reported: app already shipped `viewport-fit=cover`, apple meta set,
  standalone manifest, 6-7 safe-area paddings and 100dvh — a gray band
  still showed at the physical bottom edge when launched from the Home
  Screen (iOS standalone WKWebView).

## Ranked causes (consult) → shipped counter-measures

| # | Cause (rank) | Counter-measure (standalone-gated) |
|---|---|---|
| 1 | WKWebView standalone reports visualViewport ~62px short of screen — no CSS reaches that strip; only COLOR covers it | `html, body, #root` all paint `var(--bg)` (base.css) + driver `:has()` mirrors for #root (bottom-nav.css) |
| 2 | 100dvh resolves short of the physical bottom in standalone | `.app` min-height/grid-template-rows chain `100vh → 100dvh → 100lvh → var(--app-height, 100lvh)` (app-shell.css) |
| 3 | body position:fixed → ICB collapse | verified ABSENT (retired by card 20261004_327) — regression pin `expect(base).not.toMatch(/#root…position: fixed/)` kept green |
| 4 | env() can report 0 after client-nav / units lie | `lib/ios-standalone-viewport.ts` publishes `--app-height` from visualViewport (standalone AND divergence >4px; keyboard shrink >120px ignored; re-measure on resize/pageshow/focus) |
| 5 | residual unpainted strip | `html.pwa-standalone body::after` fixed strip, height env(safe-area-inset-bottom, 0px), `background: inherit` (tracks body's live tone), z `calc(var(--z-sticky) - 1)` (below the fixed bottom nav), pointer-events none, decorative pseudo (a11y-tree-free = aria-hidden equivalent) |

Gating law: every standalone-only rule hangs off the hybrid
`pwa-standalone` html class (`lib/pwa-standalone.ts` — iOS WebKit evaluates
the display-mode media query FALSE in standalone) with
`@media all and (display-mode: standalone)` belt-and-braces forms. Plain
browsers must resolve exactly as before (contract-pinned in
`src/styles/ios-gap.styles.test.ts`).

## Reproduction

- Device (true rung): iPhone → Add to Home Screen → launch standalone →
  scroll any page to its end / open-close keyboard / app-switcher
  round-trip → observe the physical bottom edge.
- Browser-sim (evidence rung here): `qa/2026-10-23-ios-gap/drive.mjs`
  injects `navigator.standalone = true` + `visualViewport.height =
  innerHeight − 62` (the consult's reported bug geometry) in headless
  Chromium @390×844 and reads computed styles.

## Expected

- Standalone: html/body/#root/.app all resolve to the page canvas tone
  rgb(227,232,229); `--app-height` = measured vv height; `.app` min-height +
  grid rows + height = that value; strip pseudo `content: ""`, fixed, z 99,
  pointer-events none. No system gray anywhere at the bottom edge.
- Plain browser: NO `pwa-standalone` class, NO `--app-height`, `.app`
  minHeight 0px / rows 844px (100dvh unchanged), strip `content: none`.

## Results (2026-10-23)

- Unit + contract pins: `src/lib/ios-standalone-viewport.test.ts` (7 cases),
  `src/styles/ios-gap.styles.test.ts` (5 pins incl. leak guard) — pass.
- Browser-sim: `qa/2026-10-23-ios-gap/computed-styles.json` — A/B/C/D all as
  expected (C: `.app` min-height 782px under mocked 62px-short viewport;
  D: browsers untouched). Screenshots A–D + drive.log alongside.
- Device rung: PENDING USER — iOS caches manifest/viewport at install time;
  the home-screen icon MUST be deleted and re-added (Share → Add to Home
  Screen) before judging this fix on hardware.
