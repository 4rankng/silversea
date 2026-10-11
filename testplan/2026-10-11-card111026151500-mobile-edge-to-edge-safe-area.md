# Case: card 111026151500 — mobile edge-to-edge: no top/bottom gap on Android + iOS

- Case ID: 2026-10-11-card111026151500-edge-insets
- Reported: 11/10/2026 15:15 (owner directive — class assurance, not one screenshot)
- Status: FIXED (11/10 15:5x) — evidence below; re-run contract suites green before closing

## Reproduction (class definition)

Any mobile surface (phone tiers ≤640 / ≤1023, portrait and landscape, browser
tab and installed PWA standalone) where one of:

1. an unpainted or differently-toned band runs from the app's visual end to
   the physical screen edge (top or bottom);
2. the safe-area band is ~2× the system inset (inset counted twice — the
   091026164700 defect class);
3. interactive content or the topbar sits under the notch / status bar /
   home indicator (inset never counted).

Expected: every shell paints edge-to-edge and counts each safe-area inset
exactly once per surface; landscape clears left/right cutout insets.

## Evidence basis

- Prior class instances: card 091026164700 (double bottom inset, fix 5245061d),
  card 20261004_327 (iOS viewport fill rework 4b7e091e), ef4c1d63 (iOS fill +
  bottom sheet), 0b13de09 (iOS safe-area lead rung).
- Current law: `frontend/src/styles/mobile-viewport-fill-contract.styles.test.ts`
  (bottom inset, src/pages only) + `mobile-gutter-contract.styles.test.ts`
  (left/right on `.app-body`).

## Fix + pins

- Sweep audit (workflow, read-only) over: shell core, driver shell, customer
  portal, login/out-of-shell, overlays (drawers/sheets/modals/nav bars),
  all `src/pages` + feature CSS for `env(safe-area-inset-top)` double counts,
  bare `100vh` without a `100dvh` pair, `min-height: 100dvh` scroll voids.
- New contract test: top-inset counted-once class law + landscape topbar
  L/R clearance + viewport-unit hygiene scanner (new test file; the existing
  bottom law stays untouched).
- Shared-owner fixes only; QA rungs at 390 portrait + 390 landscape with
  screenshots + computed-style assertions under `qa/`.

## Re-run before closing

Re-run the new contract tests + full FE suite + a 390 portrait/landscape
rung; cite evidence paths in the card before DEV_COMPLETED.

## Result (11/10)

Audit verdict: the shell architecture (plain 100% chain + 100dvh shell,
topbar-owned top inset, shell-owned bottom band, portal/driver own-surface
chrome) was already correct — verified file-by-file across shell, driver,
customer portal, login, and 20+ overlay surfaces. Fixed defects:

1. Landscape cutouts (iOS notch / Android display cutout, 47-59px): topbar
   (≤1023 + ≤640 tiers), slide-in sidebar, customer-portal mobile header /
   tab bar / sidebar, login page — all now ride
   `max(base, env(safe-area-inset-left/right))` inline clearance while
   painting to the physical edge. Portrait is a no-op (insets 0).
2. Standalone login: the hero panel now owns the status-bar strip
   (`padding-top: env(safe-area-inset-top)` on `.login-visual`, its navy
   surface paints the notch strip — no white band, readable clock).
3. Dialog caps: `.dtp-dialog`, customers record-table, PhotoViewer desktop
   image cap gained adjacent `100dvh` pairs; two inline styles
   (DebitSettlementRoundDialog, FuelEvidenceReviewPage) switched to `100dvh`.
4. Scroll-void class (the 327/091026164700 family): `ExpenseEntryPage` wrap
   and `debit-editor-page` now use the scrollport-relative `min-height: 100%`
   fill; the editor workspace rides `100dvh`.
5. New contract `src/styles/mobile-edge-inset-contract.styles.test.ts`:
   cutout law pins, standalone-login pins, top-inset counted-once class law
   (src/pages, 5-file allowlist of own-surface owners), and a repo-wide
   100vh-pairs-with-100dvh scanner.

Evidence: qa/2026-10-11_card111026151500_{root-lint,fe-tsc,fe-full-test,
make-build,contract-suites}.log — lint 0 err, tsc 0, FE 618 files/4655 tests
pass, build OK, contracts 5 suites/37 tests pass. UI rung
testplan/qa/scripts/edge-inset-rung.mjs → RUNG PASS (driver log
qa/2026-10-11_card111026151500_ui-driver.log; screenshots _ui-shell-390.png
[app bottom = 844 = viewport, topbar top = 0], _ui-landscape-844.png
[16px inline floors live], _ui-login-390.png [hero top = 0], _ui-dtp-390.png
[combined picker fits]). Real-device env() behavior (notch/home-indicator
nonzero) remains owner-device verification, as with every prior safe-area
card — desktop rungs prove rules live + no band; the nonzero-inset math is
pinned textually by the contract tests.
