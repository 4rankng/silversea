# Case MOBFOOT-1016 — /shipments phone band: empty grey band below the last lot card (2026-10-16)

Source: owner report 2026-10-16 21:07 SGT from a real phone (screenshot
`img_4391901f3bfc.jpg`, 1177×2560 ≈ 393×853 @3x). Tracker: GitHub issue #8.

## Reproduction (done before any code change)

Environment: staging `vantai.tingting.vip` build `227a08b2` (= prod cutover)
and local dev (vite :7175 / backend :3002), CUS account `cus`.

1. Drive the SPA at 393×853 mobile emulation to `/shipments` (token injected
   pre-navigation per `puppeteer-spa-auth`).
2. Scroll `main.app-body` (the shell scrollport) fully to the bottom.
3. Observe the terminal region: last lot card/table → `nav.ds-pagination`
   (white, h≈117 CSS) → empty `--bg` grey band (rgb(227,232,229)) to the
   physical bottom edge.
4. Owner screenshot pixel truth: band = rows 2383–2559 physical = 177 px @3x
   = **59 CSS px**, no dark pixels inside (empty); the white block above it
   carries 5 control text rows (the wrapped pagination).

Driver: `testplan/qa/scripts/1016-mobile-footer-band-rung.mjs`
(artifacts `qa/1016-mobile-footer/before-*`).

## Root cause (selectors + computed heights)

- The page DOM ends at `nav.ds-pagination` — there is **no** stray footer,
  empty-state block or bottom nav on this route (bottom nav is driver-only).
- The band is the shell phone trailing clearance
  `frontend/src/styles/responsive.css:254`:
  `.app-body, .content { padding: … max(16px, env(safe-area-inset-bottom, 0px)) }`
  painted in page tone (`.shipments-page { background: var(--bg) }`):
  34 CSS px on-device (safe-area 34), 16 CSS px where env()=0.
- Remaining ~25 CSS px on-device is iOS dynamic-viewport growth (100dvh
  shell) that the inner div scroller does not re-absorb after the Safari
  toolbars collapse (window-scroll compensation does not reach div
  scrollports). Transient, shell-wide, documented as residual.
- Perception trigger: the white pagination surface ends abruptly above
  page-tone grey → reads as a detached empty footer under the list.

## Expected behavior after fix

- Phone band (≤640px) on `/shipments` with a populated worksheet: the
  terminal pagination block owns the bottom edge — its white surface runs to
  the physical bottom, the safe-area clearance lives INSIDE the pagination's
  bottom padding (`12px + env(safe-area-inset-bottom)`), and the shell's grey
  trailing band is scoped out while the pagination is mounted (empty/loading
  states keep the standard shell band, matching sibling pages). The
  clearance override is declared AFTER the base `.cus-dashboard-viewport >
  .ds-pagination { padding: 12px }` rule — same selector/specificity, media
  queries add none, so source order is load-bearing (the first cut placed it
  above and the rule was cascade-dead; caught in independent review).
- Desktop/tablet widths and every other page keep the existing shell
  trailing band (no global `display:none`, no shell-wide change).
- 2026-10-09 "single, counted-once trailing band" ruling stays true in
  magnitude: the clearance is counted once, inside the terminal surface.

## Verification plan

- Re-run the rung driver at 375×812 and 393×853 after the fix: trailing
  region below the pagination paints white to the bottom edge
  (`trailingGrey` = pagination's own padding, shell padding 0).
- Sibling sweep at 375×812: `/shipments/:id` (detail) and one form page —
  shell trailing band intact (unchanged), no horizontal scroll.
- Styles regression test pins the scoped rules (see
  `frontend/src/pages/ShipmentsPage.mobile-footer.styles.test.ts`).
- Gates: `cd frontend && npx tsc -b`, scoped + full `pnpm vitest run`,
  `pnpm lint`, `make build`.
