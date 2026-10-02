# Case QA-2026-09-27-02 — Dispatch master-plan (/dispatch): unified action toolbar, dense filter row

Source: PM design feedback (2026-09-27, dispatch surface screenshot of
`https://vantai.tingting.vip/dispatch`, ADMIN/DISPATCHER view at 1440px),
verbatim intent:

> "Currently /dispatch wastes around 120–150px of vertical screen real
> estate because the primary action button (+ Tạo lô hàng) sits in its own
> row above the search and filter controls, and the filter row itself is too
> tall. Consolidate everything below the top navigation into a single
> ~44–48px action toolbar: search input (max 280–320px), Chiều hàng dropdown
> next to it (8px gap), Bộ lọc button, flex-grow spacer, then the primary
> `+ Tạo lô hàng` action flush right. Drop standalone `Tìm kiếm` /
> `Chiều hàng` floating labels, tighten the global topbar search (max 360px,
> lower contrast) and the date picker (single-row body, height 36px)."

Case id: **QA-2026-09-27-02**. Card: `20260927_2`.

## Scope

Frontend-only polish on the dispatch planning surface:

- `frontend/src/pages/MasterPlanPage.tsx`
- `frontend/src/features/dispatch/master-plan/MasterPlanFilters.tsx`
- `frontend/src/features/dispatch/master-plan/MasterPlanGrid.css`
- `frontend/src/pages/DispatchPlanPage.css`
- `frontend/src/components/layout/topbar.css` (date trigger + dispatch
  surface contract only)

No schema, migration, backend route, RBAC or financial-calculation change.

The dispatch `MasterPlanFilters` already accepts an `action` prop
(`MasterPlanFilters.tsx:19-21, 316`). The fix is to actually use it:
remove the standalone toolbar row in `MasterPlanPage.tsx:82-89` and pass
the create button through `action={…}` so the action and the search +
filters + Bộ-lọc sit in **one** flex row.

## Bugs covered

| # | Defect (reproduced at 1440px, before) | Fix |
|---|---|---|
| 1 | "+ Tạo lô hàng" was rendered in its own `__toolbar` row above the filter row (`MasterPlanPage.tsx:82-89`); ~80–100px of vertical space stranded | Action moved into the `<MasterPlanFilters action={…}>` slot (already wired in `MasterPlanFilters.tsx:316`); the standalone toolbar row is removed |
| 2 | Filter row carried floating `Tìm kiếm` / `Chiều hàng` field labels rendered above each UUI control; the row measured 76px from UUI input label + control + outer gap. | Search input label stays the UUI floating affordance (control-size; already a11y label = `Tìm kiếm lô hàng`); the filter row's grid is rebuilt to flex with a single 36px control-height row (using existing `--control-default-h`); `Chiều hàng` uses the dropdown's own affordance (selected value shown, no extra standalone label). |
| 3 | Filter row's outer `gap: 10px` + multi-row grid (search 5 cols, direction 2 cols, allocation/date 2–9 cols, advanced trigger hidden by `display: none`) and the standalone toolbar row left a visible stack: search row alone is ~56px, then the filter content row is ~80px | All filter controls + `Bộ lọc` + the action sit in one flex row, height ≈ 36px (border height) + 8px×2 vertical padding = 52px total; the page gains ~120–150px of vertical space |
| 4 | `Bộ lọc` button sat visually identical regardless of how many filters were active; the badge count existed in the DOM but had no on-screen hint beyond the parent aria-label | `Bộ lọc` text keeps the icon, the active-count badge (already in `__count` markup) inherits the primary accent surface and is always rendered when `activeDrawerFilterCount > 0` |
| 5 | Global topbar search stretched the full canvas (`flex: 1` plus `min-width: 240px`); the page also has a local-table search right below it. Two stacked search bars wasted width and competed for the operator's eye. | Topbar search clamp: `max-width: 360px` and slightly lower visual contrast (`placeholder / icon` use `--ink-3` already; no border-radius change). Behaviour unchanged (still opens `SearchDropdown`). |
| 6 | `MonthNavigator` topbar trigger rendered two stacked rows (label `Tháng 9/2026` over period `01/09 – 30/09`); effective height ≈ 56px. | When the period is configured and the current view uses it, render **one row**: `Tháng 9/2026 · 01/09 – 30/09 ▾` with height 36px. Mobile/driver topbar keeps the two-line identity (greeting is also two-line there). |

