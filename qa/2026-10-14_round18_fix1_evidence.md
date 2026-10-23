# Round 18 FIX 1 evidence — ticket 141026001010 (dispatch table uneven row heights)

Driver: `qa/drivers/round18-fix1-*.mjs` (login dieuvan, token pre-injected per
puppeteer-spa-auth; local stack `make dev` ports 5441/3002/7175, worktree at
5ef12393 + this fix).

## Root cause (code + live measurement)

`26d3f1f7` (card 091026091550, the one-line header law) rebalanced the
detail-plan fixed colgroup and cut `col--assignment` 12% → 7.5%. At the live
1129px table (1440 viewport) the Điều phối column measured **85px**: the
plate·driver vehicle group wrapped to 2 lines (34+31px) and the actions row
wrapped to 2 lines (30+28px), so assigned rows rendered **164–198px** beside
**97px** unassigned rows — the R22 compact-row contract (case
QA-2026-10-03-R22) regressed. Table band cells were equal per row (table
layout), but row heights were wildly uneven driven by the one starved column.

## Fix

`DetailedPlanGrid.css` colgroup rebalanced: assignment back to its
pre-regression **12%** (125–141px live), donors re-measured with sort-button
chrome on the 1041px worst-case canvas — schedule 17% (floor 16.62%),
route 17.5% (floor 17.2%), notes 10.25% (label floor 5.84%). Sum = 100.

## Before → after (live, /dispatch-detail TABLE band, 14 rows sampled)

| viewport | before rows (px) | after rows (px) | assignment width | vehicle group |
|---|---|---|---|---|
| 1144 | 97–198, assigned 164+ | 81–117 | 85 → 125px | 66px stacked → 34px one line |
| 1280 | 97–198 | 81–98 | 85 → 141px | 34px one line |
| 1440 | 97–198, assigned 164–179 | 81–117 | 85 → 135px | 66 → 34px one line |

Header wrap check after: `scrollWidth > clientWidth` on every `th` = 0 wraps
at 1144/1280/1440 (before the fix, the 7.5% state ALSO wrapped the schedule
and route sort-button headers by 4–5px at 1144 — the rebalance funds their
button chrome as well).

Card bands (≤900 container) unchanged: per-cell height differences there are
the pinned compact-card record layout, out of this ticket's scope.

## Pins

- New: `DetailedPlanGrid.rowheights.styles.test.ts` (4 tests) — assignment
  share = 12%, donors ≥ measured floors, shares sum 100, vehicle-group keeps
  the inline pair capability.
- Updated: `DetailedPlanGrid.test.tsx` column-shares pin (16.25/16.75/16.25 →
  17/17.5/10.25 + assignment 12).

## Gates (this commit's scope)

`npx vitest run src/features/dispatch/detailed-plan/` — 27 files / 314 tests
pass. Full round gates in `qa/2026-10-14_round18_gates.log`.

Rung: UI DRIVEN for the measurement (screenshots
`qa/2026-10-14_round18_fix1_after_{1144,1280,1440}.png`; no data write
involved — read-only layout probe, DB state unchanged by the driver).
