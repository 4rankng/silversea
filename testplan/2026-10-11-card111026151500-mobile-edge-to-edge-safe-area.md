# Case: card 111026151500 — mobile edge-to-edge: no top/bottom gap on Android + iOS

- Case ID: 2026-10-11-card111026151500-edge-insets
- Reported: 11/10/2026 15:15 (owner directive — class assurance, not one screenshot)
- Status: OPEN (fixing in this card)

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