## Expected behavior

1. `/dispatch` mounted at 1440px shows a single toolbar row directly under
   the topbar: `[ 🔍 Tìm theo B/L, Booking... ] [ Chiều hàng ▾ ] [ ⫘ Bộ lọc
   (N) ] ───────── (flex spacer) ───────── [ + Tạo lô hàng ]`. The
   standalone action toolbar row is gone.
2. The toolbar row height ≈ 44–48px including its 8px×2 vertical padding
   (controls standardized at `--control-default-h` = 34px so the row
   measures ≈ 50px).
3. The page saves ≥100px of vertical space between the topbar and the
   `Sản lượng:` cargo summary, at the same data state.
4. The standalone field labels (`Tìm kiếm`, `Chiều hàng` rendered above
   controls) disappear; the UUI affordances stay (placeholder + selected
   value).
5. `Bộ lọc` shows its count badge `2` when at least one filter is applied
   (the `__count` element already exists; the toolbar applies a primary
   accent surface without an outline per house density contract).
6. The topbar global search is capped at `max-width: 360px`; the dispatch
   local search is visibly the wider of the two.
7. The `MonthNavigator` topbar trigger renders a single body row at
   36px; the second-line identity line stays available for the driver
   topbar (driver topbar uses `.topbar--driver` and stays untouched).

## Evidence (local dev, browser-driven)

- `qa/2026-09-27_dispatch-toolbar/2026-09-27_dispatch-toolbar_ui-{1280,1440,1920}-top.png`
- `qa/2026-09-27_dispatch-toolbar/2026-09-27_dispatch-toolbar_ui-{1280,1440,1920}-full.png`
- `qa/2026-09-27_dispatch-toolbar/2026-09-27_dispatch-toolbar_qa.log`
  (DOM probes + pixel measurements of the toolbar `boundingClientRect`).

## Regression pins

- `frontend/src/features/dispatch/master-plan/MasterPlanFilters.test.tsx` →
  keeps the existing phone-toolbar contract (search + direction + Bộ lọc
  visible, advanced fields collapsed) and adds: **the `Bộ lọc` count
  badge renders when `activeDrawerFilterCount > 0`** (1 new case).
- `frontend/src/pages/MasterPlanPage.tsx` → no standalone
  `dispatch-plan-page__toolbar` row is rendered anymore (the old `≤ 1`
  rule was: toolbar exists as a sibling of `MasterPlanFilters`; the new
  rule is: toolbar is gone). Pin via a new test asserting
  `dispatch-plan-page__toolbar` query returns null.
- `frontend/src/styles/tokens.css` stays untouched.

## Manual re-run (any agent, < 1 min)

```bash
# 1. local dev seed (master plan must have rows); login as dieuvan
make seed

# 2. typecheck + the two existing pin tests
cd frontend && npx tsc -b && pnpm test -- MasterPlanFilters DispatchPlanPage

# 3. browser capture — uses agent-browser (token pre-staged; see qa-user-guide-docx)
agent-browser --session qa-toolbar --headed open http://localhost:7175/dispatch
agent-browser --session qa-toolbar eval "() => document.querySelector('.dispatch-plan-page__toolbar')"
# expected: null
agent-browser --session qa-toolbar eval "() => document.querySelector('.master-plan-filters__actions .btn')?.textContent"
# expected: "Tạo lô hàng"
```

The first run after landing should also report any visual collateral
damage on `/dispatch-detail` (uses the same shell, separate
`DispatchDetailPlanPage.tsx` — it does NOT render a primary create action,
so it stays untouched).
