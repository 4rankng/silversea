# Round-19 fix wave handoff — UPDATED after merge + review pass (2026-10-14)

- Controller/session: opencode session, now in the TRUNK checkout
  `/Volumes/LexarSSD/projects/silversea` (the fix-round19-wave worktree was
  merged into main `c7dcc286` and reaped externally mid-session; the wave's
  commits survived verbatim as the merge's second parent).
- The wave was merged to main together with a PARALLEL trunk commit
  `747c7d7d` (FB-086: /shipments-detail regains add/remove rows — different
  files; it rides the same inheritance fix through useCusDetail.addContainer).

## Landed commits (oldest → newest, all on top of 1658ff96)

1. `81c38d9e` fix(shipments) **FB-086 / ticket 131026201000** — edit-add
   container. BE `addCusShipmentContainer` defaults the added row's omitted
   columns (type/route/ports/factory/customerAppointmentAt) from the first
   non-null sibling (id order); FE drawer add recovers from the
   optimistic-version 409 (`onDetailStale` → force detail reload, retry hint).
   Tests: backend/src/tests/container-quickadd-inherit-lot.test.ts (2),
   CusContainerLedger 409-recovery (2). Rung 3 driven
   (qa/2026-10-14_fb086-fix_ui-* + repro_*).
2. `455544a8` feat(shipments-create) — LCL Quy cách đóng gói suggestions =
   shared `LCL_PACKAGE_TYPE_SUGGESTIONS` (Thùng gỗ, Pallet, Roll, Carton,
   Box, Crate, Khung, Bao, Can); free text unchanged. Rung 3 driven
   (qa/2026-10-14_r19-pkg_ui-*).
3. `ad1fb9a3` test follow-up — drop unsupported `exact` flag (tsc fix).
4. `ff4fd08e` fix(dispatch) — Phân xe lại can change nhà xe + biển after
   issue: route preserves the issued external vehicle only when carrier+plate
   unchanged (`resolveReassignExternalVehicleId`, unit-pinned 5 cases);
   dialog's EXTERNAL plate is a carrier-fleet picker
   (`listDispatchFleetResources`) sending `externalCarrierVehicleId`;
   carrier switch clears the stale plate; USearchableField shows an
   allowsCustomValue value at mount. Rung 3 driven on trip 195
   (qa/2026-10-14_r19-reassign_ui-*, DB proof carrier 48/vehicle 3/19H-77007).
5. `024863fb` docs(testplan) — FIX 1 verify verdict: **no code change**. The
   FE CBM gate was already optional pre-cut (2d0fc44a + BE f164a968 both
   ancestors of 1658ff96). Rung 3: empty-CBM LCL create → no red error, NULL
   persisted; 0+submit → error fires; cleared → gone. A customer still
   seeing it on staging serves a pre-2d0fc44a bundle (deploy out of scope).
6. `de10fb9d` test(qa) — gate evidence + dead lint directive cleanup.

## Gates (qa/2026-10-14_r19_*.log)

lint 0/0 · BE tsc 0 · FE tsc 0 · FE scoped 530/530 (46 files) · BE scoped
13 integration + 5 unit 0 fail · `make build` OK · `pnpm context:check` OK.

## Verification coverage (§9)

| Claim | Rung | Evidence | Not covered |
|---|---|---|---|
| FB-086 add inherits lot + overview updates | UI DRIVEN | qa/2026-10-14_fb086-fix_ui-{before,form,after,overview}.png + DB rows (cont 315 full columns) + driver log | mobile viewport, non-CUS roles, LCL add (guarded off) |
| FB-086 409 recovery | CODE+FE TEST (mocked 409) | CusContainerLedger.test.tsx; no live double-writer repro | live concurrent editor |
| Packaging suggestions | UI DRIVEN | qa/2026-10-14_r19-pkg_ui-{full,freetext}.png, options list logged | edit-side quick-edit surface (out of scope by card) |
| Đổi nhà xe + biển (dispatched) | UI DRIVEN | qa/2026-10-14_r19-reassign_ui-*, DB trip_carrier_info 48/3/19H-77007 | OWN branch (unchanged), accepted-trip lock path (test-pinned only) |
| LCL CBM optional | UI DRIVEN | qa/2026-10-14_r19-cbm_ui-*, DB lot 290 NULL | staging bundle freshness |

## QA environment (torn down after the wave)

Throwaway pg `r19-throwaway-db` on :5442 (migrated+seeded via
`pnpm seed`), backend :3012, frontend :7185 — all stopped/removed; the
user's live stack (ss-prod-db :5441 / main checkout) untouched the whole
time. QA fixtures left in the throwaway DB only (it is deleted).

## Independent review pass (landed on trunk, follow-up commit)

The post-wave review found **B1 (BLOCKER)**: the reassignment route's new
guard rejected the `null` externalCarrierVehicleId the FE dialog now always
sends — every OWN reassign and every free-text plate change 400'd. Fixed +
route-level-pinned in the trunk follow-up commit (see git log for
"reassign review pass"); M1 (fallback shared the resolver), m1 (null =
clear, undefined = inherit — pinned), m2 (orphaned vehicle), m3
(TripDetailPage plate clear) included. Evidence:
qa/2026-10-14_r19-b1fix_ui-* (free-text reassign driven live: plate
persisted, vehicle linkage cleared) + qa/2026-10-14_r19b_* gate logs
(lint 0 · BE/FE tsc 0 · BE 24/24 · FE 347/347 · build OK).

Newly recorded pre-existing limitation (own card needed): the OWN branch of
TripReassignDialog on /dispatch-detail cannot load truck/driver pickers for
DISPATCHER — /config/trucks + /config/drivers answer 403 for that role
(the dispatch editor uses the dispatch-scoped fleet API instead).

IMPORTANT for any QA driver from this checkout: a user stack came up on
:3002 mid-session; a vite started WITHOUT VITE_API_PROXY_TARGET proxies to
it (ss-prod-db data). Always pass VITE_API_PROXY_TARGET when spinning a
private stack. My drivers made zero writes to :3002 (verified: no PATCH
requests in the mis-proxied run's log).

## Remaining / follow-ups

- The merge (c7dcc286) and the review-pass commit are LOCAL only — nothing
  pushed, nothing deployed (no authorization).
- Pre-existing (NOT this wave): shared `computeFifoAging` tests fail at
  clean HEAD (date-dependent buckets) — needs its own card; dispatcher
  catalog gap above; /shipments-detail add/remove (747c7d7d) + drawer both
  now rely on the inherited-lot backend.

