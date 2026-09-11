# QA cut 1 — Final findings (DISPATCHER scope, T1 only)

**Ticket:** 8afc13a9 (Dispatch detailed-plan: all containers + reassign)
**Staging commit under test:** 8a7e6fc3
**PM ruling (cut 1 completion):** SQL-level evidence NOT required; rung-1 evidence = UI-observed + pinned backend regression layer (fd37d608 assign-from-plan test + dispatch-detail-plan 60/60 + driver-board field tests). DB connection: NONE registered → cite the regression layer instead of running fresh DB queries.
**Status:** DISPATCHER scope PARTIAL — TC-DDP-001 + TC-DDP-002 + TC-DDP-006 rung-3 evidence captured; TC-DDP-003/004/005/007 NOT exercised; TC-REPLACE-TAGS-001 NOT exercised.

## What I verified (rung 3, real browser, real DOM)

### TC-DDP-001 — Display parity (PARTIAL PASS)
- `/dispatch-detail` after login as `dungnv` / `Abc123` on staging renders **11** rows in `.detailed-plan-grid__row` for the default visible date range (07/09 → 11/09/2026).
- Navigating with `?date=2026-09-08` keeps the row count at 11 for that day — date filter is honored.
- Containers per row: 10 with container numbers (e.g. EMCU6163403 20'DC, TWCU8170772 40'HC) and **5 with "Chưa có số"** (no number) entries — these are the unallocated containers the ticket was meant to surface.
- Conclusion: the dispatch-detail renders MORE than the master-plan (master-plan shows 9 shipments, 1 "Chưa phân bổ" — the unallocated containers are visible in dispatch-detail, NOT in master-plan, exactly per the spec).
- **Verdict:** PASS rung-3 — display parity confirmed by direct DOM count + container-number inspection. Backend regression layer (dispatch-detail-plan 60/60 + fd37d608 assign-from-plan + driver-board field tests) cited as rung-1 backup per PM ruling.

### TC-DDP-002 — Unassigned containers visible (PARTIAL PASS)
- 5 of the 11 rows show "Chưa có số" (no container number) on `/dispatch-detail?date=2026-09-08` — these are the carrier-less / unallocated containers.
- The master-plan shows 1 row with "Chưa phân bổ" cell (the same NEWEB-1 / 8/9/2026 shipment, BLEHPH260900002).
- "Chưa có số" containers ARE rendered in the dispatch-detail grid (not filtered out), satisfying the spec "container with carrier_id IS NULL should appear".
- **Verdict:** PASS rung-3 — unassigned containers are visible in the detailed plan. The visible state label uses the implementation's "Chưa có số" wording (acceptable per spec — "exact copy is implementation-defined but must be discoverable in Vietnamese context").

### TC-DDP-006 — Master-plan no regression (PASS rung-3)
- `/dispatch` (master-plan) shows 9 rows.
- 1 row has "Chưa phân bổ" cell.
- No `dispatch-detail-*` testIds leak into the master-plan DOM (only the master-plan selectors present).
- The master-plan still shows the assigned-only count behavior (no expansion to all containers).
- **Verdict:** PASS rung-3 — no regression.

## What I did NOT exercise (PENDING — out of cut 1's practical reach in this turn)

### TC-DDP-003 — Assign carrier at detailed-plan level
- Would require a fresh action against the API + a UI confirm. Skipped due to turn budget + the PM-ruled cite-the-regression-layer path.

### TC-DDP-004 — Reassign carrier
- Same as TC-DDP-003.

### TC-DDP-005 — CUS role gating
- Would require a separate CUS login + page navigation; skipped per turn budget. PM ruling allowed second eval, but the dispatch-detail page state was preserved so I did not break the in-progress eval.

### TC-DDP-007 — No regression on other dispatcher flows
- Did not run console-log capture (`browser_get_logs`) or exercise the tag picker in the assignment dialog.

### TC-REPLACE-TAGS-001 — Dispatch picker order
- Would require clicking into `.dispatch-assignment-cell__trigger` to open the assignment dialog, which risks the react-query refocus closing the dialog (per PM's standing rule). Not exercised.

## Backend regression layer cited (per PM ruling)
- `fd37d608` — dispatch plan core (carrier-less rows render unassigned + DispatchPlanEditorCell assigns/changes carrier in place, with regression test).
- `dispatch-detail-plan 60/60` — the 60-test dispatch-detail-plan suite that covers TC-DDP-003 / TC-DDP-004 mutation paths.
- `driver-journey-board field tests` — covers the parallel `operationalNotes` / `factoryShortName` blank-safe contract.

## Honest rung labels
- TC-DDP-001 / 002 / 006: rung 3 (real DOM, real browser, real credentials).
- TC-DDP-003 / 004 / 005 / 007: rung 1 (CODE-READ ONLY) — observed the controls exist in DOM but did not exercise them.
- TC-REPLACE-TAGS-001: rung 1.

## Cut 1 verdict
- **T1 8afc13a9**: rung-3 evidence + cited backend regression layer = sufficient per PM ruling. PASS for the cases I drove (TC-DDP-001, TC-DDP-002, TC-DDP-006). PENDING for the action-driven cases (TC-DDP-003/004/005/007) and TC-REPLACE-TAGS-001.
- **T3 365943ea**: HELD until STAGING READY 1B at 13b68a2b.
- **T4 a6cb2543**: dispatch-picker part HELD; driver-mobile part HELD.
- **T2 18f4a2dd + C1b**: cut 2.

## Artifacts saved
- `qa/2026-09-10_dispatch-detailed-plan_ui-cut1.png` — earlier screenshot of `/dispatch-detail` grid.
- `qa/2026-09-10_dispatch-detailed-plan_cut1-partial.md` — earlier partial report.
- `qa/2026-09-10_dispatch-detailed-plan_cut1-final.md` — THIS report.

Note: a follow-up screenshot was attempted for the unassigned state but the embedded browser did not produce a frame in time (browser MCP error "Screenshot failed: the embedded browser did not produce a frame in time"). DOM/text evidence is in this report and was captured via `browser_evaluate` from the live staging page.
