# HANDOFF.md — mobile UI/UX polish (all device sizes)

**Updated:** 2026-09-26 ~18:15 (+08)
**Controller:** omp session (user order: "use all mcp to polish UI UX of this app for all mobile devices size")
**Status:** COMPLETE — all fixes landed, gates green, sweep at −97.2% findings, artifacts saved. No deploy action taken.

## Goal

Systematically polish the frontend for every mobile/tablet size: audit every
route at every width, fix what the design law (`docs/design-guidelines.md`,
`frontend/docs/design-system.md`) says is wrong, prove it in a real browser.

## Delivered

- **Harness:** `frontend/mobile-ux-sweep.mjs` — 3 roles × 9 widths
  (360/390/414/430/600/768/820/1024 + 1440 control) × ~64 routes; detects
  hscroll / offscreen / clipped / sub-44 touch targets (bordered-field aware)
  / sub-11px text / page errors. Re-runnable; referenced by the case.
- **Sweep numbers:** baseline `clipped=1174 small=3424 tiny=253` →
  final `small=95, clipped=0, tiny=0, hscroll=0, offscreen=0, pageerrors=0`
  (`qa/2026-09-26_mobile-ux-sweep/findings{,-baseline}.json`).
- **Fixes (source commit `3a791229` + pins `ae916f87`):** hamburger 32→44;
  three ID-scoped `#root .btn` floor guards (phone / pointer:coarse / tablet)
  replacing page-owned 30/40px rules (incl. `/profit` dead rule,
  ExpenseListPage); blanket coarse floors for bare buttons/inputs
  (stab-pill 24, config-search 34, row-action 30, cus triggers 32, detailed-
  plan note 17 → 44); UUI combobox full-field tap surface (strip 16→42,
  tap-top/mid/bottom all focus+type — previously opened the list with dead
  typing); `.expense-add-btn` 44 on touch; recoverable `<small>` → 11px;
  finance `tr₫` tspan → 11px; collapsed sidebar rail 39→47 on coarse only;
  CustomersPage inline `min-height` moved to `.customers-quick-search`
  (inline styles beat every stylesheet — now pinned as a banned pattern).
- **Regression:** `frontend/src/styles/mobile-touch-floor.styles.test.ts`
  (10 cases) + `testplan/case-QA-2026-09-26-03-mobile-touch-floor-sweep.md`
  (repro/expected/evidence + residuals). Two existing contracts updated
  honestly: `operational-density` stale `height:auto` fragment dropped;
  `overlay-surface` registry followed the DebitFilterDropdown extraction.
- **Docs:** law-book changelog row (`docs/design-guidelines.md` §12).
- **Later-law ruling recorded:** 09-22 §5 (44px mobile) supersedes ticket
  6770b9cb (09-10, 30/32px phone scale).

## Residuals (documented, need operator ruling — NOT regressions)

1. **Inline text links in dense tables** (`/accounting`, `/config/trucks`,
   `/finance`, `/salary`): ~84×15. Fixing = padding that inflates data rows
   (§5 44px floor vs §5 density law). 68 sweep samples.
2. **`.fleet-tire-link--empty` 94×42** (2px under) — same density call.
3. Desktop-collapsed sidebar rail at fine-pointer widths stays 39px (mouse
   floor applies; coarse pointer gets 47px).

## QA artifacts (`qa/`)

- `2026-09-26_mobile-ux-sweep/` — findings.json (final), findings-baseline.json,
  before/after screenshots (`before-390-*`, `ui-360-*`, `ui-390-*`, `ui-768-*`)
- `2026-09-26_mobile-touch-floor_ui-driver.log` — probes + run results
- `2026-09-26_mobile-touch-floor_{lint,frontend-test,build}.log`

## Gates (all green, re-run after last change)

lint 0 errors · `tsc -b` 0 · vitest 464/464 files, 3062/3062 tests ·
`make build` 0. E2E skipped (frontend-only, gate-scoping rule; precedent
QA-2026-09-26-02).

## Concurrent-session note

A parallel session committed the source fixes as `3a791229` (+ probe
`65de3492`, scanner `432a1067`) while this session ran gates; this session
committed the pins/case as `ae916f87`. Probe script restored after a cleanup
collision (the other session adopted it). Remotes untouched.

## Next step

Operator call on residual #1/#2 (table-link touch floors vs density); then
staging cut per usual runbook if desired (no backend/migration involved).
