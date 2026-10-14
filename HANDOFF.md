# Round-19 fix wave handoff (fix/round19-wave)

- Controller/session: opencode session on worktree
  `/Users/dev/.paseo/worktrees/1njkloyy/fix-round19-wave`, branch
  `fix/round19-wave`, cut from main `1658ff96`. Last updated 2026-10-14.
- Goal: 4 Zalo QLVT round-19 fixes landed as sequential independent commits;
  gates green; nothing pushed, nothing deployed, no migrations touched.

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

## Remaining / follow-ups

- Independent code-review pass: launched (code-reviewer subagent over
  1658ff96..HEAD) — resolve before merging anywhere.
- The 409-recovery and dispatch fix await a human staging pass; deploy NOT
  authorized in this wave.
- Pre-existing (NOT this wave): shared `computeFifoAging` tests fail at
  clean HEAD too (date-dependent bucket expectations); needs its own card.
- `/shipments-detail` still has no add affordance by design (card
  20260922_41); the drawer on Tổng quan lô hàng is the add surface.
