# HANDOFF — 2026-10-18 — staged to prod: 171026123000 roster-inactive-units + 171026154000 cargomode-filter

Controller: watchdog cron (Hermes), main checkout `/Volumes/LexarSSD/projects/silversea`.
Merged on 2026-10-18 ~02:10 local. **BOTH** feature branches had gates-green
HANDOFFs sitting on orphan worktrees waiting for trunk merge; golden rule
says merge → push → staging → prod AUTOMATICALLY once scoped gates pass,
so they are shipped together in a single deploy chain.

## Card 1 — 171026123000-roster-inactive-units (merged b347bec4)

**Goal**: `/hr/roster` dropdown "Lọc theo bộ phận" liệt kê unit INACTIVE
("QA Audit Unit 0914") sau khi staging deactivate 5/5; cột BỘ PHẬN cũng
render tên INACTIVE. Owner direction 2026-10-17 (hướng b): ẩn unit
INACTIVE ở roster, không đụng data, không sửa purge tool.

**Code changes** (5 backend services + 1 frontend page + tests):
- `backend/src/services/{user, dispatch-plan-conflict-scan → -382,
  dispatch-planning-detail-plan, trip-create, trip-figure-updates,
  trip-lifecycle-ops}.service.ts` — hide-INACTIVE projection; conflict scan
  service split into detail-plan.
- `backend/src/tests/{hr-roster-read, dispatch-overlap-day-only-trips,
  deposit-bill-suggestions}.test.ts`
- `frontend/src/pages/HrRosterPage.{tsx,test.tsx}` + `TripListPage.tsx`
  + `accounting/DepositRefundTrackerPage.{tsx,test.tsx,css}` (latter 3
  share a dep-bill-lookup cleanup patch with card 2).
- `testplan/2026-10-18-card-171026123000-roster-inactive-units.md`

**Gates (scoped, owner-scoped conventions)**:
- `pnpm lint`: 0 errors, 5 warnings (all pre-existing).  exit 0
- `cd backend && npx tsc --noEmit`: exit 0
- `cd frontend && npx tsc -b`: exit 0
- `make build`: built in 13.33s, exit 0
- BE scoped (hr-roster-read + qa-fixture-purge): 22/22 pass, exit 0
- FE scoped HrRosterPage: 4/4 pass, exit 0
- UI driver 11/11 pass (admin port :7178, dev DB :5441): Bộ phận '—',
  dropdown "Tất cả bộ phận" (no INACTIVE), API `/auth/users/roster`
  identity clean, DB fixture unchanged (read-only hide), 768/390 ok.
- Full BE/FE suites: NOT RUN (owner-scoped gates; scoped suites covered
  every test file touching changed modules).
- `/Users/dev/.paseo/worktrees/1njkloyy/fix-171026123000-roster-inactive-units/qa/2026-10-18_roster-inactive-units_backend-tsc.log`
  ...single FAIL captured 00:30 in `*-red.log` was superseded by green
  rerun 00:33 after comment fix; final state is exit 0.

## Card 2 — 171026154000-cargomode-filter (scope C) (merged after Card 1)

**Goal**: on `DispatchDetailPlanPage`, when only one lot is drivable, the
"Gán xe nhóm" (assign a truck to a group) action must explain WHY it is
disabled in plain text — selection-bar reason, not just an inert disabled
button — so the operator reads the reason instead of guessing.

**Code changes** (frontend only, plus QA artifacts):
- `frontend/src/pages/DispatchDetailPlanPage.{tsx,
  lcl-assign-reason.test.tsx}` — selected-group reason text surfaced,
  `aria-disabled="true"` + `aria-describedby` pointing at reason, handler
  guard on click, replaced `disabled` CSS with `[aria-disabled='true']`
  (DisabledActionTip variant description-as-text pattern).
- `frontend/src/pages/DispatchPlanPage.css` — styling update for the
  aria-disabled button state.
- Testplan: `testplan/2026-10-17-card-171026154000-cargoMode-filter.md`
  + `testplan/qa/scripts/2026-10-18-171026154000-c-assign-reason.mjs`
- Scope A (`cargoMode` filter on dispatch) was ALREADY in main before this
  worktree was created; re-verified here: BE regression 2/2 + FE cargo-mode
  test + dispatch-page vitest pass. **No new code** for A in this merge.

**Gates**:
- `cd backend && npx tsc --noEmit`: EXIT:0
- `pnpm lint`: EXIT:0
- BE `cargoMode` regression test: 2/2 pass, EXIT:0
- FE `tsc -b`: EXIT:0
- FE hardening rerun (`DispatchDetailPlanPage`): EXIT:0
- FE dispatch-pages vitest (scoped): EXIT:0
- UI driver: 19/19 checks pass — selected-bar reason visible verbatim,
  aria-disabled + aria-describedby + title set, guarded click writes no
  API, dialog opens when two lots drivable, phone reason text present,
  DB-driven rows unchanged.
- Evidence: `qa/2026-10-18_171026154000_c_*` (be-tsc, lint,
  be-cargoMode-test, fe-tsc, fe-hardening-rerun, fe-dispatch-pages,
  driver.log, 5 ui screenshots).

## Merge mechanics

- Both branches branched off `main @ 1105d184`. File overlap on
  `TripListPage.tsx` + `accounting/DepositRefundTrackerPage.{tsx,css,test.tsx}`
  + `useTripFormDispatch.ts` + `testplan/...deposit-bill-lookup-digits.md`
  was IDENTICAL diff in both branches — git auto-merged with no conflict.
- HANDOFF.md content conflict each merge — resolved by writing this
  combined document covering BOTH cards (replaces both per-card
  HANDOFFs which are now archived in the merged-in worktrees).

## What did NOT ship this cycle

- `fix-171026205400-bai-ha-regression-rb1` (FB-020): WIP branch, gated
  scoped (lint+tsc+scoped BE+scoped FE all green, FE FULL vitest
  5059/5060 with 1 PRE-EXISTING dev-port-contract offender unrelated to
  this ticket). Not merged because agent `rb2` is STILL ALIVE on the
  same ticket slug with active eslint+tsc children producing WIP commits
  in `fix-171026205400-bai-ha-regression-rb2`. Will be reviewed next
  cycle once rb2 finishes or hits its gated-deliverable state.
- `fix-fb002-fb030-segment-input` (FB-002 + FB-030/075): agent `a2fd54b`
  is idle, commit `5ef5ace7` on branch is the fix for FB-002 (Enter on
  hand-typed segment saves through host). Gates not yet verified; HOLD
  for next cycle unless gates evidence appears.

## Deploy chain (pending)

1. `git push origin main` (this branch)
2. `make demo` → staging vantai.tingting.vip
3. `make deploy` → prod silversea.tingting.vip
4. `GET /api/health` on both, capture buildHash

(Watchdog will execute this chain automatically per skill golden rule.)
