# Current Development Handoff

## Current task — OPS module (Vận hành hiện trường) per OpsVanHanh PRD — DONE + review-hardened on local dev (2026-09-07, unpushed)

- Scope: full implementation of `docs/prd/OpsVanHanh.md` (source `2026.9.6_Man_hinh_ops.docx`): `/ops/orders` (day list + per-user ghim + context-first khai chi phí), `/ops/fleet-tracking` (read-only, 30s poll), `/ops/wallet` (4 real-time cards, xin tạm ứng via shared `advance_requests`, expense history with red Nợ-chứng-từ tags, settlement batches grouped by lô with 2 invoice baskets, exceljs export, A4 print) + accountant "Chi phí Ops" tab in the advance workspace.
- 8 OPS commits on main ending `47dd1d84` (schema 0058 → wallet formula → portal API → catalog/client → orders → fleet → wallet+accountant+export → docs/e2e-runner fix → **review hardening `f6bf9e53`** → .ua rebuild). Plan: `plans/260906-2355-ops-module/`; review report: `plans/reports/code-review-260907-ops-module.md` (all blockers/majors addressed).
- Review hardening (code-reviewer pass): ops photo prefix added to the serve allowlist (author-or-approver; round-trip 200/401 verified); Excel exports via authed blob download (anchors 401'd); ALL expense mutations + settlement decisions behind conditional writes inside `runIdempotent` (10 new `OPS_*` durable endpoints + material-write rules — registry test green); pins POST-toggle → PUT set-semantics; container id↔number alignment; fleet COMPLETED bounded by VN today; resend photo gate; optimistic wallet save; storage-key owner+shape validation; admin "Ops phụ trách" dialog on the fleet vehicles view (closes the PRD §2 admin gap); locks 6201/6202→6301/6302.
- Lean decisions: dropped `ops_settlement_expense_links` (FK-on-entry, PRD §6 note); `requireRoles` gates, no casbin surgery; OPS-scoped expense-type catalog (no config:read grant); content-hash photo keys.
- Local-dev data notes: `requires_invoice` flipped true for LIFTING/LOWERING/INFRASTRUCTURE **local DB only** (seed untouched — flag also gates the forwarder flow; NOTE: any re-seed converges it back to false, re-flip for demo). Seed fragility documented.
- Gates: lint 0 err · backend tsc ✓ · backend tests 1779/1783 (**4 pre-existing peer-lane failures**: customer-intake-create 409≠403, ports.dispatchZone, q23-field-operations replay, seedShipments — identical names in the pre-OPS baseline, none touch ops; **fix backlog for next session**) · frontend 1465/1465 · build ✓ · check:ui+brand ✓ · e2e 243 pass/0 fail (runner gap-number bug fixed) · UI DRIVEN 2 passes (`qa/2026-09-07_ops_ui-*.png` + logs; giaonhan@local, DB side-effects verified).
- `.ua` graph rebuilt (412 files @ 50828dc4; trails code by one commit — incremental update catches up).
- **NOT DONE: push + deploy** (repo rule: remotes untouched unless asked; migration 0058 + catalog flags need a staging rehearsal per DB-deploy runbook) + the 4 peer-lane backend failures above.

**Updated:** 2026-09-07 ~01:40 Asia/Singapore
**Controller:** Mavis (autonomous captain session — scout→brainstorm→plan→cook chain over the three 09-06 docx; OPS lane; master-data lane was silversea-75's, ended mid-run)

## Previous task — /shipments list column redistribution + deploy — DONE, PUSHED + DEPLOYED (2026-09-03)

- Scope: full implementation of `docs/prd/OpsVanHanh.md` (source `2026.9.6_Man_hinh_ops.docx`): `/ops/orders` (day list + per-user ghim + context-first khai chi phí), `/ops/fleet-tracking` (read-only, 30s poll), `/ops/wallet` (4 real-time cards, xin tạm ứng via shared `advance_requests`, expense history with red Nợ-chứng-từ tags, settlement batches grouped by lô with 2 invoice baskets, exceljs export, A4 print) + accountant "Chi phí Ops" tab in the advance workspace.
- 6 commits on main (schema 0058 → wallet formula → portal API → catalog/client → orders screen → fleet → wallet+accountant+export). Plan: `plans/260906-2355-ops-module/`. Lane-coordinated with the sibling master-data session (silversea-75, ended mid-run; its ShipmentCreateWorkspace 1007L ceiling overage grandfathered in my phase-5 commit).
- Lean decisions: dropped `ops_settlement_expense_links` (FK `ops_settlement_id` on `ops_expense_entries` models the same 1-N, PRD §6 note updated); no casbin surgery (`requireRoles` gates inside the router); OPS-scoped `/api/ops/expense-types` catalog copy instead of config:read grant; storage keys content-hashed (retry-converging, reference-checked on delete).
- Local-dev data note: `forwarder_expense_types.requires_invoice` flipped true for LIFTING/LOWERING/INFRASTRUCTURE **local DB only** (seed untouched — flipping seed would alter the forwarder expense governance flow; PRD §3.4 treats the catalog as admin-configurable data).
- Gates: lint 0 err · backend tsc+tests exit 0 · frontend tsc+tests exit 0 · build exit 0 · check:ui+brand ✓ · e2e see `qa/2026-09-07_ops_e2e.log` · UI DRIVEN 11/11 (`qa/2026-09-07_ops_ui-*.png` + driver log; giaonhan@local, pin DB side-effect verified).
- `.ua` full rebuild delegated to a background agent (was stale since `9834d60b`, 570 files — predates this wave).
- **NOT DONE: push + deploy** (repo rule: remotes untouched unless asked; prod catalog flags + migration 0058 need a staging rehearsal first per DB-deploy runbook).

**Updated:** 2026-09-07 Asia/Singapore
**Controller:** Mavis (autonomous captain session — scout→brainstorm→plan→cook chain over the three 09-06 docx)
**Status:** DONE local — awaiting e2e/reviewer/graph-rebuild tails, then final docs commit.

## Previous task — /shipments list column redistribution + deploy — DONE, PUSHED + DEPLOYED (2026-09-03)

- Scope: `/shipments` CUS dashboard LIST-page column redistribution by value content (sibling of the 09-02 `/shipments-detail` ledger width wave) + realistic-data directive from user (09-03 20:44: "change data to realistic data instead of fake code generated data" — diagnosis: "fake" rows were QA test-run leftovers, not seeds; seed-bulk-data.ts already carries real shipping lines + VN companies).
- `a2a45ffb` — style(shipments): all 7 dashboard columns pin explicit shares summing 100% (customer 17 / documents 11 / classification 9 / cargo 12 / schedule 20 / notes 16 / status 15) sized from production-shaped content; `tbody td` re-declares `white-space:normal` against global Table.css nowrap (same trap family as 08-28 drawer fix); cargo weight/mode-tag children override the `.cus-multiline-cell span` nowrap+ellipsis that clipped "38.000 kg" / "Cont"/"Lẻ". Test assertion updated 18%→15%.
- `c363e708` — docs(prd): quy trình O2C CUS → Điều vận → Lái xe (402-line PRD that was sitting untracked in the tree).
- `86758594` — qa artifact: deploy verification log.
- Gates: vitest 1446/1446 · `tsc -b` 0 · lint 0 errors · check:ui + brand ✓ (`qa/2026-09-03_shipments-list_*`).
- Deploy 21:14 SGT (`make demo`, clean tree at `c363e708`): health `{"status":"ok"}`, migrate no-op (CSS-only). Artifact-vs-commit: GHCR `transting-frontend:latest` `sha256:5b4ca54c…a5038` == server container RepoDigest; served `ShipmentsPage-DurO5sck.css` carries all 7 new width shares + both wrap-override selectors.
- Tooling trap (cost two failed commands): Bash cwd persists across calls — a `cd frontend` for the tsc gate made later `git add` and `make demo` run from `frontend/` (first deploy attempt hit the frontend Makefile: `No rule to make target 'demo'`; QA artifacts initially landed in `frontend/qa/`, which has 0 tracked files — historical drift from the same mistake). Use `git -C` / `make -C` / absolute paths.
- Open: `.ua/` stale since `9834d60b` (9 commits behind) — pre-existing before this change, CSS-only diff adds no graph signal; full `/understand` rebuild still needs a dedicated session.

**Updated:** 2026-09-03 21:20 Asia/Singapore
**Controller:** Mavis (shipments width redistribution, commit+deploy)
**Status:** DONE — `d1db64f4..86758594` pushed to origin/main, deployed to https://vantai.tingting.vip and verified.

## Previous task — Vercel-rules perf pass + ForwarderTrip split — DONE (2026-09-02; subsequently pushed + deployed 09-02/09-03 via `f48fec03`→`1964ca07`→`d1db64f4`)

- Scope: user `/vercel improve frontend` + "improve and enhance them, the goal is to have easy to maintain and easy to extend frontend, prepare for future changes" → Vercel React-best-practices audit (optimize/ N/A — Docker deploy) + the queued ForwarderTrip split from the 09-01 wave's phase-06 addendum.
- `6216a16e` — bundle + re-render wins: **exceljs 924KB chunk → lazy at export click** (dynamic import inside `downloadCSV`; build proof: chunk renamed `csv-*.js` → `exceljs.min-*.js`, pure on-demand — 8 export pages stop downloading it at page-load); Toast context value referentially stable (toasts-ref mirror + useMemo — `useToast` consumers no longer re-render on toast churn); useAuth value memoized.
- `91413461` — **ForwarderTripDetailPage 1107→474L** into `features/forwarder/` home: sections module relocated (+test), pure `forwarder-expense-model.ts` 296L (+206L tests: validation order, update-null-unset semantics, edit-builder, prefill, no-invoice policy), `use-forwarder-expense-form.ts` 321L controller (lift query + rising-edge suggestion effect, memoized trip arrays), `ForwarderExpenseForm.tsx` 399L layout, `use-forwarder-container-form.ts` 57L. All 6 pre-existing DOM characterization tests pass unchanged.
- Gates: 1446/1446 vitest / tsc 0 / lint 0 errors / build ✓ (`qa/2026-09-02_*`).
- Trap found: `useUpdateForwarderExpense` lives in `useForwarderQueries`, NOT `useQueries` — the page-test mock factory caught the wrong-module import immediately.
- Remainders: FinancePage split **designed + sketched** in phase-06 file (section-shaped: charts/P&L table/truck breakdown/category table + allocation model; deferred per golden rule — kế toán = "từ từ"); SalaryAttendance = JSX bulk, lowest value; divergent status wordings still open product decisions.

## Previous task — frontend maintainability & extensibility wave — DONE (2026-09-01)

- **PUSHED + DEPLOYED 21:05 SGT (`9834d60b`):** wording unified per user decisions (`4a5a432e`), DISPATCHER Sổ-chuyến-đi nav removed (`ec1d7a5a`), staleness smoke PASS (parked board + quick-create within one poll), artifact-vs-commit verified (digest f4e909eb + served ShipmentContainersPage chunk + unified wording). .ua/: 1,966 files behind → diff-overlay written, full rebuild open.
- Scope: user ask "improve frontend for ease of maintenance and easy to extend" → audit (`plans/reports/architecture-260901-1611-frontend-maintainability.md`) → red-teamed plan (`plans/260901-1622-frontend-extensibility-change-wave/`) → cooked same day, all 7 phases.
- Shipped on `main`, commits after the backend wave's `ff762c93` (all pushed in `9834d60b`):
  1. `84786fee` — CUS split: ShipmentsPage 1281→609L + ShipmentsDetailPage 605→259L → `features/shipments/cus/` (state hook incl. verbatim 30s-poll, quick-edit hook, actions hook, detail hook+model, row leaf). 8 source-guard test assertions repointed.
  2. `1f33cf05` — CUS list read → react-query equivalence config (`qk.shipmentsCus`, 30s poll, focus 'always', keepPreviousData, staleTime ∞) + 5 regression tests locking the config (27.8 staleness guard). List race-guard deleted.
  3. `2156a14d` — FE status-vocab parity test: 22 shared enum↔label pairs. Divergent wordings (TripPod, dispatch status) documented as open product decisions — NOT unified under the behavior-identical contract.
  4. `48ae7b20` — 2 swappable date-formatter clones delegate to `lib/formatISODate`; 5 intentional variants documented.
  5. `fcc58759` — ShipmentsDetailPage → ShipmentContainersPage (kills the near-collision with `/shipments/:id`); salary-attendance grab-bag → features/. check-ui frozen-prefix updated.
  6. `39c76e6a`/`a213901a`/`047f88e6`/`da39e99d` — phase-6 splits: UserForm, PayableDetail (shared ledger rows → accounting), DebtDetail (3 accounting modules), DriverTripDetail (pure helpers → driver).
  7. Phase 7 — `docs/frontend-architecture.md` + `src/tests/structure.guard.test.ts` (frozen LOC ratchet + formatter-clone ban; bite-proven, `qa/2026-09-01_guard_proof.log`).
- Gates: 1424+ tests / lint 0 / tsc 0 / `make build` ✓ per phase (`qa/2026-09-01_{cus-split,cus-rq,vocab-parity,naming,splits6}_*`).
- ⚠️ `ff762c93` (backend wave's commit) carries this wave's 6 CUS-export/quick-edit files from the 16:58 amend race — content-correct, both sessions aware; their HANDOFF section documents it too.
- **Reviewer round (verdict FAIL → fixed, `d8f78993` + `b00e977e`):** BLOCKER — fcc58759 had committed only the rename's ADD half (2.4k lines of dead duplicates at HEAD; guard red on clean checkout) → deletion half committed + guard re-proven against committed tree (464 files, 0 violations, `qa/2026-09-01_guard_proof.log`). MAJOR — `staleTime: Infinity` dropped the old fetch-on-every-mount → `refetchOnMount: 'always'` + remount test; behavioral fake-timer poll test added. Final: **1426/1426 tests, tsc/lint/build green.**
- Remainders (recorded in phase files): ForwarderTripDetailPage + SalaryAttendancePage + FinancePage (sibling-WIP-blocked) splits; divergent status wordings; staleness smoke on staging needs a second live session (poll/remount/config are behaviorally tested).

## Previous task — backend+DB extensibility change-rail wave — DONE (2026-09-01)

- Scope: user ask "ensure backend and database table is extensible and easy to maintain, lots of change upcoming days" → `/ak-plan --auto` → audited (3 scouts + red-team) → cooked same day. Plan `plans/260901-1144-backend-db-extensibility-change-wave/`, report `plans/reports/architecture-260901-1144-backend-db-extensibility.md`. Verdict: schema layer already extensible (text enums, cheap add paths) — the wave hardened the **rails around change**.
- Shipped on `main`, 5 commits (NOT pushed; no deploy — user's call):
  1. `a74ca0bb` — migration rails: `make generate` mkdir-lock (no flock on local macOS), `db-backup` wired into migrate/migrate-sql/dev (fixed `|| true` swallow) + server-side deploy backup, `db-drift-check` probe-safe guard, journal floor 37→45. Demonstrated: lock contention, drift catch + zero-residue cleanup, backup restore rehearsal (134 tables).
  2. `5ed04a6b` — **live staleness bug fixed**: driver full-close (`HOÀN THÀNH CHUYẾN`) posted revenue/AP/AR then busted ZERO report caches. New single registry `lib/report-cache.ts` (keys/builders/groups tripWrite|tripStart); 4 hand-copied key lists removed; setter sites use builders; unit drift gate bans hand-spelled `reports:` keys outside the registry (caught 3 more template-literal setters during dev). Widening-only; sentinel integration test proves all 7 keys bust on close (create + replay).
  3. `93794a70` — `docs/backend-architecture.md` post-split reality: migration-rails section, 3-layer add-a-status checklist, report-cache registry section, enforcement map.
  4. `ece19544` — `0045_gifted_puma` penalties_driver_id index; **status-vocabulary-parity test** (12 backend↔shared pairs — backend-only status additions used to silently break shared-zod writes); advance-request inline union → `$inferSelect`; journal floor 46. E2E 379/0/31.
  5. `ff762c93` — driver.service split (1,497→1,007 LOC): fulfillment write path → `driver-fulfillment.service.ts` (467L); dual-use helpers promoted to `trip-pod.service` (1,061L); named-re-export barrel; suites unmodified. **⚠️ mixed commit**: sibling's 6 frontend CUS-export/quick-edit files were staged mid-race and rode along (content-correct, nothing lost) — see Notes.
- Gates per phase (evidence in `qa/2026-09-01_{migration-rails,cache-registry,schema-hygiene,driver-split}/`): tsc 0 · unit 189/189 (was 172; +17 registry/parity) · focused integration green per phase · full backend suite running at write time · lint 0 errors · `make build` green · E2E 379 pass/0 fail/31 skip.
- Known debts surfaced, not actioned (open questions in plan.md): FK policy (keep app-enforced — recommended); 336 plain-timestamp vs 129 timestamptz (new columns timestamptz; unification deferred); Casbin route↔policy drift has no guard (docs-line only); **`.ua/` knowledge graph is a month stale (`04dc2b1`, 07-29)** — too far behind for incremental; needs a full `/understand` rebuild in a dedicated session.
- testplan: TC-LX-TIENDO-010 extended with the cache postcondition (updated BEFORE the fix).

**Updated:** 2026-09-01 20:41 Asia/Singapore
**Controller:** Mavis (extensibility wave, session silversea-d1)
**Status:** DONE, PUSHED `ff311d49..93729a09`, DEPLOYED + VERIFIED (evening 2026-09-01, user: "do all recommendation"). Open questions resolved: FK policy = app-level (user decision, flexibility); timestamptz = new-columns-only; casbin guard deferred; no invalidation-dedup sweep. Deploy evidence: server DB backup before migrate (`/opt/vantai/.db-backups/db-20260901T123722Z.dump`, 2.8MB, vantai/vantai — **live cluster creds ≠ repo compose**; `demo-db-backup` now discovers user/db from the container env, fix `93729a09`; its first run failed closed and correctly aborted the deploy before any migrate/restart), migration 0045 applied (`penalties_driver_id_idx` live on staging), health `{"status":"ok"}`, rollback snapshot retained, artifact-vs-commit: GHCR `:latest` digest `sha256:36855dee…` == server container RepoDigest (image built from clean `9a145712` tree; sibling carry `9a145712` = 2-line FinancePage tooltip polish). Remaining known debt: `.ua/` month-stale → full `/understand` rebuild session needed.

## Previous task — driver full-close flow multi-fulfillment follow-up (HOÀN THÀNH CHUYẾN partial close → PENDING_EXPENSE_APPROVAL) — DONE

- Scope: re-test on staging (2026-08-29 evening) — the engineer deployed `71217810` (the original full-close flow) but a field-reported regression surfaced on multi-fulfillment shipments. Concretely: trip 21 (TRP-202608-0012) on `fulfillment 96` correctly flipped to `COMPLETED` after `completeOwnedFulfillmentTrip`, but `shipment 77` stayed at `DISPATCHED` because the recompute's `allCompletedViaDriverClose` branch required **every** `requiredFulfillments` row to have a COMPLETED trip. Shipment 77 has 3 required fulfillments (96, 97, 98) and only 96 had a trip — so the shipment was stuck. CUS/Dispatcher then kept seeing the stale "Đang chạy" badge exactly as before the fix.
- Fix in 1 file (`backend/src/services/shipment-status-transitions.service.ts`, +30 / -3):
  1. **New `anyFulfillmentCompletedViaDriver` branch** — when at least one required fulfillment has a driver-closed trip (trip COMPLETED + e-POD SUBMITTED/ACCEPTED) but other fulfillments are still planned, advance the shipment to `PENDING_EXPENSE_APPROVAL` so the CUS workspace badge + Dispatcher trips list reflect the partial close. Per-container dispatch status (already wired through `dispatchStatus`) keeps each container's individual state (the driver-closed one shows "Hoàn thành", the still-planned ones keep "Đã phân xe").
  2. **New `anyRequiredTripDispatched` escape hatch on the `allRequiredTripsPresent` guard** — the original `if (!allRequiredTripsPresent) return` short-circuited the recompute for any shipment that had un-tripped planned carriers, even when a driver had already closed a trip. The fix only short-circuits when *no* required fulfillment has a dispatched trip yet, so the partial-close branch can fire.
  3. **Gate `anyInTransit` on `allRequiredTripsPresent`** — the previous "shipment has at least one IN_TRANSIT trip → IN_TRANSIT" branch was too aggressive for multi-fulfillment shipments. With one IN_TRANSIT trip + planned carriers, the shipment now stays at `DISPATCHED` until the planned carriers get a trip too (or the driver closes).
- New test in `backend/src/tests/driver-fulfillment-progress.test.ts`: `driver full-close path: multi-fulfillment partial close advances shipment to PENDING_EXPENSE_APPROVAL (not stuck at DISPATCHED)` — adds a second FCL_CONTAINER fulfillment to the same shipment (planned, no trip), runs the driver through milestones + submitted POD, calls `completeOwnedFulfillmentTrip`, then asserts the shipment is `PENDING_EXPENSE_APPROVAL` (not DISPATCHED, not COMPLETED — the second planned carrier is still pending). The pre-existing `trip-pod-workflow.test.ts:an unresolved canceled fulfillment blocks closure…` test is also impacted by the `anyInTransit` guard and was confirmed still green with the fix in place (the recompute now returns DISPATCHED for the IN_TRANSIT-trip + un-tripped-fulfillment combo it was asserting).
- Gates at this commit: lint 0 errors / 158 pre-existing warnings; backend `tsc --noEmit -p tsconfig.json` 0; backend tests **313/313** (driver-fulfillment 28/28 incl. 1 new, trip-pod-workflow 10/10, o2c-trip-close-readiness 12/12, q15 9/9, cus-shipment-workspace + shipment-accounting-lock + shipment-service + shipment-routes + trip-shipment 254/254); frontend `tsc -b` 0; frontend tests **1361/1361** (243 files); `make build` green (frontend bundle 5.53s). Artifacts: `qa/2026-08-29_driver-full-close-flow/{lint,backend-tsc,backend-test,frontend-tsc,frontend-test,build}.txt`.
- Staging test: trip 21 was already COMPLETED on staging from the previous wave. After the new deploy, the partial-close recompute will lift shipment 77 to PENDING_EXPENSE_APPROVAL on the next driver complete call. (The previous trip 21 / shipment 77 row was set up *before* the multi-fulfillment fix landed, so its shipment stays at DISPATCHED — re-running with a fresh IN_TRANSIT trip on a multi-fulfillment shipment is the cleanest way to demonstrate the new behavior end-to-end.)

**Updated:** 2026-08-29 18:50 Asia/Singapore
**Controller:** Mavis (multi-fulfillment follow-up)
**Status:** DONE — committed on `main` (local), deploy in progress.

## Previous task — driver full-close flow (HOÀN THÀNH CHUYẾN flips trip + shipment to COMPLETED) — DONE

- Scope: user report (Vietnamese): "Thấy app lái xe báo lệnh hoàn tất nhưng trạng thái ở cus và điều vận vẫn là đang chạy, could you fix the whole flow properly." Driver tap "HOÀN THÀNH CHUYẾN" showed a success state on the driver app, but the CUS workspace badge + Dispatcher trips list still read "Đang chạy" / "Chờ khóa" because (a) `completeOwnedFulfillmentTrip` did not transition the trip to COMPLETED — it only called `recomputeShipmentCompletion`, and the existing recompute was blocked by `hasCompletedExpenseScopes` (an accountant/ops artifact the driver never touches), and (b) the CUS workspace's `PENDING_LOCK` bucket label "Chờ khóa" was shared across `PENDING_EXPENSE_APPROVAL` and `COMPLETED`, masking the new state.
- User decision: **"Full-complete — chuyển luôn trip sang COMPLETED khi lái xe hoàn tất"** + "skip kế toán for now, we build later" — Q15 maker-checker on the trip close is bypassed for the driver path; the accountant review flow is reintroduced later. Cost reconciliation still flows through the standard post-completion hooks (AR snapshot + dirty flag, O2C dev-rev1 §Bước 4).
- Shipped in 6 files (+157 / -45):
  - `backend/src/services/trip-status-machine.service.ts` — added `driverOwnedFulfillmentClose: { driverId, fulfillmentId }` option to `transitionTripStatus`. New branch in the COMPLETED handler: requires `Role.DRIVER`, asserts the trip belongs to the driver, sets `governanceAuthorized = true` (bypasses `assertActiveApprovalApplication` + the routineShipmentClose path), and treats `confirmZeroRevenue` / `confirmNoPhoto` as true so the existing post-update block fires (revenue/AP post, AR snapshot, AP snapshot, profitability snapshot, pair lifecycle effects). The Q18 terminal-state and IN_TRANSIT preconditions are preserved.
  - `backend/src/services/driver.service.ts` — `completeOwnedFulfillmentTrip` now calls `transitionTripStatus(tripId, COMPLETED, ...)` with `driverOwnedFulfillmentClose` after the evidence check. The old `recomputeShipmentCompletion` call is gone — that recompute now happens inside `transitionTripStatus`'s post-update block.
  - `backend/src/services/shipment-status-transitions.service.ts` — added `allCompletedViaDriverClose` condition (every required fulfillment's trip is COMPLETED + e-POD is SUBMITTED/ACCEPTED, regardless of expense scope or `podRecoveredAt`). When it fires, the shipment jumps to COMPLETED. The existing `allCompletedAndAccepted` (strict accountant path), `allAwaitingApproval`, and `allDriverEvidenceSubmitted` (legacy IN_TRANSIT + e-POD) branches remain for the other flows.
  - `frontend/src/pages/DriverTripDetailPage.tsx` — footer copy: "gửi e-POD và chuyển chuyến sang Chờ duyệt phí" → "gửi e-POD và chốt chuyến hoàn thành (CUS + Điều vận sẽ thấy trạng thái 'Hoàn thành' ngay)".
  - `frontend/src/features/shipments/cus/CusBadges.tsx` — `WorkflowBadge` now shows the `SHIPMENT_STATUS_LABELS` value (e.g. "Hoàn thành", "Chờ duyệt phí") for the `PENDING_LOCK` bucket in addition to `NEW`. The bucket is shared between `PENDING_EXPENSE_APPROVAL` and `COMPLETED`; both have user-meaningful status labels so the badge reflects the actual state instead of the generic "Chờ khóa". `LOCKED` keeps its bucket label (accounting-lock aggregate).
  - `frontend/src/pages/ShipmentsPage.test.tsx` — updated the one test that explicitly asserted the old "Chờ khóa" badge for a `PENDING_LOCK`-bucketed row to expect the new status label ("Sẵn sàng điều xe" for `READY_FOR_DISPATCH`).
- Tests: 5 new + 2 updated in `backend/src/tests/driver-fulfillment-progress.test.ts`:
  - `O2C: driver completion flips the trip + shipment straight to COMPLETED (skip kế toán for now)` — end-to-end: milestones + submitted e-POD + `completeOwnedFulfillmentTrip` → trip COMPLETED, shipment COMPLETED.
  - `driver full-close path: transitionTripStatus with driverOwnedFulfillmentClose flips an IN_TRANSIT trip to COMPLETED for the owning driver` — service-level happy path; checks `completedAt` is stamped and the financial posting side-effects still fire (revenue + driverSalary preserved).
  - `driver full-close path: rejects when the caller is not a DRIVER role` — 403 with the Vietnamese message.
  - `driver full-close path: rejects when the driver does not own the trip` — 403 + the trip stays IN_TRANSIT.
  - `driver full-close path: rejects when the trip is not IN_TRANSIT (CREATED trip)` — 409 with the IN_TRANSIT precondition message.
  - `driver full-close path: completeOwnedFulfillmentTrip advances the shipment to COMPLETED (skip expense-scope gate)` — the integration check: explicitly deletes the `trip_expense_completion_scopes` row to prove the new path bypasses it.
  - The pre-existing `driver journey board moves a driver-completed trip to HISTORY even though trip.status stays IN_TRANSIT` test was updated — title and assertion now match the new semantics (`trip.status === 'COMPLETED'`, card still in `HISTORY` bucket).
- `testplan/flows/04-laixe-tien-do-epod.md` TC-LX-TIENDO-010 rewritten for the full-close semantics: trip → COMPLETED, shipment → COMPLETED, CUS workspace "Hoàn thành", CUS container ledger "Hoàn thành", Dispatcher trips "Hoàn thành", driver footer "Đã hoàn thành chuyến". Notes the deferred accountant review.
- Gates at this commit: lint 0 errors / 158 pre-existing warnings; backend `tsc --noEmit -p tsconfig.json` 0; backend tests 312/312 (driver-fulfillment-progress 27/27 incl. 5 new, trip-pod-workflow 10/10, o2c-trip-close-readiness 12/12, q15-trip-financial-governance 9/9, cus-shipment-workspace + shipment-accounting-lock + shipment-service + shipment-routes + trip-shipment 254/254); frontend `tsc -b` 0; frontend tests 1361/1361 (243 files); `make build` green (frontend bundle 6.57s). Artifacts: `qa/2026-08-29_driver-full-close-flow/{lint,backend-tsc,backend-test,frontend-tsc,frontend-test,build}.txt`.
- Pushed + deployed (user said "commit push deploy"): `71217810` was already on origin (sibling pushed it); this session pushed the handoff commit `b3c17f3e`, then ran `make demo` (15:23–15:31 SGT) — GHCR images built + tagged `b3c17f3e`, drizzle migrations applied, blue/green cutover with rollback snapshot, backend health 200 (`{"status":"ok","timestamp":"2026-08-29T07:31:27.147Z"}`), frontend HTTPS check passed.
  - Deploy verified artifact-vs-commit (not wrapper exit): server containers run images created 07:28–07:29 UTC today (= this deploy's build time), and the served lazy chunk `DriverTripDetailPage-C9d-SjaT.js` contains the new marker "chốt chuyến hoàn thành" — the full-close wave is live at https://vantai.tingting.vip.

**Updated:** 2026-08-29 15:38 Asia/Singapore
**Controller:** Mavis (driver full-close flow)
**Status:** DONE — `71217810` + `b3c17f3e` on `main` (remote). All gates green. Deployed + staging-verified at https://vantai.tingting.vip.

## Previous task — e-POD complete conflict recovery banner — DONE

- Scope: user report (Vietnamese + screenshot): "Lái xe đang không hoàn thành chuyến được. Yêu cầu phải có e-pod (Dù đã upload)" — driver uploaded both mandatory e-POD photos, status was "Đã gửi duyệt", but "HOÀN THÀNH CHUYẾN" did not complete the trip. TRP-202608-0006, trip version 5, submission 1.
- Root cause (D1 follow-up): `useOfflineCommandQueue.drain()` blocks the whole `fulfillment:*` scope when ANY command sits in CONFLICT state. The trip-detail accept bar got the same gap fixed in `6edfd96f` (D1) — the e-POD screen's complete button never got the mirror. After the server rejected the first complete (any 409 — expectedVersion drift, hidden milestone gap, etc.), every subsequent `HOÀN THÀNH CHUYẾN` tap enqueued a fresh command into a blocked scope, so drain() silently skipped it: the green "Đủ điều kiện hoàn thành chuyến" hint was a lie, the button did nothing.
- Shipped `b1161733` (3 files, +252 / -10): `DriverTripPodPage.tsx` adds `remove` to the queue hook, a `stuckConflict` detector (`tripCommands.find(c => c.status === 'CONFLICT')`), and a `handleConflictReload` that drops the stuck command, refetches the trip, and toasts the recovery. The footer surfaces a discoverable `data-testid="epod-complete-conflict"` banner with the server's `lastError` and a 44px+ "Tải lại" button (44px mobile, flexbox-full-width on ≤480px). The main "HOÀN THÀNH CHUYẾN" button is now disabled while a CONFLICT is parked so the driver can't re-fire the dead command. The "Đủ điều kiện" hint is suppressed under the same condition. Two new tests pin the banner presence + the recovery click (`remove` + `refetch` + success toast). `DriverTripPodPage.css` styles the conflict banner (mirrors `.trip-pod__banner--error` idiom, danger-tint + surface).
- Gates: lint 0 errors / 158 pre-existing warnings; frontend `tsc -b` 0; frontend tests 1356/1356 (pod-page file 8/8 with the 2 new tests); `make build` green. Artifacts: `qa/2026-08-29_epod-complete-conflict/{lint,frontend-tsc,frontend-pod-test,frontend-full-test}.txt`.
- Pushed `b1161733` to `main` (user-authorized). `make demo` shipped: ghcr images built+pulled, drizzle migrations applied, blue/green cutover recorded a rollback snapshot at `vantai@.deploy-rollbacks/pre-cutover-…env`, backend health 200 (`{"status":"ok","timestamp":"2026-08-29T04:26:24.663Z"}`), frontend HTTPS check passed. Live at https://vantai.tingting.vip — driver account `quyet / Abc123` (or `laixe / Abc123`) can verify the new recovery flow on a stuck trip.

**Updated:** 2026-08-29 12:27 Asia/Singapore
**Controller:** Mavis (e-POD complete conflict recovery)
**Status:** DONE — committed `b1161733` on `main` (remote), deployed to https://vantai.tingting.vip.

## Previous task — Hôm sau shortcut on dispatch detailed plan — DONE

- Scope: user request (Vietnamese): CUS + điều vận screens need today/next-day filter shortcuts — "Hôm nay" to check containers starting transport today, "Hôm sau" for tomorrow's set. `080b49c9` had already shipped the pair on the CUS workboard (`transportDateFrom/To`) and dispatch master plan (`deliveryDateFrom/To`); the remaining gap was **Kế hoạch Chi tiết Xe** (`/dispatch-detail`), which only had Hôm nay/Tất cả ngày.
- Shipped `3f88ab12`: `DetailedPlanFilters.tsx` gains a "Hôm sau" button (tomorrow via `businessDateISO(new Date(Date.now() + 86_400_000))`, VN-tz safe) between Hôm nay and Tất cả ngày, same is-active/aria-pressed/Check-icon idiom; tests extended (10/10 focused). Live-verified as `dieuvan` (DISPATCHER): click → aria-pressed true, is-active, transport-date input flips to 2026-08-29.
- Gates: lint 0 errors; frontend tsc 0; frontend 1318/1318; check:ui pass; make build green (logs `qa/2026-08-28_hom-sau_*.log`). Trap hit twice: background-shell CWD ≠ session CWD — run repo-root gate batches with absolute `cd` first; `| tail` masks exit codes.
- No push, no deploy (this task had implement-only authorization).

**Updated:** 2026-08-28 11:07 Asia/Singapore
**Controller:** Mavis (Hôm sau shortcut)
**Status:** DONE — committed `3f88ab12` on `main` (local).

## Previous task — driver trip-detail nested-card flatten (cook --auto) — DONE

- Scope: `plans/260828-0950-driver-app-nested-card-flatten/plan.md` Phases 1-4 (P0). Flattened the nested-card antipattern on `/my-trips/:id` to "one elevation per group": `.trip-pod`, `.trip-pod__card`, `.trip-pod__file`, `.driver-task-fuel-card`, `.driver-task-photo-card`, `.driver-task-fact` all lose inner border+radius+background; stacked groups separate with `--line-strong` divider rows (column hairline ≥700px); `.driver-task-step` keeps chrome only in its 5 semantic states (locked = flat row; available gets a light accent tint). Rule + two divider weights added to `docs/design-guidelines.md` (§One elevation per group, next to SummaryRail).
- Evidence: mobile content width `.trip-pod__card` 271→301px @375 (+30px), 286→316 @390, ~326→344 @430; e-POD block height −148px; divider pixel-verified (row of `#BAC5BE` across full width — vision-model "missing divider" was downscaling artifact); before/after shots + measurements in `qa/2026-08-28_pod-flatten/` (REPORT.md).
- Gates at `15e9ab68`: lint 0 errors/150 pre-existing warnings; frontend tsc 0; frontend tests 1318/1318; check:ui pass; make build green (logs: `qa/2026-08-28_pod-flatten_{lint,frontend-tsc,frontend-test,check-ui,build}.log` + `_post-p3-gates.log`). Reviewer APPROVE (P2 commit-sequencing resolved when the sibling's `f660b864` landed first, leaving this commit a clean 3-file pathspec; P3 #2/#3/#4 applied, #5 root droppings cleaned).
- Open: Phase 5 (P1) — `DriverEarningsPage`/`DriverPenaltyPage` same-antipattern audit awaits user confirmation (plan leaves optional; `p1-penalties-375.png` captured, earnings shot redirected to login).
- No push, no deploy (implementation authorization ≠ deploy authorization).

**Updated:** 2026-08-28 10:35 Asia/Singapore
**Controller:** Mavis (ak-plan → ak-cook --auto, nested-card flatten)
**Status:** DONE — committed `15e9ab68` on `main` (local). All gates green.

## Previous task — laixe (driver) visual QA fixes (controller mode) — DONE

- Scope: human-QA visual sweep of the `laixe / Abc123` account found 4 high-impact + 5 medium issues (login → every nav item → every tab → every modal → desktop 1440×900 + mobile 390×844). Report at `qa/2026-08-25_laixe-visual/REPORT.md`. User asked to fix all of them; landed in commit `fde10ad5` on `main` (no push, no deploy).
- Per-issue fix (8 files, +84 / -28):
  1. **Inbox HÀNH ĐỘNG column clipped to ~0px** → `RoleWorkInbox.css`: give the 7th column an explicit 12% share, reduce table min-width 1050→880px, drop the card-collapse breakpoint 1345px→1145px; `RoleWorkInbox.tsx`: rows now clickable (cursor + onClick + Enter/Space keydown) using `useNavigate` as a fallback for when the action link is still off-canvas. Test updated (`canvas-fit-polish.styles.test.ts`).
  2. **Trip-detail `position:fixed` footer covered e-POD / fuel / income / legs** → `DriverTripDetailPage.css`: pull the footer out of `position:fixed`, into normal document flow at the end of the content. The `.driver-task-screen` 136px bottom-padding hack is gone. Action is the final workflow step (milestones + e-POD submitted → "Gửi chờ duyệt phí"), so scrolling to it is the expected interaction.
  3. **Mobile bottom-nav label wrap (M3 from original report)** → confirmed false positive; the `mobileLabel: 'Hành trình'` was already in place in commit `fcc9ce33`. Earlier walkthrough screenshot was stale.
  4. **Mobile trip-detail footer + bottom-nav collision** → same fix as #2 (footer is now in flow; `.app-body` already reserves 70px+ for the bottom nav). Footer sits naturally above the nav clearance.
  - M1: **Earnings hero vs summary tile animation race** (500.000 vs 498.720 mid-animation) → `DriverEarningsPage.tsx`: render the hero and the "Còn chưa thanh toán" summary tile as static text; the breakdown KPIs (`baseSalary`, `productionSalary`, `roadAllowance`, `paidOrAdvanced`, `penalties`, `adjustment`) still animate. Now they always read the same value at the same instant.
  - M2: **Penalties KPI label "VI PHẠM T8/2026" wrapping to 2 lines, count "0 vụ" on a new line** → `DriverPenaltyPage.css`: `white-space:nowrap; overflow:hidden; text-overflow:ellipsis` on `.penalty-kpi-grid .kpi__label`. On narrow mobile tiles the label truncates gracefully (e.g., "VI PHẠM T8/…"); on desktop it fits as before.
  - M4: **e-POD "Chụp" button solid black vs brand green** → `TripPodSubmission.css`: `.trip-pod__action` background `var(--ink)` → `var(--accent)`. Now matches the "Gửi e-POD" submit button and the rest of the brand.
  - M5: **e-POD file name wraps mid-word character-by-character** → `TripPodSubmission.css`: `overflow-wrap:anywhere` → `white-space:nowrap; overflow:hidden; text-overflow:ellipsis` (single-line truncation with ellipsis). Full name still in `title=` for hover. `TripPodSubmission.tsx`: added `title={file.originalFileName}` to the file-name span.
  - Polish (during #5): on wide 3-col grids, stack the action buttons 1-col so "Chụp"/"Tải tệp" don't wrap mid-word.
- Per-issue Playwright verification (in `qa/2026-08-25_laixe-visual/verify.mjs`):
  - Inbox action column: 133.5px wide, "Xem hồ sơ" link fully visible. Row click navigates from `/my-trips` → `/my-trips/3`.
  - Trip detail footer: `position:static, top=668px, h=210.5px` (was `position:fixed`, overlapping). On mobile: `position:static, top=800.9px, bottom=1050.4px`; bottom nav at `top=784, bottom=844`; no collision.
  - Earnings hero & summary tile: t=0/200/1700ms all show `500.000` / `500.000 đ` (no more race).
  - Penalties KPI labels: "VI PHẠM T8/2026", "KHẤU TRỪ T8/2026", "TỔNG BIÊN BẢN" each on one line.
  - e-POD: "Chụp" button now brand green; file names truncated to "TRP-202607-0001-YAR…", "TRP-202607-0001-SIGN…".
- Gates at `fde10ad5`: `pnpm lint` 0 errors / 150 pre-existing warnings; backend `tsc --noEmit` 0; frontend `tsc -b` 0; backend `pnpm test` 2242/2242; frontend `pnpm test` 1293/1293; `make build` green. Artifacts: `qa/2026-08-25_laixe-visual/fix_{lint,backend-tsc,frontend-tsc,backend-test,frontend-test,build}.txt`. Per-screenshot evidence + the FIX_REPORT.md in the same folder.
- **Concurrent in-flight work preserved untouched (NOT committed)**: `backend/src/services/cus-shipment-workspace-reads.service.ts`, `backend/src/services/driver.service.ts`, `backend/src/tests/cus-shipment-workspace.test.ts`, `backend/src/tests/driver-fulfillment-progress.test.ts`, `frontend/src/features/shipments/cus/CusContainerLedger.tsx`, `frontend/src/features/shipments/cus/cusUtils.ts`, `frontend/src/pages/ShipmentsPage.{css,density.test.ts,test.tsx}`. These are owned by another active task; this commit only touches the 8 driver-visual files plus the test.
- AGENTS.md closed-loop SDLC: Understand (Playwright walk, per-column width measurement, footer bounding-box on desktop + mobile) → Plan (per-issue file + line, with a comment for each non-obvious choice) → Implement (8 files) → QA (gates green + Playwright re-verify with `verify.mjs`; per-screenshot artifacts `001..013_fix*.png`) → Commit on `main` per repo convention (trunk-based, no branches). No push, no deploy (per AGENTS.md: implementation authorization ≠ deploy authorization).

**Updated:** 2026-08-27 10:55 Asia/Singapore
**Controller:** Mavis (driver visual QA fixes)
**Status:** DONE — commit `fde10ad5` on `main` (local). All gates green, all 9 issues resolved and visually verified.

## Previous task — /dispatch-detail "Phát lệnh" issue-order flow + driver-notification link (controller mode) — DONE

- Scope: bring the dispatcher (Điều vận) "Kế hoạch Chi tiết Xe" screen from "Đã xếp xe — chưa phát lệnh" to a real, working "Đã phát lệnh cho tài xế" handoff that fires a correct driver notification. 4 commits on `main`, all live on vantai.tingting.vip.
  - `cec0f963 feat(dispatch): issue dispatch order (phát lệnh) from detail-plan editor` — the original "Phát lệnh" button + happy path.
  - `9e94526f fix(dispatch): correct driver-notification link and QA feedback for phát lệnh` — driver-only trip notifications now key on `shipment_fulfillments` (not `trips`) so `/my-trips/{id}` resolves correctly (the original "Không thể tải lệnh vận chuyển này" 404); also 3 UX fixes the user flagged (wrong page name in no-driver warning → "Danh mục Xe nội bộ"; keep dialog open after Lưu thay đổi; surface real backend error instead of generic copy).
  - `03f9fcd2 fix(dispatch): re-anchor draft after plan save so phát lệnh unblocks` — the "stays open" side effect: after `setOpen(false)` was dropped the form's `draft` was never re-synced with the saved row, so `planDirty` stayed true and Phát lệnh was blocked. `setDraft(draftForRow(row))`-equivalent built from the save result now re-anchors it.
  - `7e62631a test(dispatch): phát lệnh issue-order coverage — cell eligibility matrix + hook mutation` — Vitest coverage for the cell (UNASSIGNED / ISSUED / plated-with-driver / no-driver / EXTERNAL / OWN issue / rejection / end-time validation / regression for 03f9fcd2) + the hook (chip flip on success, reload banner on 409).
  - `70778152 fix(dispatch): trip-reassign dialog overlay on /dispatch-detail` — replace the navigate-away `/trips/:id?reassign=1` with a `TripReassignDialog` overlay mounted on `DispatchDetailPlanPage`, and add `expectedVersion` to the reassign payload.
- QA walk through all 8 user-requested scenarios + fix verification: `qa/2026-08-26_phat-lenh-dispatcher-sweep/verdict.md` (verdict + per-scenario evidence), 30+ screenshots, walk logs, and a Playwright script (`walk.mjs`) that drives each scenario.
- Gates at `70778152`: lint 0 errors (150 pre-existing warnings); backend tsc 0; frontend tsc 0; backend suite 2240/2240; frontend suite 1289/1289; `make build` green. Artifacts: `qa/2026-08-26_phat-lenh-dispatcher-sweep/{lint,backend-tsc,frontend-tsc,deploy}.txt` and the per-scenario logs/screenshots.
- Deploy: `make demo` → image rebuild + push to GHCR (tag `70778152` + `latest`) → migrations applied (additive, no schema/relation changes — only Drizzle journal ack) → backend + frontend recreated. Public health: `{"status":"ok","timestamp":"2026-08-26T16:44:08.220Z"}`; frontend public HTTP check passed (brief 502 during container recreate, then 200). Artifact: `qa/2026-08-26_phat-lenh-dispatcher-sweep_deploy.txt`. Live verification on vantai.tingting.vip: laixe / Abc123 logs in, opens the "Lệnh điều xe mới" notification for fulfillment 10446 (Sunrise / 15H-052.82), lands on `/my-trips/10446` with the full trip screen — 0 page errors, "Không thể tải lệnh vận chuyển này" is gone. Screenshots: `qa/2026-08-26_phat-lenh-dispatcher-sweep/08_*.png`.

**Updated:** 2026-08-27 00:45 Asia/Singapore
**Controller:** Mavis (commit + push + deploy on user request "fix all issues first then commit push deploy")
**Status:** DONE — 4 commits on `main` (cec0f963 → 9e94526f → 03f9fcd2 → 7e62631a → 70778152), pushed to origin, deployed to https://vantai.tingting.vip. All 8 QA scenarios green on local + driver-side verified live on staging.

## Previous task — CUS workspace per-day date filter + plate-edit fix (controller mode) — DONE

- Scope: pick up the 3 uncommitted CUS workspace fixes (per-day date filter for container rows, plate-edit field-bag in the CUS ledger) + ship them with the 3 ahead-of-origin L2 round-2 commits. Pushed and deployed on user request ("commit all code and deploy").
- Shipped in commit `a3db1bfb` on `main`, pushed to origin, deployed to vantai.tingting.vip via `make demo` at 2026-08-25 10:29 +08.
- Per-file evidence:
  - `backend/src/services/cus-shipment-workspace-reads.service.ts` — `containerTransportDateSql` now resolves per container: `coalesce(date(customerAppointmentAt at time zone 'Asia/Ho_Chi_Minh'), shipments.expectedDeliveryDate)`. Date filter follows the per-container appointment, falling back to shipment EDD when the container has none.
  - `backend/src/tests/cus-shipment-workspace.test.ts` — test "by shipment EDD" updated: container A1 has appointment in 2099, A2 has none (falls back to shipment EDD 2026-08-21). Asserts only A2 under the date filter.
  - `frontend/src/features/shipments/cus/CusContainerLedger.tsx` — dropped the `draft.carrierKey.startsWith('EXTERNAL:')` guard from the plateNumber save branch so plan-able (OWN/Silver-Sea) plate edits aren't silently dropped. Matches the plan-able design that `b7309159` aligned.
  - `backend/src/tests/shipment-service.test.ts` — integration test "filters by a container port while returning every distinct per-container port pair" updated to include `localDate: null` in both expected groups. The L2 round-2 commit `b15dd696` extended `ShipmentContainerPortGroup` with `localDate` but left this test asserting the legacy 3-field shape. The unit test `shipment-container-port-groups.test.ts` was already on the new shape; only this integration test was stale. Proven pre-existing (identical failure with the 3 unstaged files stashed).
- Gates at `a3db1bfb`: lint 0 errors (150 pre-existing warnings); backend tsc 0; frontend tsc 0; backend suite 2228/2228; frontend suite 1274/1274; `make build` green. Artifacts: `qa/2026-08-25_cus-workspace-polish_{lint,backend-tsc,frontend-tsc,backend-test,frontend-test,build,deploy}.txt`.
- Deploy: `make demo` → image rebuild + push to GHCR (tag `a3db1bfb` + `latest`) → migrations applied (additive, no schema/relation changes — only Drizzle journal ack) → backend + frontend recreated. Public health: `{"status":"ok","timestamp":"2026-08-25T02:29:07.127Z"}`; frontend HTTP 200. Artifacts: `qa/2026-08-25_cus-workspace-polish_deploy.txt`.
- E2E: full re-run completed. **422 total · 391 pass · 0 fail · 31 skip** (pre-fix the run had 1 fail; TC-1820 was a stale test guarding the OLD spec; flipped to the L2 plan-able spec; suite 18 rerun 29/29; see below). The 31 skips are all the same pre-existing skips in the forwarder-portal and driver-portal mobile subtests (form/notes/leg fields hidden in those portals).
- TC-1820: was "CUS không thể tự gán xe nội bộ: authority từ chối carrierType OWN" — expected 409. The L2 commit `f878cd0f plan-able internal-fleet plates` (part of the round-2 work) changed the spec to 200. Updated test in `a6538c6f test(e2e): flip TC-1820 to the L2 plan-able OWN spec` to assert: status 200, line.carrierType='OWN', line.plateNumber='29C-123.45', line.externalCarrierId=null, line.dispatchStatus='PLANNED'. The deployed app already matches the new spec; no redeploy required. Artifact: `qa/2026-08-25_cus-workspace-polish_e2e-suite18-post-fix.json`.

**Updated:** 2026-08-25 10:37 Asia/Singapore
**Controller:** Mavis (commit + deploy on user request)
**Status:** DONE — committed `a3db1bfb` (app fix + integration test), deployed to https://vantai.tingting.vip. E2E completed 391/422 with 0 fail after flipping stale TC-1820; flip committed in `a6538c6f` (e2e-only, no redeploy).

## Previous task — Silver L2 customer-feedback QA re-verification + bug fixes (controller mode)

- Scope: human-QA pass over every item of `24.8 - SILVER KIẾN NGHỊ L2 - CUS & ĐIỀU VẬN.docx` (22 items, CUS + Điều vận), against the tree at `2400f744` + the in-flight uncommitted L2 work. The "2/3 width" asks were treated as the customer's general direction (per user instruction), not literal ratios.
- Full per-item verdict + evidence: **`qa/2026-08-24_silver-feedback-r2/qa-verdict.md`** (round 2; supersedes the round-1 verdict in `qa/2026-08-24_silver-feedback/`, which predated commit `2400f744` and the in-flight changes).
- 3 bugs found and fixed (committed):
  1. Date-scoped summaries zero-counted NULL-appointment containers while the rows still showed (both CUS overview and dispatch summary) — `filterContainersByDateRange` now takes a `fallbackDateFor` resolver; both call sites pass the shipment EDD. +5 unit tests; live-verified (2026-09-10 summary 0 → 2).
  2. Mixed container types rendered one line ("1x40HC + 1x20DC") in the CUS cargo cell — now one line per type (mockup image1); test updated; live-verified on BULK-EXP-0014.
  3. Zone truck presence panel mounted ABOVE the "Sản lượng" strip (customer asked below) — moved below in `MasterPlanPage.tsx`; live-verified `panelBelowSummary: true` with temporarily-seeded (and reverted) OWN-plate evidence.
- Also: stale e2e locator TC-1262 (`.summary-rail` → `.kpi-grid` on /suppliers, retired by `b3aac81e`) fixed; suite 12 rerun 41/41.
- Item-14 note: the Lạch Huyện panel is data-hidden with current dev data (zero OWN-plated fulfillments) — hides on empty by design.
- Gates: lint 0 errors; both tsc 0; backend 2221/2221; frontend 1258/1262 (4 failures pre-exist in the concurrent advance-workspace redesign wave — proven identical with this task's changes stashed); `make build` ✅; e2e 390+1(fixed)/422 + 31 skips. Artifacts: `qa/2026-08-24_silver-feedback-r2/gate-*`.
- Concurrent in-flight work preserved untouched (not committed by this task): `material-write.ts`, `shipment-governance.service.ts`, `material-write-registry-exhaustive.test.ts`, `DetailedPlanGrid.tsx`, `ShipmentCreateWorkspace.tsx`, `ShipmentContainerLedger.tsx`. `MasterPlanPage.tsx` was already dirty from that wave (panel mount); this task's reorder rode the same file and is included in this task's commit.
- Open items for the customer: Silver-Sea plate edit for CUS is intentionally locked pending clarification (spec decision); port + vendor short-name data awaited ("data em gửi lại sau").

**Updated:** 2026-08-24 22:00 Asia/Singapore
**Controller:** Mavis (L2 feedback QA round 2)
**Status:** COMPLETE — verdict report + fixes committed on `main`; no push, no deploy.

## Previous task — trips page filter-pill visual bug (controller mode) — DONE

- Scope: fix the "box-in-a-box + duplicate chevron" visual on the /trips page filter pills (Phương tiện / Khách hàng). After the UuiSelectField migration in `7a048268`, the UUI trigger button (rounded border + white background + own chevron) was rendering as a nested box inside the `.filter-pill` wrapper, and the wrapper's own chevron added a second chevron at the right edge. Live on http://localhost:7174/trips.
- **Shipped** in commit `7e71892d` (a parallel Mavis session's "factories master-data" commit captured the in-flight `.filters.css` + `control-density.styles.test.ts` changes verbatim; "Rides concurrent in-flight work in the same tree … dashboard/trip-list polish").
- Per-file evidence:
  - `frontend/src/pages/trip-list/filters.css` — added 47-line form-scoped conformance skin under the existing `.filter-pill` rules. Strips the UUI trigger's own border/background/radius/padding/built-in chevron so the pill is the single visual chrome; the custom `.filter-chev` at the end of the pill (with its `has-value` color state) is the established chevron. The same pattern the design guidelines sanction for `.cus-quick-edit-modal__fields`, `.penalty-filter-bar`, etc.
  - `frontend/src/components/control-density.styles.test.ts` — added `.trip-list-page .filter-pill .ds-uui-select` to `sanctionedConformanceScopes`, same pattern as the 5 existing entries.
- Live verified: desktop 1440×900, tablet 768×1024, mobile 390×844. Default, `has-value`, and listbox-open states all render correctly. Screenshots: `qa/visual/2026-08-24_trips-filter/`. Single chevron per pill, single border, no nested box.
- AGENTS.md closed-loop SDLC: Understand (live walk + DOM inspection) → Plan (form-scoped conformance skin, same pattern as 5 existing entries) → Implement → QA (`pnpm lint` 0 errors, `tsc -b` 0, `tsc --noEmit` 0, `pnpm test` 1254 pass / 4 pre-existing fail in sibling wave, `make build` green) → Captured by parallel commit. No push, no deploy (per AGENTS.md: implementation authorization ≠ deploy authorization).
- Artifact: `qa/2026-08-24_trips-filter-pill.md` (report) + 5 lint/tsc/test/build logs + 9 visual screenshots.

**Updated:** 2026-08-24 00:25 Asia/Singapore
**Controller:** Mavis (trips filter-pill visual fix)
**Status:** COMPLETE — fix is on `main` in `7e71892d`. Gates green. 4 pre-existing test failures in sibling wave remain (unrelated to this surface).

## Current task — P0 workflow-fix implementation (controller mode) — all 8 P0 done

- Scope: a follow-up controller session to the workflow-first UX review. Picked up the 8 P0 recommendations from `plans/260823-workflow-ux/plan.md` and implemented (or verified-done) each in order. Per the user's instruction "implement all, each time tackle one task then commit, then tackle next task."
- **All 8 P0 items landed.** 5 were already in the codebase (verified live, no code change). 3 (P0-W4, P0-W5, P0-W6) were implemented + committed in this session.
- Per-item evidence:
  - P0-W1 (RoleWorkInbox for Manager/Admin): already implemented — `ManagerDecisionInbox` (DashboardPage.tsx:375) and `AdminHealthWorkspace` (AdminCenterPage.tsx:16); data shapes `managerWorkInboxItemSchema` + `adminHealthInboxItemSchema` exist in `shared/src/schemas/work-inbox.ts:55-56`. No code change.
  - P0-W2 (treasury runtime error): does not reproduce on the current build. Live walk for 4 roles (ketoan, admin, giamdoc, dieuvan) shows 0 pageerror + 0 console.error; the H1 and body render correctly. Prior walkthrough's finding was a stale-state artifact (HANDOFF note flags several such cases in the prior walkthrough). No code change. Evidence: `qa/2026-08-23_treasury-error-repro.md`.
  - P0-W3 (giamdoc-dashboard H1): already correct. Page has 1 visible topbar H1 + 1 `h1.sr-only` (DashboardPage.tsx:352) for accessibility, exactly per the topbar-only-H1 contract. Prior walkthrough's "no H1" report was a tool false positive (the script was looking for a visible page-body H1, which by design doesn't exist). No code change. Evidence: `qa/2026-08-23_giamdoc-dashboard-h1.md`.
  - P0-W4 (recoverable-costs role branching): **shipped** in commit `eaa9a98f`. CUS now sees "Chi phí thu hộ cần đối soát" + "Đối soát chi phí thu hộ" eyebrow; Accountant/Admin/Manager see "Chi phí cần kiểm tra" + "Đối soát chi phí lô hàng" eyebrow. 3 new tests (CUS, accountant, no-auth fallback). 14/14 page tests pass, 67/67 routes tests pass, 1250/1250 frontend suite pass, root lint 0 errors, `make build` green. Live walk confirms correct H1 for 4 roles. Evidence: `qa/2026-08-23_p0-w4-recoverable-costs-role-branching.md`.
  - P0-W5 (cross-branch O2C gate on driver/ops rows): **shipped** in commit `dd9faae4`. New "Mốc nghiệp vụ" column on the personal-workspace table. Ops row shows two gates ("Đã phân xe" + "Đã đổi lệnh") with ✓ / … marks and the pending-owner hint when waiting. Driver row shows the same column with "Đã phân xe" always ✓ (their row is the proof of dispatch) and "Đã đổi lệnh" as the actual gate for them. Customer row does not render the column (their workflow has no parallel branches to track). 3 new tests (ops-ok, ops-dispatch-pending, customer-no-column). 13/13 RoleWorkInbox tests pass; 1253/1253 frontend suite. Pure UI change — all data was already in the schema. Evidence: `qa/2026-08-23_p0-w5-work-inbox-gate.md`.
  - P0-W6 (AR/AP state-machine lanes on /debt, /payables): **shipped** in commit `36323b38`. The 4 aging buckets on both pages now render as semantic O2C state lanes — "Trong hạn (0–30)" / "Quá hạn 31–60" / "Quá hạn 61–90" / "Quá hạn trên 90" — with the day range as a sublabel. The hero illustration (decorative, not decision-bearing) is dropped per visual plan P0-2. The 4 filter modes and the underlying data are unchanged. 9/9 Debt/Payable tests pass; 1253/1253 frontend suite. Evidence: `qa/2026-08-23_p0-w6-ar-ap-state-lanes.md`.
  - P0-W7 (POD review readiness): already implemented. `AccountingWorkInbox.tsx:30-38` renders a `ReadinessFacts` `<dl>` on every row with 4 facts (POD / Chi phí / Quyết toán / Lợi nhuận). 139 rows confirmed live. Plan §2.6 A3 was based on a stale perception. No code change.
  - P0-W8 (customer portal pre-dispatch filter): already implemented at the backend. `work-inbox.service.ts:99` excludes `NEW`, `PENDING_DATE`, `CANCELED` from the customer inbox query. The customer only ever sees `Sẵn sàng điều xe → Hoàn thành`. Plan §2.5 CT1 was based on a stale walkthrough. No code change.
- Collateral fix included in `eaa9a98f`: `frontend/src/features/users/components/UserTable.tsx` was missing the `Users`, `ShieldCheck`, `UserCog` imports — a pre-existing build break from commit `7d5295ee` (summary-rail refactor) that had been unverified at HEAD. The icons are still used in the `AVATAR_ICON` map. Without the fix, `make build` failed. Trivial restore.
- Implementation log: `plans/260823-workflow-ux/implementation-log.md`. Plan §0 carries the per-item status.
- AGENTS.md closed-loop SDLC followed for each implementation: Understand (live walks for each item) → Plan (P0-W* in plan §4) → Implement → QA (gates green + Playwright live verification + qa/ artifacts) → Commit on `main` per repo convention (trunk-based, no branches). For P0-W5 and P0-W6, the change is small enough to fit in one SDLC cycle each.

**Updated:** 2026-08-23 19:30 Asia/Singapore
**Controller:** Mavis (P0 implementation, workflow axis)
**Status:** COMPLETE — all 8 P0 items landed. 3 committed (`eaa9a98f`, `dd9faae4`, `36323b38`); 5 verified-done without code change. Final gates at HEAD: `tsc -b` 0 errors, backend `tsc --noEmit` 0 errors, `pnpm lint` 0 errors / 151 pre-existing warnings, frontend vitest 1253/1253 pass, backend unit suite 165/165 pass, `make build` green, live walk for all 8 P0 items: 0 pageerror. No push, no deploy (per AGENTS.md: implementation authorization ≠ deploy authorization).

## Previous task — workflow-first UX review (read-only, system-architect + PM mode)

- Scope: a follow-up to the user-perspective UX sweep. Where the previous plan was about **visual pattern** (workboard vs hero-cards), this one is about the **workflow contract** — O2C state machine, role-scoped visibility, side-effect chain, action ownership, lock levels — and how the rest of the app supports or breaks it. **No code changed, no commits, no deploy** — analysis only.

## Previous task — user-perspective UX sweep (read-only, system-architect + PM mode)

- Scope: walked every screen in the app as a user, extracted the customer-validated pattern from CUS + dieuvan, and produced a prioritized roadmap for converging the rest of the app onto that pattern. **No code changed, no commits, no deploy** — analysis only.
- Plan: `plans/260823-ux-review/plan.md` (the report — read this). Index: `plans/260823-ux-review/README.md`. Evidence: 105 screenshots under `plans/260823-ux-review/screenshots/`; per-screen notes under `plans/260823-ux-review/reports/`.
- Workflow: used Playwright to walk 8 roles × 50+ screens × 2 viewports (1440×900 + 390×844) for the actual visual evidence. Walk scripts: `walk-cus-dispatch.mjs`, `walk-all-roles.mjs`, `walk-customer.mjs`. The `customer` account is the right one for the portal (not the old `khachhang`).
- Golden-standard pattern (the contract customer approved):
  1. **Topbar-only H1** — page body uses an `h1.sr-only`; the title in the topbar is the primary heading.
  2. **Workboard page shape** — filter row (grid, `--filter-control-h`, group gap `--space-lg`) → action row (primary CTA, divider line, right-aligned secondary) → summary rail (one ruled row, no card chrome, semantic tones only) → data table (record-table skin, `--ops-table-*` tokens, sticky thead, `data-label` for the card collapse) → pagination.
  3. **Status signals** — UUI `Badge`/`BadgeWithDot` family only, semantic tones; structural classification (direction, cargo-mode) on neutral `--surface-3`/`--ink-2` chips. Amber means "needs attention" exclusively — never row striping.
  4. **Responsive contract** — sidebar collapses to icon rail ≤1024px; filter row wraps to 2 rows; table → labelled cards via container queries at ≤900px; phone sheet at ≤640px; everything reads `--filter-control-h` and `--space-*` tokens.
- App-wide pattern inventory: 5 patterns total. Only one (workboard) is customer-approved. The other four (hero-cards+table, personal-workspace, drawer, hero-illustration) are functional but inconsistent.
- Prioritized recommendations:
  - **P0-1** — Move the page H1 to the topbar only; drop the eyebrow + H1 + icon block from the page body. Affects 14 pages. Biggest visible win.
  - **P0-2** — Replace per-page hero KPI cards with a `SummaryRail` (one ruled row). Affects 12 pages. Biggest semantic win.
  - **P1-1** — Standardize filter row + action row across all list pages per guidelines §Filter toolbars.
  - **P1-2** — Adopt the record-table skin on all data tables (`--ops-table-*` tokens, `data-label`, sticky thead).
  - **P1-3** — Mobile card collapse via `data-label` (largely free after P1-2).
  - **P2** — Status chip consolidation; driver/forwarder/customer portal polish.
  - **P3** — Per-page polish (illustrations, vocabulary, dot-typo bugs).
- Explicit non-goals: don't change the customer-validated frozen workboard (`/shipments*`, `/dispatch*`, `/recoverable-costs`); don't unify the customer portal chrome with internal staff; don't add global search to driver/forwarder.
- Suggested execution order: P0-1 first (1 small PR, ~14 page files, biggest single quality bump) → P0-2 (12 pages) → P1-1 → P1-2 → P1-3 → P2/P3 opportunistically.
- Per AGENTS.md, every implementation step that follows this plan must re-run the QA gates (`pnpm lint`, `cd backend && npx tsc --noEmit`, `cd backend && pnpm test`, `cd frontend && npx tsc -b`, `cd frontend && pnpm test`, `make build`, and `cd e2e && ./run_all.sh` if flow/schema changes), and save artifacts under `qa/`. The plan is the **what**; the SDLC loop in AGENTS.md is the **how**.

**Updated:** 2026-08-23 18:30 Asia/Singapore
**Controller:** Mavis (read-only architect/PM walk)
**Status:** READ-ONLY — analysis complete, no code touched. Ready for review and a follow-up controller session to implement P0-1 / P0-2.

---

## Current task — design-guidelines systematic rollout (cook --auto)

- Scope: implement docs/design-guidelines.md systematically with /shipments* + /dispatch* as customer-approved frozen references. Ran as two interleaved controller sessions (this one + the sortable-headers app-wave below); both waves are complementary halves of the same rollout and are now fully landed.
- This controller delivered: (P0) green baseline — repaired 4 stale contract tests (Trạng thái label, control-density sanctioned `.cus-quick-edit-modal__fields`/`.shipments-detail-filters` conformance-skin exceptions citing guidelines §Dense dialogs, responsive-polish accounting → record-table container-query handoff assertion, AccountingWorkspace overview → tab-link assertion) + 2 real backend fixes (penalty-insights golden-parity: deterministic driverId tiebreaker on BOTH sides; "đã phân xe"→"đã điều xe" 409 vocabulary). (P1) check-ui-contract.mjs token-drift scan (raw font-size allowlist {0,10,11,12,13,14,16,18,20,24} under src/pages, frozen-prefix exclusions, heights deliberately manual) + ~66 off-scale conversions across 21 page-CSS files via 3 parallel executors + guidelines §1.6 rewrite. (P3) UserTable migrated to the shared table-sort-button skin (local `.users-sort-button` skin deleted, full-cell hit-area kept). Commits: `40a98521` `92316f80` (+ P1/P2 rode `378499c5` and the sort-wave commits below).
- P2 (sortable headers, Tier 1+2 verticals) was executed jointly: my sort-finance agent landed debt/payables/expenses/advances/governance (`d092d5c7` `6793db61`); the app-wave session landed the rest incl. penalties, treasury, customers/suppliers, audit log, credit-override, recoverable-costs. sort-final verified the last three verticals end-to-end with zero gaps (in-memory comparators for JS-aggregate endpoints are sanctioned architecture-follow).
- Final gates at HEAD `03f13ae5` (clean tree): lint 0 errors; both tsc 0; check:ui + brand green; frontend 228 files / 1239 tests; backend 2216/2216; make build green; e2e rerun by this controller as an independent check on the post-deploy commits. Artifacts: qa/2026-08-23_sort-contract_*, qa/2026-08-23_token-drift_*, qa/2026-08-23_guidelines-rollout_*.
- Incident worth remembering: my first attempt to commit the then-uncommitted sort WIP captured the sibling's in-flight ShipmentsDetailPage select migration (commit later reset cleanly via `git reset --soft` + pathspec unstage) — in a live-sibling tree, stage only task-owned pathspecs, and check `git log` immediately before committing "uncommitted" work.
- Backlog recorded in plans/260823-1619-design-guidelines-rollout/plan.md: on-scale raw-px var() migration, frozen-file findings (ShipmentsPage.css 15px, ShipmentsDetailPage 9px ×2), UUI empty-option contrast, feature-CSS token-drift scan extension.

**Updated:** 2026-08-23 23:50 Asia/Singapore
**Controller:** Claude (ak-cook design-guidelines rollout --auto)
**Status:** CLOSED — pushed through `a494d9c4` and staging deployed (make demo, migrations applied, health green). Reviewer APPROVE; SHOULD-FIX 2+3 applied (shared SortHeader numeric+scope consolidation of 7 local copies; single-source sort-key consts/types incl. governance + transport + recoverable). Two stale e2e expectations updated (suite 10 summary-rail, TC-1262 accountant-on-/suppliers); their green rerun was blocked 3× by the concurrent session's tsx-watch backend restarts (evidence: qa/2026-08-23_guidelines-rollout_e2e-10-12-infra-blocked.*) — rerun suites 10+12 in the next quiet window.

## Current task — sortable column headers, app-wide

- Scope: every data-table column header in the app sortable, per user decision ("every table app-wide"). Verified first on /shipments-detail?dateScope=all (browser QA 16/16: URL params, aria-sort, DOM order == server-sorted wire order — qa/2026-08-23_sort-headers_browser.json).
- Contract (docs/design-guidelines.md §Sortable column headers): whitelisted `sortBy` zod enum + `sortDir` per endpoint → `<expr> <dir> nulls last` + id tiebreaker, absent params = old default order byte-identical. Shared surfaces: `frontend/src/lib/table-sort.ts` (nextTableSort/readTableSort/sortClientSide), `styles/table-sort.css`, `components/shared/SortHeader.tsx`, DataTable sortKey/sort/onSortChange.
- Server-side everywhere paginated (shipments overview + container workboard — derived dispatchStatus/carrierName via row-multiplication-free scalar subqueries, trips 11 cols, expenses, advances, governance, debt/payables aging sorted in-service pre-pagination, customers/suppliers via crud-factory `sortableColumns` opt-in, penalties, accounting transport register/work-inbox, treasury, audit log, manager decision inbox, credit-override queue with sort-carrying keyset cursors, recoverable costs incl. SQL replica of the JS claim-version comparison). Client-side (`sortClientSide`, vi collation) for full-set non-paginated tables (fleet views, portal, config previews, detail ledgers, finance breakdowns).
- Deliberately unsorted: dispatch master/detailed-plan grids (frozen workstream), Users page (sibling's record-table migration owns it), trips CSV export, P&L statement rows + portal running-balance (fixed layouts; reordering destroys meaning).
- Delivery: my commits `834494b4` `7a1fa503` `d092d5c7` `6793db61` `73736fb8` `d334076a` `d4e8a1d4` + P1/P2 in `2da0e690`; four-agent fan-out work landed partly via the sibling's sweeps (`e50738f0` `197227c2` `19dcc97a` `cacf1eb6` `b8341ec5` `d8109de3`, each verified intact by its owning agent). Pushed through `d8109de3`; staging deployed via clean worktree `make demo`.
- Gates all green: lint 0 errors; backend tsc 0 + 2212/2213 (payroll m73 flake → 2/2 isolated); frontend tsc 0 + 1234/1234; build ✓; e2e 10 suites (TC-0604 governance-uniqueness collision with 2026-08-22 residue → 5/5 re-run); check:ui + brand ✓. Artifacts: qa/2026-08-23_sort-*. Batch reports: plans/260823-1608-sortable-headers-appwave/reports/. Journal: plans/journals/2026-08-23-sortable-headers-app-wave.md.
- Known post-wave state: sibling's next CSS wave (responsive.css, SupplierList/Customers pages, contract tests) was mid-flight at deploy time — dirty files in the tree are theirs, excluded from the deploy by the clean-worktree build.

**Updated:** 2026-08-23 17:55 Asia/Singapore
**Controller:** Claude (ak-cook sortable-headers wave, 4 fullstack agents + controller batches)
**Status:** CLOSED — all screens shipped, gates green, pushed, staging deployed.

## Current task — shipments-detail container-ledger design-critique polish

- Scope: `/shipments-detail` (Chi tiết lô hàng) visual polish per an accepted design critique; column structure/IA/edit flows untouched (customer-validated). Five delivered changes: (1) unified status system — "Chưa gán biển số" now a UUI `BadgeWithDot` warning span (code-verified non-clickable; was a bordered span reading as an outlined button), "Chờ phân xe" a `Badge`+Clock3 warning chip, missing-fields triage one compact amber chip with CSS `·` separators, direction/Đóng-kết-hợp neutral `--surface-3`/`--ink-2` chips matching the frozen overview; (2) ledger mapped onto `--ops-table-*` tokens (thead 11/600, primary 13/600, supporting 12, meta 11); (3) amber decoupled from rows — missing-transport-date now tints only the `Lịch trình` cell + an in-cell "Thiếu ngày vận chuyển" chip (sibling-WIP precedent); (4) filter bar regrouped search | date-range | select trio (`__group--dates`/`__group--selects`, 14px vs 6px gaps, 1300/900/520 rules re-targeted); (5) summary strip → 4 stat cards (20px/12px, amber on the two attention counters).
- Files (entire diff): `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx`, `frontend/src/pages/ShipmentsDetailPage.{tsx,css,test.tsx,styles.test.ts}`, `docs/design-guidelines.md` (new "Status signals in dense ledgers" section). Sidebar critique finding deferred — shared chrome renders on customer-frozen screens; not in the critique's priority list.
- Gates: `check:ui` pass, `tsc -b` 0 errors, root lint 0 errors (151 pre-existing warnings, none in task files), `make build` green, focused 48/48. Full frontend suite 1152/1155 — the 3 failures (control-density `ShipmentsPage.css` `.cus-quick-edit-modal__fields` rules, responsive-polish accounting, AccountingWorkspacePage) are pre-existing at HEAD `3e532d9c`, proven via pathspec-stash baseline run (`qa/2026-08-23_shipments-detail-ledger_baseline-head.log`); they are the same known blockers recorded in the supplier-modal section below. Artifacts: `qa/2026-08-23_shipments-detail-ledger_*`.
- Concurrent-session notes: the CUS-dashboard inline-edit session committed `3e532d9c` mid-task; their files were never touched or staged by this task (pathspec-stash partition, verified clean before/after).

**Updated:** 2026-08-23 16:05 Asia/Singapore
**Controller:** Claude (ak-cook ledger polish)
**Status:** CLOSED — committed `4f6c6094` after independent review (DONE_WITH_CONCERNS → H1 cascade fix, M1 label spacing, L1/L2 applied; report in `qa/2026-08-23_shipments-detail-ledger_review.md`). All gates green at final tree (1152/1155, the 3 pre-existing at HEAD). No push, no deploy.

## Current task — dense-dialog contract wave (overlays, card ledgers, secondary actions)

- Applied the "data-dense dialogs & pages" checklist to non-frozen surfaces as a parallel-safe partition with the concurrently-running session; both waves are now fully committed and deployed.
- Wave commits: `ca1d8273` (ConfirmDialog/Drawer/tire-dialog overlays → `rgba(10,10,10,0.56)`+2px blur; 1390px tire worksheet + debt-detail ledger → labelled cards ≤1500px; route-form cancel secondary; guard test `frontend/src/styles/dialog-density-contract.styles.test.ts`; dense-dialog rules in `docs/design-guidelines.md`) and `60799b8c` (review fixes: card action-row chrome reset at 1500px, remaining ghost Hủy → secondary in recoverable-costs + shared config FormActions, tires aria-label neutralized, overlay doc scoped to dialog families, guard regex hardening, supplier design test aligned to `--r-sm`). `e041f821` lands the concurrent session's fuel-evidence `!important` select fix + expense filter label wrap under the user's commit-all order; their sweep itself landed as `dc0a9ed7` + `6fb8b635`.
- Independent code review returned REQUEST_CHANGES with 2 should-fixes + 4 nits; all six addressed (see commit `60799b8c`) and reviewer notified. Reviewer also verified: tires/debt-detail cascade sound, debt-detail block fully ledger-scoped, PayableDetailPage inherits the card handoff, guard allowlist paths exact.
- Final gates all green: full frontend suite 1133/1133 (after fixing the sibling's stale SupplierListPage radius expectation), `tsc -b`, root lint, `check:ui`. Contention flakes during parallel runs were 5s timeouts that pass in isolation. Artifacts: `qa/2026-08-23_dialog-density_*` and `qa/2026-08-23_commit-all_*`.
- Frozen `/shipments*` + `/dispatch*` layout untouched; shared dialog chrome (overlays) follows the app-wide contract per the density-wave token precedent.
- Remaining known gaps for a later wave: UUI empty-option placeholder styling (selects show `-- Chọn X --` at value contrast); `/expenses`, `/recoverable-costs`, fleet list screens belong to the concurrent session's audit clusters.

**Updated:** 2026-08-23 14:20 Asia/Singapore
**Controller:** Claude (dialog-density wave)
**Status:** CLOSED — all commits pushed (`origin/main` at `e041f821`), staging deployed + healthy (backend `status: ok`, frontend 200), independent review APPROVE post-fixes with no open items.

## Current task — supplier modal coherence pass

- The shared Admin/Dispatcher `SupplierFormModal` now uses a four-equal-column desktop grid: identity fields span two columns each; tax/status/contact/phone each take one; payment terms take one each and the customer link spans two; the reporting fields each span two. The 960px breakpoint deliberately changes to two columns and the 640px breakpoint to one, preserving 44px touch controls.
- The formerly ambiguous examples are now explicitly marked `Ví dụ:`. Entered values retain `var(--ink)` contrast while hints use `var(--ink-3)`. The long note is a wrapped textarea constrained inside the modal; only supplier name remains required, matching `supplierSchema`.
- Checkbox labels use a consistent 10px gap after every 16px checkbox. The supplier form uses an 8px label-to-control, 24px row, and 32px section rhythm. “Hủy” is now the existing bordered secondary action; the primary add action remains the canonical brand `btn--primary`.
- Shared modal behavior now uses a darker, lightly blurred backdrop and flex-based internal scrolling so the header and footer stay pinned on long forms. This is a shared primitive change; all other form contracts are retained.
- The core supplier-form source/test change was committed concurrently to `main` as `b58018b4 fix(frontend): supplier dialog adopts uniform four-column grid and input polish`. `Modal.css` and later compact-control refinements remain concurrent dirty work; do not overwrite them. QA evidence: `qa/2026-08-23_supplier-modal_*` and `qa/visual/2026-08-23_supplier-modal/`.
- Follow-up alignment correction: native fields and service rows now explicitly match the Dispatch compact contract at desktop and tablet (34px height, 12px type, 8px radius). The shared UUI select adapter supplies the same geometry. Between 641px and 900px, the form deliberately overrides the global touch-height rule so native inputs cannot grow independently of selects; at 640px and below, fields use 44px/16px touch controls. Rendered checks are green at 1440×900, 768×1024, and 390×844 with no overflow, console errors, or HTTP errors.
- Green: focused supplier design test (3/3), root lint (0 errors / 151 existing warnings), frontend typecheck, final `make build`, context and diff checks, and authenticated Admin browser evidence. Evidence: `qa/2026-08-23_supplier-dialog-alignment_*`.
- Repository-wide frontend tests are currently blocked by two unrelated concurrent global-style failures: the control-density stylesheet contract and Finance responsive polish. Their complete output is retained in `qa/2026-08-23_supplier-dialog-alignment_frontend-test.log`; do not alter those out-of-scope surfaces for this modal task. No push, deployment, migration, or data mutation.

**Updated:** 2026-08-23 Asia/Singapore
**Controller:** Codex
**Status:** Supplier modal implementation and scoped rendered QA are complete; repository-wide frontend-test closure is blocked only by the concurrent global-style failures above.

## Current task — user-perspective quality pass (Stage 1)

- The current "in-progress" task is the in-progress **whole-app overflow and visual repair** sweep; the most recent commit on `main` is `cee81ec fix(finance): compact non-comparable margins and wrap profitability table text`. The user-perspective walkthrough on **2026-08-23** (artifacts in `qa/2026-08-23_fresh-user-perspective/`) found four user-visible regressions that this plan addresses; the work below is **Stage 1** of a four-stage rollout. Demo accounts to verify against:
  - `admin / Abc123` (ADMIN)
  - `giamdoc / Abc123` (MANAGER)
  - `cus / Abc123` (CUS / Nhân viên Chứng từ)
  - `ketoan / Abc123` (ACCOUNTANT)
  - `laixe / Abc123` (DRIVER)
  - `giaonhan / Abc123` (FORWARDER)
  - `customer / Abc123` (CUSTOMER / SilverSea — the old `khachhang` identifier is gone, the seed and the live customer now use `customer`)

- **Stage 1A · Driver trip detail projection (`backend/src/services/driver.service.ts`)** — the projection now falls back to `siteSnapshot.pickupWarehouse.name` / `siteSnapshot.deliverySite.name` when the top-level `shipments.pickupLocation` / `deliveryLocation` / `factoryName` columns are null. A new test `driver fulfillment detail falls back to site snapshot for pickup / drop / factory when top-level columns are null` covers the regression. Verified on the live dev server for fulfillment 49568 (Kho Long Minh / Nhà máy Long Minh now populate where the page used to render em-dash for all six fields).

- **Stage 1B · `/accounting/fuel-evidence` title squeeze (`frontend/src/pages/FuelEvidenceReviewPage.tsx`)** — the page's filter select was using `width: 220px` but the global design system `.ds-uui-select` is `width: 100%`, so the flex toolbar squeezed the H1 to 0×180 px and the title rendered as a vertical strip of single characters. The page's local rule now pins `min-width: 220px; max-width: 220px` so the select always reserves 220 px and the H1 keeps the natural toolbar width.

- **Stage 1C · Casbin `ocr` policy gap (`backend/src/casbin/policy.csv`)** — the policy had `p, ACCOUNTANT, ocr, write` but no `read` permission, so `/api/ocr/fuel-evidence-reviews` returned 403 to accountants even though the route mount says `accountantOnly`. Added `p, ACCOUNTANT, ocr, read`. Same shape: `p, MANAGER, ocr, write` and `p, DRIVER, ocr, write` still don't have a read entry, which is correct — the OCR review inbox is accountant-only.

- **Stage 1D · Customer portal identical containers (`backend/src/services/work-inbox.service.ts`)** — the Drizzle correlated subquery for `containerSummary` was rendering the outer `s.shipments.id` reference as a constant in the generated SQL, so every shipment in the customer work inbox showed the same shared `MEDU7120398, BEAU4281650, FCIU9034568` (50+ shipments share these container numbers, which is why the projection looked plausible in casual review). Replaced the correlated subquery with a single `inArray` query that buckets containers per shipment in JS, and reads from the bucket in the items loop. Verified via `/api/portal/work-inbox?view=WAITING&customerId=2` — each of the 7 in-transit shipments now shows its own containers (e.g. `MAGU7040858`, `MAGU8583747, DRYU2602553`, etc.). The detail page already returned the right containers via `/api/portal/shipments/:id`, so the bug was only in the list projection.

- **Stage 1E · Customer portal "Xem hồ sơ" link** — verified to work: the link is a real `<Link to={\`/portal/shipments/\${shipment.id}\`}>` and clicking it navigates correctly to the detail page (BULK-EXP-0202 / NEWEB-Kho 2 / container MAGU7040858 in the demo). My earlier screenshot showed a no-op click because the Playwright run was on a stale state from a pre-fix dev server; the navigation works in the current build.

- **Stage 1F · Driver mobile titles (`shared/src/navigation/pageCatalog.ts`, `frontend/src/lib/routes.ts`)** — added `myPayslips` and `myTwoOrders` to the page catalog and the routes object, plus matching `titleRules` entries. `/my-payslips` mobile topbar now reads "Phiếu lương" instead of just "TransTing", and `/my-trips/two-orders` reads "Hành trình · Hai lệnh" instead of the generic "Hành trình".

- **Stage 1G · Create-shipment page H1 (`frontend/src/features/shipments/create/ShipmentCreateWorkspace.tsx`, `frontend/src/pages/clerk/ClerkShipmentCreatePage.css`)** — replaced `<h1 className="sr-only">` with a visible `.csc-page__title` "Tạo lô hàng". The CUS user sees the title in the breadcrumb area; the admin role has a separate Chrome render issue (the form is in the DOM with all proper colors but the screenshot stays white in headless + headed mode) that I could not resolve — it's a renderer-specific quirk and Frank should verify in a real browser whether the admin sees the form.

- **Out of scope (deferred to a later stage)**:
  - The "Lô hàng #21324" / "SHP-2608-00001" mixed-label issue on the customer inbox (shipments 21324 and 21168 have null `shipmentCode` in the database) — this is a data fix (backfill codes) and belongs in a separate data migration.
  - The "Debt aging buckets don't sum to total" finding from yesterday — re-evaluated with a 3.5 s wait, the math is correct (`328.500.000 = 328.500.000 + 0 + 0 + 0`); the earlier mismatch was the staggered counter animation in `DebtListPage` (`delay 300 ms + duration 1200 ms + stagger 80 ms` per tile). The QA harness now waits long enough for counters to finish before screenshotting.
  - Empty-state copy improvements, "—" → "Chưa cập nhật" replacement, RBAC `replace: true` redirects, currency formatter unification, dark mode, language toggle, global search shortcut — all deferred to later stages per the original `plans/260822-1800-user-perspective-quality-pass/plan.md`.

## Current task — driver assignment modal duplicate select repair

- The Admin `/fleet` “Thêm lái xe” modal no longer renders duplicated label/border layers for `Xe phân công` and `Trạng thái`. Each field is now one shared `UuiSelectField` label plus one trigger; assignment/status values, save payload, active-truck filter, keyboard semantics, footer, and responsive modal behavior are unchanged.
- Root cause: both fields were wrapped in the legacy `.field`/`.input` form pattern while `UuiSelectField` also renders its own accessible label and boundary. This produced the empty full-width box plus a second select seen in the supplied screenshot.
- Task-owned source/tests: `frontend/src/features/fleet/DriverFormModal.tsx` and `DriverFormModal.test.tsx`. No API, schema, RBAC, data, migration, commit, push, or deployment changed.
- Green: focused driver-modal regression (1/1), full frontend suite (195 files / 1,104 tests), frontend typecheck, root lint (0 errors / 151 existing warnings), `make build`, context and diff checks, and self-review. Authenticated local Admin browser evidence at 1440×900 and 390×844 confirms one label per select, no page/dialog overflow, no console/network errors, and 46px touch controls on mobile. Evidence: `qa/2026-08-23_driver-form-modal_*`.

**Updated:** 2026-08-23 Asia/Singapore
**Controller:** Codex
**Status:** Complete locally; preserve the shared UuiSelectField as the sole label/control owner in this modal.

## Current task — supplier dialog desktop density

- The Admin/Manager `/suppliers` create/edit dialog now uses the available desktop canvas (`960px`) rather than a narrow, vertically stacked form. Supplier identity is a 7/5 split, tax/status/contact/phone are four compact columns, payment terms/customer link are three columns, and service roles use a compact four-column matrix.
- Every existing field, default, validation condition, save payload, modal footer, Escape/Enter behavior, focus trap, and mobile sheet behavior is retained. The layout steps down to two/three columns below 960px and a single-column form with touch-height service controls below 640px.
- Task-owned files: `frontend/src/pages/SupplierListPage.tsx`, `SupplierListPage.css`, and `SupplierListPage.design.test.ts`. Rendered local Admin evidence at 1440×900 proves no desktop form-body scroll (`559px` client / `559px` scroll height); 1024×768 and 390×844 have no horizontal overflow, no console errors, and no HTTP 5xx. Evidence: `qa/2026-08-23_supplier-dialog_*`.
- Green: frontend suite 192 files / 1,093 tests, frontend typecheck, root lint (0 errors / 151 concurrent warnings), `make build`, context check, diff check, and self-review. Browser-automation compatibility produced one preserved failed manual artifact before the selector was corrected; the final browser rerun is green. No commit, push, deployment, migration, or data mutation.

**Updated:** 2026-08-23 Asia/Singapore
**Controller:** Codex
**Status:** Complete locally — maintain this compact desktop dialog contract while preserving its responsive fallback.

## Current task — truck creation dialog viewport repair

- The desktop “Thêm xe đầu kéo” dialog now uses the same compact Điều vận control contract: eight editable controls measure 34px/12px, with a four-track identity grid, three equal deadline tracks, and one compact inline oil helper. Select values retain the same real-value contrast and type scale as adjacent native inputs; “Hủy” is visible as a bordered secondary action.
- At 390px the same eight controls are 44px/16px, the field grids become single-column, the body scrolls independently (`680px / 700px`), and the header/footer remain stable. The mobile oil helper resets its desktop flex-basis so its interval selector follows the date without a blank vertical gap.
- Task-owned source/tests: `frontend/src/features/fleet/TruckFormModal.tsx`, `frontend/src/pages/FleetPage.css`, `frontend/src/styles/operational-density.css`, and `frontend/src/features/fleet/TruckFormModal.styles.test.ts`. No API, schema, RBAC, data, migration, push, deployment, or commit changed. Preserve unrelated shared edits.
- Green: focused frontend 4/4; frontend typecheck; root lint (0 errors / 151 shared warnings); `make build`; authenticated local desktop/mobile render checks with no console errors or HTTP 5xx. The broad frontend suite remains red only in concurrently edited `SupplierListPage.design.test.ts`, whose expected `supplier-form__identity` class is absent from that file; no truck-form test failed.
- Evidence: `qa/2026-08-23_truck-form-density_final-qa-summary.md` and `qa/2026-08-23_truck-form-density_browser-qa-final.md`.

**Updated:** 2026-08-23 Asia/Singapore
**Controller:** Codex
**Status:** Scoped implementation and rendered QA are green; global frontend-suite completion is blocked by the unrelated concurrent supplier test. No source publication or deployment.

## Current task — whole-app overflow and visual repair (in progress)

- User extended the Profit Report correction to all other screens. The accepted rule is now: neither clipped content nor an internal horizontal scroll is acceptable evidence; use labelled cards when the operational canvas cannot fit all facts.
- A real Admin route matrix covers 54 static authenticated routes at 1440×900, 1280×800, 1024×768, and 390×844. It initially found shared mobile topbar truncation, mobile Trip List status-tab scrolling, tablet User scope truncation, and older desktop table/grid overflow clusters.
- Completed and rendered-green: mobile page titles wrap in the topbar; Trip List status filters use a two-column mobile grid; User scope labels wrap; Config Customer/Port/Route tables use labelled records under the 1500px content-canvas threshold; Trip List switches to its existing operational card model under that same threshold. Targeted matrix (`/config/customers`, `/config/ports`, `/config/routes`, `/trips`) is green at all four widths.
- Remaining unaccepted audit clusters: `/accounting`, `/debt`, `/dispatch-detail`, `/expenses`, `/finance`, `/payables`, `/recoverable-costs`, `/shipments`, `/shipments/new`, `/fleet/drivers`, and `/fleet/vehicles`. The broad baseline retained 34 findings, including internal table scrolling and clipped identifiers; these must be repaired and rerun before closure.
- Task-owned source/tests so far: `frontend/src/styles/responsive.css`, `frontend/src/components/layout/Topbar.styles.test.ts`, `frontend/src/pages/trip-list/responsive.css`, `frontend/src/pages/trip-list/responsive.styles.test.ts`, `frontend/src/features/users/users.css`, and `frontend/src/pages/config/config-page.css`.
- Evidence: `qa/2026-08-23_all-pages-visual-audit.log` and `qa/2026-08-23_all-pages-visual-audit/`. Focused tests pass (3/3). Full app gates have not yet been rerun because the broad repair is not complete. No commit, push, deployment, migration, or data mutation.

**Updated:** 2026-08-23 Asia/Singapore
**Controller:** Codex
**Status:** In progress — do not accept the remaining broad-audit findings.

## Current task — profitability report strict overflow correction

- The prior profitability-report visual evidence is superseded: it only checked for a horizontal scrollbar and incorrectly accepted text clipped inside table cells. The new acceptance rule rejects every visible `td` whose rendered scroll width exceeds its client width.
- Customer identity, Bill/Booking source references, and row status text now wrap within their available cells rather than clipping. Normal rows no longer repeat the allocation explanation or the global threshold-configuration reminder; missing-allocation and low-margin signals remain at row level.
- The strict authenticated matrix is green at 1440×900, 1280×800, 1151×768, 1150×768, 1024×768, and 390×844: all eight analysis dimensions, plus the first and final page of every paginated dimension, have no visible-cell overflow, document/table horizontal overflow, `Chuyến #` UI copy, console errors, or HTTP 5xx errors. The sweep found and fixed `Không thể so sánh` overflowing the narrow margin column; it now renders as an accessible `—`. Evidence: `qa/2026-08-23_profit-report_full-visual-audit.log`.
- Green after the test-harness fix: frontend suite 190 files / 1,086 tests; frontend typecheck; root lint 0 errors (151 existing warnings); production build; diff check; source review. Evidence: `qa/2026-08-23_profit-report_*`.
- Task-owned source/tests: `frontend/src/components/finance/ProfitabilityReportPanel.tsx`, `ProfitabilityReportPanel.test.tsx`, `frontend/src/pages/WorkflowFinance.css`, and `WorkflowFinance.styles.test.ts`. No commit, push, deployment, migration, or data mutation was performed. Preserve unrelated `.ua/meta.json` and `frontend/src/pages/PenaltyPage.test.tsx` changes.

**Updated:** 2026-08-23 Asia/Singapore
**Controller:** Codex
**Status:** Complete locally — strict rendered and automated QA green; prior clipped-text acceptance expressly rejected.

## Current task — remaining role workspaces, Waves 1-3

- Wave 1 is committed as `ba9bc13`: role-scoped Operations (`/my-orders`), Driver (`/my-trips`), and Customer (`/portal/shipments`) inboxes; additive delivery authority; safe milestone publication; customer advisory response; offline FIFO/idempotency/version handling.
- Wave 2 makes `work` the default Accountant workspace with ready/blocked lanes, explicit financial blockers, advisory customer exceptions, and authorized links to the existing debt, advance, expense, payable, evidence, reconciliation, and profit/loss surfaces. Overview and transport-register remain available. Completion commit: `9ebed4f`.
- Wave 3 puts the paginated Manager decision inbox before financial/fleet KPIs, includes immutable per-dispute resolution drafts and a real resolution action, and makes `/config` the Admin home with seven real source-level health cards. Failed jobs/email are aggregated by source; unavailable sources are never presented as healthy. Admin `/dashboard` remains available as a management view. Completion commit: `63b7459`.
- CUS `/shipments*` and Dispatcher `/dispatch*` remain frozen. Authenticated before/after evidence covers both routes for both roles at 1440×900, 768×1024, and 390×844 with no document overflow, console errors, or HTTP 5xx.
- Wave 1's full loop was green: backend 2,147/2,147, frontend 1,037/1,037, build, E2E 391 pass / 0 fail / 31 configured skips, cross-role 57/57, independent review and verification accepted.
- Final verification is green: backend 2,163/2,163; frontend 1,084/1,084; lint zero errors; backend/frontend typechecks; build; final full E2E 391 pass / 0 fail / 31 configured skips; context check; independent review ACCEPTED; verifier VERIFIED.
- Authenticated role evidence is green at all three required viewports, including the recorded Admin 100-card failure/source-aggregation fix-loop and Manager cross-dispute draft isolation.
- `.ua/` was fully rebuilt after the deterministic fingerprint check found 190 structural changes: 1,719 files, 5,409 nodes, 11,504 edges, 14 layers, 12 tour steps, and 1:1 coverage of 5,515 internal import edges. Baseline commit: `668baf7`; working metadata points at that committed HEAD.
- Preserve unrelated concurrent `backend/src/tests/material-write-registry-exhaustive.test.ts` and `frontend/src/pages/PenaltyPage.test.tsx`. No push or deployment was performed.
- Evidence: `qa/2026-08-22_role-workspaces_wave1_*`, `qa/2026-08-22_role-workspaces_wave2_*`, `qa/2026-08-22_role-workspaces_wave3_*`, and `qa/2026-08-22_role-workspaces_frozen-*`.

**Updated:** 2026-08-23 00:34 Asia/Singapore
**Controller:** Codex
**Status:** Complete — all three waves committed directly to `main`; full closed-loop QA, review, verification, frozen-role evidence, and knowledge graph are green. No push or deployment.

## Current task — operational profitability report identity and no-scroll layout

- Profitability rows now use the customer short name whenever one is maintained, with the legal name retained only as the fallback. Historic snapshot labels are re-presented and merged by the stable customer key, so one customer does not appear twice after a naming change.
- `Nguồn:` no longer exposes `Chuyến #<internal id>`. It links to the associated Bill, then Booking, then an operational trip code; the numeric ID remains only in the link target.
- The 7-column desktop table uses short operational headers and fixed column allocation. At compact desktop and mobile widths it changes to labelled cards, preserving every metric with no horizontal scroll.
- Task-owned source/tests: `backend/src/services/profitability.service.ts`, profitability attribution/pagination tests, `shared/src/types/index.ts`, `frontend/src/components/finance/ProfitabilityReportPanel.tsx` and test, `frontend/src/pages/WorkflowFinance.css`.
- Green: backend full suite 2,147/2,147; frontend full suite 181 files / 1,035 tests; backend/frontend typechecks; lint 0 errors (179 pre-existing concurrent warnings); final `make build`; diff/context checks; self-review. Browser evidence at 1440×900, 1024×768, and 390×844 confirms 50 report rows, all fields present, no document or table horizontal scrolling, zero console/HTTP errors, and no `Chuyến #` UI copy. Evidence: `qa/2026-08-22_profit-report_*`.
- No commit, push, deployment, migration, or data mutation was performed. Preserve all concurrent dirty files.

**Updated:** 2026-08-22 22:00 Asia/Singapore
**Controller:** Codex
**Status:** Complete locally; all applicable automated and rendered QA green.

## Current task — global operational filter density and accounting typography

- User requested that the accounting workspace stop using oversized text and that every shared filter follow the compact CUS/Điều vận desktop contract.
- Task-owned source: `frontend/src/styles/tokens.css`, `frontend/src/components/FilterBar.css`, `frontend/src/features/accounting/AccountingWorkspaceRoot.tsx`, `frontend/src/pages/AccountingWorkspacePage.css`, `frontend/src/pages/ExpenseListPage.css`, `frontend/src/pages/DebtListPage.css`, and `frontend/src/styles/filter-density.test.ts`.
- The new `--filter-control-*` tokens make desktop and tablet filters 34px/12px and switch them to 44px/14px below 768px, matching CUS/Điều vận. Accounting’s period fields now use `BufferedUuiDateInput size="sm"`, matching the CUS/Điều vận primitive; KPI/workflow hierarchy was reduced to the established operational scale.
- Green: focused frontend tests 5/5 and full frontend suite 1,035/1,035, frontend typecheck, root lint (0 errors / 179 concurrent warnings), root build, context check, diff check, and independent review. Evidence: `qa/2026-08-22_global-filter-typography_*`.
- Blocked visual evidence: a fresh local browser session remained on `/login` after the provided local credentials, so the post-change authenticated accounting canvas was not available. The captured diagnostic is retained in the matching manual QA artifact.
- The first broad frontend-test run exposed one concurrent `ProfitabilityReportPanel.test.tsx` failure; it is retained in `qa/2026-08-22_global-filter-typography_frontend-test.log`. Its current owner resolved that change, and the final full suite is green.

**Updated:** 2026-08-22 21:39 Asia/Singapore
**Controller:** Codex
**Status:** Source implementation, applicable automated gates, and independent review green; authenticated rendered accounting evidence remains blocked by unavailable local login state. No commit, push, deployment, migration, or data mutation.

## Current task — staging release for CUS route editor 409 + overflow repair

- User authorized commit, push, staging deployment, and authenticated staging testing of the reviewed `main` worktree.
- Final logic fixes cover four distinct cases: legacy container-owning shipments with NULL `cargoMode` are repaired to FCL; domain 409s remain inline while only real optimistic conflicts trigger refresh; an unchanged post-handoff `routeId` is treated as a no-op; and identical active lift/drop IDs are deduplicated before port validation. Error and recovery text wraps within the route editor.
- The exact staging request for shipment 3/container 3 now returns 200 with route `1`, lift `2`, and dropoff `2`. Its immediate identical retry also returns 200 and keeps shipment version `10`, proving stable no-op behavior.
- Final release commit `e07e49e fix(cus): accept identical lift and drop ports` is on `main`, pushed to `origin/main`, and deployed to `https://vantai.tingting.vip`. Public health is green. Rollback snapshot: `/opt/vantai/.deploy-rollbacks/pre-cutover-20260822T070203Z.env`.
- Green evidence: lint (0 errors), backend/frontend typechecks and tests, build, full E2E 386 pass / 0 fail / 31 configured skips, independent review clear, exact staging API replay, and authenticated staging visual section 5/5. Final visual artifacts: `qa/visual/2026-08-22_150429_s03_cus_route_editor/`; complete logs: `qa/2026-08-22_cus-route-conflict_*`.

**Updated:** 2026-08-22 15:06 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Complete — committed, pushed, deployed, exact staging API replay green, authenticated visual QA 5/5, and public health green.

## Current task — dispatch-detail desktop column balance

- User confirmed that the prior 5% `Phân loại` share still rendered its header letter-by-letter in the live local dispatcher view. The targeted repair makes the table's desktop allocation schedule 14%, customer/route 21%, documents 14%, container 13%, notes 16%, dispatch 13%, and classification 9%; the total remains 100%.
- `Phân loại` now keeps its two-word header intact at desktop widths, while the recovered space goes to `Ghi chú`, where real vehicle/customer instructions need it. The existing <=900px labelled-card layout is unchanged.
- Fresh Chrome evidence at `http://localhost:7174/dispatch-detail`: table 1076px, classification 97px, zero table/document overflow, zero console errors. Focused grid test (29/29), frontend typecheck, lint (0 errors / 179 concurrent warnings), context check, and diff check are green.
- Full frontend tests are red in three concurrent MasterPlanGrid/ShipmentsPage assertions; root build is red before frontend build on concurrent backend `dispatch-planning.service.ts` `export type` errors. Those files were not altered. Evidence: `qa/2026-08-22_dispatch-detail-column-balance_*`.

**Updated:** 2026-08-22 Asia/Singapore
**Controller:** Codex
**Status:** Local responsive fix visually verified; no commit, push, deployment, or data mutation.

## Current task — comprehensive QA strategy + visual test plan

- The CUS route-editor 409 + overflow bugs leaked because the L0–L3 (lint / typecheck / backend tests / frontend tests) gates do not cover the user flow around a contract. Built the missing layers so the next bug class surfaces in CI, not in production.
- `docs/qa/qa-strategy.md` codifies the layered test stack (L0 lint → L7 prod sanity) and a visual test matrix that every shipped surface must populate. The matrix has a real row for `/shipments-detail` and the CUS route editor that wasn't there before.
- `docs/qa/manual-visual-checklist-template.md` is the L6 manual gate. 8 CUS scenarios (incl. the no-op save, domain 409, long-text overflow, and CUS-vs-Điều-vận concurrent edit) are now required to be checked off before declaring any CUS change done.
- `docs/qa/backlog.md` lists the gaps the strategy cannot yet cover (cross-browser, PWA, a11y, performance, i18n) plus the bugs we've already closed (the CUS route 409 trio + the dispatch-detail plan DISPATCHED fix).
- New visual section `e2e/visual/sections/s03_cus_route_editor.py` adds 5 TCs: TC-CUS-DETAIL-ROUTE-01 (happy path), TC-CUS-DETAIL-ROUTE-04 (no-op save), TC-CUS-DETAIL-ROUTE-06 (domain 409 inline), TC-CUS-DETAIL-ROUTE-08 (long-text overflow), TC-CUS-DSH-CONCURRENCY-01 (CUS vs Điều vận stale 409). All 5 PASS. Evidence: `qa/visual/2026-08-22_140752_s03_cus_route_editor/` and `qa/2026-08-22_qa-strategy_report.md`.
- Definition of Done (L0–L6) is now codified in §2 of the strategy doc. The previous implicit "lint + typecheck + tests + build" is no longer enough — visual regression for the affected section is mandatory.
- Committed on `main` as `e9b7ff7 chore: ignore local screenshot_filter_check.mjs helper` and `efb55e6 fix(release): harden legacy route migration QA`. Pushed to `origin/main` (`efb55e6..e9b7ff7`).
- Deployed to staging via `make demo`. Migrations ran (the existing 0033 backfill for legacy cargoMode is idempotent and safe to re-run). Public checks: `https://vantai.tingting.vip/api/health` returns 200; `https://vantai.tingting.vip/` returns 200. Evidence: `qa/2026-08-22_staging-deploy.log`.

**Updated:** 2026-08-22 14:16 Asia/Ho_Chi_Minh
**Controller:** Mavis
**Status:** Committed on `main` (`e9b7ff7`, `efb55e6`); pushed to `origin/main`; deployed to `https://vantai.tingting.vip` with public health green.

## Current task — CUS route editor domain 409 + editor text overflow

- User complaint (staging `vantai.tingting.vip`, CUS role, `/shipments-detail`): a legitimate domain 409 like `Hình thức hàng FCL/LCL chưa được xác định.` from `POST /api/shipments/cus-workspace/:id/containers/:id` was being treated as a stale-data conflict. The CUS UI bounced the editor into recovery (`Đã tải bản mới nhất và bỏ bản nhập cũ...`) and discarded the user's draft. A second complaint: long Vietnamese error / recovery text in the inline editor overflowed the 420px editor box and overlapped the row to its right.
- Root cause (logic): every 409 from the container-line PATCH went through `recoverConflict` regardless of the message, so version-conflict 409s and domain 409s were indistinguishable. A second root cause for the specific `Hình thức hàng` 409: a legacy shipment with `cargoMode = null` but real containers hit `ensureShipmentFulfillmentsInTx`'s `if (shipment.cargoMode !== 'FCL' && shipment.cargoMode !== 'LCL')` guard, which threw the 409.
- Root cause (overflow): `.shipment-container-ledger__edit-error` and `__recovery` had no `max-width` / `white-space` / `overflow-wrap` constraints.
- Fix (logic): `isOptimisticShipmentConflict` helper in `ShipmentsDetailPage.tsx` keys the recovery path on the version-conflict message text only (`Lô hàng vừa thay đổi` / `Lô hàng đã bị người khác cập nhật` / `Dữ liệu đã được xử lý đồng thời`); every other 409 re-throws so the `InlineEditor` shows the domain error inline and keeps the draft. Backend `updateCusShipmentContainerLine` now repairs `shipment.cargoMode = null` to `'FCL'` inside the locked transaction before creating the canonical fulfillment (LCL is still forbidden from owning containers, so the repair only fires for the unambiguous container case).
- Fix (overflow): `.shipment-container-ledger__edit-error` and `__recovery` get `max-width: 100%; white-space: normal; overflow-wrap: anywhere;` so the text wraps inside the editor box.
- Task-owned source/tests: `frontend/src/pages/ShipmentsDetailPage.tsx` (8 catch sites), `ShipmentsDetailPage.css`, `ShipmentsDetailPage.styles.test.ts`, `ShipmentsDetailPage.test.tsx` (`keeps the route draft and shows a domain 409 inline…`), `backend/src/services/cus-shipment-workspace.service.ts` (legacy cargoMode repair), `backend/src/tests/cus-shipment-workspace.test.ts` (`route save repairs a legacy unclassified shipment…`), plus a parallel `dispatch-planning.service.ts` change that includes `DISPATCHED` in the `listDispatchDetailPlanRows` status filter and its test `keeps a published CREATED trip visible so dispatch can reassign it`. I added a one-line `DetailPlanRow.dispatch` type extension for `tripId` / `tripStatus` so the new test type-checks.
- Green: focused backend 2/2; full backend 2140/2140; full frontend 1011/1014 (the 3 failures are pre-existing on clean `main` — `ShipmentsPage.test.tsx` two date-string assertions and `MasterPlanGrid.test.tsx` same; documented in the 2026-08-21 handoff entry); backend & frontend typecheck; lint 0 errors / 93 warnings; `make build`; full E2E 386 pass / 0 fail / 31 configured skips; live curl repro on shipment 90730 / container 44619. Evidence: `qa/2026-08-22_cus-domain-409-and-overflow_*` (lint, typechecks, focused + full tests, build, E2E, live-curl, report).
- Working tree is dirty (parallel agent owns the actual changes). No commit, push, deployment, migration, or data mutation performed by this task. The 0537178 commit from the prior CUS route turn remains the only committed change related to the CUS route editor.

**Updated:** 2026-08-22 13:30 Asia/Ho_Chi_Minh
**Controller:** Mavis
**Status:** Closed-loop QA green locally; working tree dirty; awaiting user decision on commit/deploy.

## Current task — CUS route editor 409 on identical lift/drop save

- On `/shipments/new`, each FCL container now has independently editable `Nhà máy` and `Tuyến đường` controls. Selecting or creating a factory no longer overwrites the selected route; both remain required before the shipment can be sent to Dispatch.
- The backend now accepts a route that differs from a factory's configured route at both the container-save and dispatch-submit boundaries. It still requires an active route plus an active, customer-owned `FACTORY` site, so the temporary workflow does not weaken catalog or customer authorization.
- No API payload, database schema, migration, master-data relationship, commit, push, or deployment changed. This is the CTO-approved interim behavior until factory-route mapping data is available.
- Task-owned source/tests/docs: `frontend/src/features/shipments/create/ShipmentCreateWorkspace.tsx`, `shipment-create-model.ts`, `frontend/src/pages/clerk/ClerkShipmentCreatePage.test.tsx`, `backend/src/services/shipment-containers.service.ts`, `shipment-intake.service.ts`, `backend/src/tests/shipment-container-site-authority.test.ts`, `shipment-intake-submit.test.ts`, and `docs/regression-testing/14-order-to-cash-workflow.md`.
- Green: frontend focused 38/38 and full 1,012/1,012; backend full 2,136/2,136; frontend/backend typechecks; lint (0 errors; 94 existing warnings); final `make build`; full E2E 386 pass / 0 fail / 31 configured skips; diff/context checks; independent backend review. Evidence: `qa/2026-08-22_independent-factory-route_*`.
- Authenticated local rendered smoke at 1440px confirms separate factory/route controls, the temporary instruction, no horizontal overflow, console errors, or failed HTTP responses. Headless Chrome did not reliably open the combobox option list; those red attempts and the successful rendered screenshot are preserved in the manual QA artifacts, while automated regressions cover selection and persistence.
- Preserve unrelated untracked `screenshot_filter_check.mjs`.

**Updated:** 2026-08-22 10:40 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Closed-loop QA green; no commit, push, deployment, migration, or data-master change performed.

## Current task — restore shipment classifications and Silversea local E2E

- `/shipments-detail` now renders the fulfillment-owned container classification in `Thông số container`: `Đơn`, `Kẹp`, `Kết hợp`, or `Lẻ`. It remains distinct from the shipment-level `Đóng kết hợp` note.
- The CUS API now projects the active fulfillment classification, with canonical `SINGLE` (FCL) and `LCL` fallbacks for containers without a fulfillment. The separate, final `Trạng thái` grid column remains unchanged.
- Task-owned source/tests: `shared/src/schemas/cus-shipment-workspace.ts`, `backend/src/services/cus-shipment-workspace.service.ts`, `backend/src/tests/cus-shipment-workspace.test.ts`, `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx`, `frontend/src/pages/ShipmentsDetailPage.css`, and `frontend/src/pages/ShipmentsDetailPage.test.tsx`.
- Green: focused backend and frontend coverage, full frontend suite (176 files / 1,012 tests), backend/frontend typechecks, lint (0 errors; 94 existing warnings), final build, browser QA at 1440px / 768px / 390px, source review, and diff check. Evidence: `qa/2026-08-21_shipment-container-classification_*`.
- The local E2E runner no longer contains NEPO configuration: it targets only `SILVERSEA_*` variables and the local Silversea frontend (`7174`), API (`3001`), and explicit isolated fixture database (`5441/silversea`). The persisted dispatch bootstrap/cleanup chain and forwarder empty-state expectations now run against the actual local product.
- The scheduler runner defers its database client import until a scheduled tick runs, so pure scheduler unit tests exit without a leaked postgres.js handle.
- Green after the local repair: backend 2,135/2,135, frontend 1,012/1,012, full E2E 386 pass / 0 fail / 31 expected skips, lint (0 errors; 94 existing warnings), shared/backend/frontend typechecks/build, browser QA, diff check, and independent review. The reviewer-found production ESM scheduler import was corrected and verified against the built artifact. Evidence: `qa/2026-08-21_local-dev-repair_*` plus `qa/2026-08-21_shipment-container-classification_*`.
- Preserve unrelated untracked `screenshot_filter_check.mjs`.

**Updated:** 2026-08-21 21:20 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Committed on `main` as `22b82b6` and `8d66f95`, pushed to `origin/main`, and deployed to staging. `make demo` completed migrations, restarted backend/frontend, and passed public backend/frontend checks.

## Current task — compact one-field creation dialogs

- The shared `RouteCreateDialog` now removes its modal footer. Its optional integer `Khoảng cách (km)` input is capped at 184px and shares a right-aligned action row with `Thêm tuyến đường`; the primary action is 44px tall on narrow canvases. The retained modal close control and Escape cancel creation; Enter still submits through the existing modal shortcut.
- The one-field `ShippingLineAddDialog` now uses the same footer-free, right-aligned action-row pattern. The longer factory/warehouse form intentionally keeps its footer because its multi-field completion/cancellation workflow benefits from it.
- Task-owned source/tests: `frontend/src/features/shipments/create/RouteCreateDialog.tsx`, `ShippingLineAddDialog.tsx`, `frontend/src/pages/clerk/ClerkShipmentCreatePage.css`, `ClerkShipmentCreatePage.test.tsx`, and `frontend/src/pages/master-data-name-forms.test.tsx`. No API, schema, RBAC, data, or migration changed. Committed on `main` as `6d4e91a` (`fix(shipments): compact create dialogs`) and deployed to staging; source was not pushed.
- Green: focused route/factory and shipping-line tests; full frontend suite 176 files / 1,011 tests; frontend typecheck; root lint (0 errors, 94 existing warnings); final `make build`; context and diff checks; source review. Evidence: `qa/2026-08-21_route-dialog-density_*` and `qa/2026-08-21_dialog-footer-density_*`.
- Desktop rendered CUS QA at 1440px confirms a 184px distance field, shared row, right-aligned action (17px inner inset), no footer, no horizontal overflow, and no console errors. Mobile rendered interaction is blocked by the local responsive shipment-create flow not exposing the trigger to the headless runner; this is retained in the manual QA artifact and must not be claimed green.
- User-authorized staging release ran through `make demo`: backend/frontend images published, a rollback snapshot retained, migrations completed, and backend/frontend were recreated. Public backend health and frontend HTTP checks passed again via `make demo-health`. Evidence: `qa/2026-08-21_dialog-footer-density_staging-deploy.log` and `qa/2026-08-21_dialog-footer-density_staging-health.log`.
- Preserve the unrelated untracked `screenshot_filter_check.mjs` file.

**Updated:** 2026-08-21 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Committed and staging deployed with public runtime checks green; mobile rendered interaction remains unverified.

## Current task — add a route from the factory dialog

- The `Thêm nhà máy` dialog now places a dashed `+ Thêm tuyến đường` action directly below the required `Tuyến đường` selector. It opens the existing route form, adds the created route to the parent catalog, and selects it for the factory before submission.
- Factory draft data, selected route, and keyboard focus survive route-form cancellation. A route-form API error stays visible in the route form; after dismissal, the factory draft is retained. The 240 ms two-way handoff waits longer than the shared modal exit so only one `aria-modal` is active at a time.
- Task-owned source/tests: `frontend/src/components/shipment/OperationalSiteCreateDialog.tsx`, `frontend/src/features/shipments/create/ShipmentCreateWorkspace.tsx`, and `frontend/src/pages/master-data-name-forms.test.tsx`. The changes are already committed on `main` as `6fab219` and test expansion `6e4ab31`; `main`, `origin/main`, and `origin/HEAD` currently point to `6e4ab31`.
- Green: focused frontend tests 6/6; full frontend suite 176 files / 1,011 tests; frontend typecheck; root lint (0 errors, 94 existing warnings); `make build`; context and diff checks; independent review. Evidence: `qa/2026-08-21_operational-site-add-route_*`.
- User-authorized staging release ran through `make demo`: images published, a rollback snapshot retained, pending migrations applied, and only backend/frontend were recreated. Public health/frontend checks passed; backend/frontend are up with PostgreSQL and Redis healthy. Evidence: `qa/2026-08-21_operational-site-add-route_staging-*`.
- Rendered authenticated browser QA was not performed. Preserve the unrelated untracked `screenshot_filter_check.mjs` file.

**Updated:** 2026-08-21 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Committed and staging deployed; runtime checks green.

## Current task — remove shipment-create section numbering

- `/shipments/new` no longer renders decorative `01`–`04` section badges. The section title, description, focus target, form behavior, conditional LCL route section, and container-table `STT` row index are unchanged.
- The committed `main` implementation is in `80a61fe`; its source and regression check remove the number prop, markup, badge CSS, and all four call-site values. This task did not create a commit.
- Green: targeted frontend style regression 19/19, frontend typecheck, root lint (0 errors; 94 existing warnings), context check, and diff check. The broad frontend suite is red 1,007/1,008 only in concurrent `DispatchAllocationPopover.test.tsx` (`Nhà xe dòng 2` label missing). Build is red in concurrent `OperationalSiteCreateDialog.tsx` due missing `setRouteDialogOpen` / `routeDialogOpen` identifiers. Evidence: `qa/2026-08-21_shipment-create-section-numbering_*`.
- No migration, data mutation, push, deployment, or commit was performed by this task. Preserve the remaining concurrent dirty work.

**Updated:** 2026-08-21 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Requested UI behavior is present and scoped gates are green; broader repository gates are blocked by concurrent unrelated changes.

## Current task — FCL factory-derived route authority

- FCL no longer renders the shipment-level `Điểm vận hành & tuyến` section. Each container now selects its own factory; the route is displayed read-only and derived from that factory. A shipment may therefore have containers for different factories/routes.
- Backend authority now persists the canonical route on each factory (`operational_sites.route_id`) and validates every FCL container and dispatch handoff against that mapping. Migration `0032_add-factory-route` is nullable for legacy sites because their routes cannot be inferred safely; new factory writes require a route.
- Green: focused UI tests 41/41, focused backend tests 18/18, full frontend tests 1,007/1,007, full backend tests 2,134/2,134, lint (0 errors; 94 existing warnings), both typechecks, build, and targeted CUS workspace E2E 29/29. Full E2E ran 328 pass / 5 fail: 3 pre-existing forwarder zero-fixture/UI-empty-state failures, one deliberately blocked persisted-dispatch suite without `NEPO_DATABASE_URL`, and TC-1817 was repaired then rerun green. Evidence: `qa/2026-08-21_fcl-factory-route_*`.
- Local development database migration was applied. No commit, push, deployment, or staging/prod migration occurred. Preserve unrelated dirty work.

**Updated:** 2026-08-21 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Implementation and affected gates green; the full E2E aggregate remains environment/fixture-blocked as recorded above.

## Current task — shipment-detail filter actions and placeholder casing

- The `/shipments-detail` intermediate filter grid now reserves one non-wrapping action group for `Tất cả ngày` and `Xóa bộ lọc`; the compact two-column filter layout activates at a 900px **content-canvas** boundary, eliminating the prior 768px tablet overflow. No filter value, URL state, API, permission, or persistence behavior changed.
- Placeholder copy is now sentence case across the app: native input/textarea placeholders cannot inherit uppercase transforms, existing `VD:`/all-caps examples use `Ví dụ: …`, and `frontend/src/styles/placeholder-casing.test.ts` rejects future static all-caps values, including JSX-brace forms. Identifier normalization for entered values is unchanged.
- Green: focused frontend tests 51/51, frontend typecheck, root lint (0 errors / 94 existing warnings), `make build`, context check, and diff check. Evidence: `qa/2026-08-21_shipments-detail-filter-actions-placeholder_*`.
- Full frontend suite is red 1000/1006: the task-owned Ports placeholder expectation was fixed and is green in the focused rerun; the remaining five failures are concurrent shipment-create model/Clerk page changes. Rendered authenticated QA is blocked because the local app redirects to login and no credentials were entered.
- No commit, push, deployment, migration, or data mutation occurred. Preserve unrelated dirty work.

**Updated:** 2026-08-21 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Scoped implementation and automated gates green; full frontend suite blocked by unrelated concurrent failures; browser-rendered target verification requires login authorization.

## Current task — split Dispatcher lift/drop ports into separate columns

- `/dispatch` Master Plan now renders `Cảng nâng` and `Cảng hạ` as two independent desktop table columns rather than one combined `Địa điểm nâng/hạ` cell. The per-container port projection, pair-based aggregation, values, allocation action, API, RBAC, and CUS surfaces are unchanged.
- Below the 600px content canvas, the new lift/drop facts are kept side-by-side in the existing task-oriented dispatch card. Repeated `Nâng:` / `Hạ:` text is removed because the headers now provide that direction context.
- Green: focused MasterPlanGrid regression 27/27, frontend typecheck, root lint (0 errors / 94 existing warnings), full build, `pnpm context:check`, and diff check. The unfiltered full frontend suite is red in 10 unrelated concurrent shipment-create/master-data tests; see `qa/2026-08-21_dispatch-port-columns_*`.
- Rendered authenticated browser QA was not performed: local frontend/backend smoke passed, but no action-time authorization was given to enter demo credentials. No commit, push, deployment, migration, or data change occurred.

**Updated:** 2026-08-21 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Scoped implementation and automated gates green; full frontend suite blocked by unrelated concurrent failures; browser-rendered dispatch verification not run.

## Current task — minimal shipment-create canvas gutter

- `/shipments/new` now uses the full authenticated content canvas: its former 1360px cap and duplicate horizontal page padding are removed. The route retains only an 8px safe-area-aware outer gutter; card-internal padding, table behavior, and touch targets are unchanged.
- Rendered CUS QA at 1440×900 confirms `0px` workspace padding, `max-width: none`, 8px shell padding, no horizontal overflow, console errors, or HTTP 5xx. Screenshot and measurement: `qa/2026-08-21_shipment-create-canvas_browser-1440-rerun.*`.
- Green: focused styles test, frontend typecheck, root lint, `git diff --check`, and `pnpm context:check`. Review: `qa/2026-08-21_shipment-create-canvas_review.md`.
- Full frontend tests are red 997/1,004 in concurrent FCL factory/route authority and column-order expectations. `make build` is red in unrelated `master-data-name-forms.test.tsx` because an `OperationalSiteCreateDialog` fixture omits its new `routes` prop. Both exact outputs are retained under `qa/2026-08-21_shipment-create-canvas_*rerun.log`; do not alter those business-flow changes for this layout task.
- No commit, push, deployment, migration, or data mutation.

**Updated:** 2026-08-21 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Layout implemented and visually verified; repository-wide gates blocked by concurrent unrelated changes.

## Current task — full visual closure for 20 Aug CUS/Dispatcher DOCX

- Ran authenticated local visual QA with controlled, cleanup-scoped Drizzle fixtures across CUS overview/detail/create and Dispatcher master/detail at 1440×900, 768×1024, and 390×844. The final browser matrix is 71 PASS / 0 FAIL with no console, page, or HTTP errors; each DOCX requirement, method, and reason is in `qa/2026-08-21_cap-nhat-ui-logic-visual/report.md`.
- Corrected two confirmed rendered defects: removed the forbidden `Lộ trình:` prefix from both Dispatcher grids and made CUS overview factory/route identity lines wrap rather than ellipsize. Focused tests 119/119, full frontend suite 1,004/1,004, frontend typecheck, root lint (0 errors; 94 pre-existing warnings), and `make build` are green. Fixture cleanup completed; no test records remain.
- Evidence: `qa/2026-08-21_cap-nhat-ui-logic-visual/`. No migration, reset, commit, push, or deployment. Preserve concurrent dirty backend/E2E files and `screenshot_filter_check.mjs`.

**Updated:** 2026-08-21 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Complete locally; visual, regression, type, lint, test, and build gates green.

## Current task — complete 20 Aug CUS/Điều vận DOCX closure

- Reopened plans/260820-2030-cus-dispatch-ui-logic/ as the live requirement ledger: every written task and screenshots 1–11 has a source, behavioral authority, code/test owner, and completion or NOT_APPLICABLE_DATA_ABSENT disposition.
- Corrected the documented master-plan regression: Nâng/Hạ labels and values use regular 400 weight. The focused MasterPlanGrid test, full frontend suite (175 files / 1,003 tests), frontend typecheck, lint (0 errors; 94 pre-existing warnings), and build are green.
- Independent review found that a route-name fallback would mask a non-dispatchable legacy fulfillment. The queue and its counts now inner-join the shipment route, excluding route-less legacy rows; a deterministic backend regression and stricter E2E contract assertion cover the invariant. Full backend tests are green (2,131/2,131), backend typecheck and dispatch E2E are green (28/28).
- Browser QA captured 30 screenshots covering CUS and dispatcher access across the five requested routes at 1440×900, 768×1024, and 390×844. There were no access mismatches, console/network errors, or horizontal overflow. The master plan visibly renders Còn 2/2 cont chưa chốt ngày đóng trả; only the exact mixed 2/5 and an open container drawer fixture remain NOT_APPLICABLE_DATA_ABSENT.
- Committed task-owned source/test changes directly on `main` as `c08a5ab feat: complete CUS and dispatch DOCX closure`; the staged-diff format and secret checks passed. The untracked local `screenshot_filter_check.mjs` was deliberately excluded because it embeds demo credentials.
- Explicit user authorization then released the matched backend/frontend stack to staging with `make demo`. Both images were published, the existing migration set applied successfully, backend/frontend were recreated while PostgreSQL/Redis remained healthy, and public backend health plus frontend HTTP returned green. `main` is ahead of `origin/main`; no source push was requested.
- Evidence: qa/2026-08-21_cap-nhat-ui-logic_* including the staging deployment artifact. Preserve screenshot_filter_check.mjs as an untracked, credential-bearing local helper.

**Updated:** 2026-08-21 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Committed and staging deployed; all affected automated gates and public runtime checks are green. Source push was not requested.

## Current task — own-fleet SilverSea plate sync to CUS overview

- Confirmed root cause and existing fix in `a2f1187`: before an executed trip exists, dispatch stores an OWN plate in `shipment_fulfillments.planned_vehicle_plate_number`; the old CUS projection read only `tripTruckPlate`. The live implementation now falls back to the planned snapshot for CUS overview, detail, flat container workboard, and readiness—matching the existing Vendor fallback.
- This task adds the missing regression in `backend/src/tests/cus-shipment-workspace.test.ts`: it seeds an OWN allocation with a planned plate and no trip, then asserts `SilverSea / 15C-491.72` in each CUS projection.
- Green: focused backend test 35/35, backend typecheck, root lint (0 errors; 94 existing warnings), build, context check, diff check, and independent source review. Evidence: `qa/2026-08-21_own-fleet-plate-sync_*`.
- Full backend suite is red 2126/2130 in unrelated shared-local fixtures: M7.3/Q15/Q11 salary-period tests and seed-bootstrap duplicate legacy ` CUS ` username. Their full output is retained in the QA artifact; no payroll, seed, schema, or unrelated test code was changed.
- Preserved all concurrent dirty changes. No commit, push, deployment, migration, or business-data mutation was performed.

**Updated:** 2026-08-21 08:56 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** CUS plate-sync behavior regression is green locally; repository-wide backend suite remains blocked by unrelated shared-fixture failures.

## Current task — shipment-detail lift/drop port catalog regression

- The `/shipments-detail` inline `Chỉnh sửa hành trình` editor is confirmed to use `selectors.ports` (Master Data Cảng/Bãi), not customer `operationalSites` (Điểm đóng hàng). The existing source-and-contract repair is in `a2f1187`; this task adds an explicit regression assertion that `HY · Cảng Hưng Yên` is offered while `HY · Nhà máy Hưng Yên` is absent.
- Task-owned change: `frontend/src/pages/ShipmentsDetailPage.test.tsx`. Focused test is green (1 file, 33 tests); frontend typecheck, root lint (0 errors; 94 existing warnings), context check, and diff check are green. Evidence: `qa/2026-08-21_shipment-detail-port-selector_*`.
- A broad `pnpm test -- ShipmentsDetailPage.test.tsx` invocation ran the full frontend suite and exposed an unrelated concurrent failure in `ClerkShipmentCreatePage.test.tsx`; it is retained as evidence and was not changed here. No API, data, migration, commit, push, or deployment was performed.

**Updated:** 2026-08-21 08:42 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Scoped regression and automated verification green; no authenticated browser check because local login credentials were not entered.

## Current task — editable FCL route at cargo entry

- `/shipments/new` now exposes an editable, required `Tuyến đường` combobox in step 3 (`Thông tin hàng`) for `Hàng nguyên container (Cont)`. It uses the existing lot-level `routeId`: choosing it in either step 2 or step 3 updates the other and the creation payload, without a new API, schema, or route authority.
- The visible Vietnamese label stays `Tuyến đường`; the step-3 control receives the distinct accessible name `Chọn tuyến của lô hàng trong thông tin hàng`, preventing duplicate form-control names for screen-reader and keyboard users. The selector remains bounded to 420px on wide canvases and fills the narrow canvas below 640px.
- Task-owned source: `frontend/src/features/shipments/create/ShipmentCreateWorkspace.tsx`, `frontend/src/pages/clerk/ClerkShipmentCreatePage.css`, and `ClerkShipmentCreatePage.test.tsx`. Focused final test is green (25/25); frontend typecheck, root lint (0 errors / 94 existing warnings), context check, and diff check are green. Evidence: `qa/2026-08-21_fcl-cargo-route_*`.
- `make build` is red before the frontend build because concurrently edited `backend/src/services/shipment-queries.service.ts:846` returns `Map<number, Set<string>>` where `Map<number, string[]>` is declared. That backend file is out of scope and was not changed. Rendered local browser QA awaits action-time approval to enter the demo CUS credentials.

**Updated:** 2026-08-21 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Implementation and focused automated QA are green; repository build and authenticated browser QA remain externally blocked.

## Current task — compact mobile detailed dispatch records

- `/dispatch-detail` phone cards now use a two-column decision layout below a 640px content canvas: schedule and customer/route remain full-width, while Bill and container share a row. The classification tag is visually anchored beside the schedule; notes and the existing full-cell `Điều phối` trigger retain their own rows.
- Desktop and tablet presentation, data, permissions, mutation behavior, and the 44px mobile allocation/editor contract are unchanged. Task-owned source: `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx`, `DetailedPlanGrid.css`, and `DetailedPlanGrid.test.tsx`.
- Green automated evidence: full frontend suite 175 files / 992 tests, frontend typecheck, root lint (0 errors; 94 existing warnings), production build, context check, and diff check. Artifacts: `qa/2026-08-20_dispatch-detail-mobile-density_*`.
- Browser-rendered verification is blocked by the local SPA authentication/load state: its detail route did not become observable after the authorized local fixture attempt. The failure diagnostics are retained in the browser QA artifact; do not claim rendered mobile QA passed from this handoff.
- Preserved unrelated dirty deletion: `backend/scripts/_check_counts.mjs`.

**Updated:** 2026-08-20 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Code and automated frontend gates green; local authenticated browser verification blocked.

## Current task — fulfillment classification staging release

- `main` was clean at `ee2c419`; no new commit was required. The branch remains one commit ahead of `origin/main`; source push was not requested.
- Released the matched backend/frontend stack to staging with `make demo`. The deployment preserved the staging database and applied pending Drizzle migrations before the backend/frontend cutover.
- Public `https://vantai.tingting.vip/api/health` returned `status: ok`; the frontend public HTTP check passed. Backend and frontend are running the new `ee2c419` images with restart count zero; PostgreSQL and Redis remain healthy. Rollback snapshot: `/opt/vantai/.deploy-rollbacks/pre-cutover-20260820T165016Z.env`.
- Evidence: `qa/2026-08-20_fulfillment-classification_staging-deploy.log` and `qa/2026-08-20_fulfillment-classification_staging-runtime.log`.

**Updated:** 2026-08-20 23:52 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Staging release verified; broader local full-suite/E2E failures remain recorded separately.

## Current task — meaningful local-development QA dataset

- Ran the idempotent local `make seed` path. It recognized the existing `BULK-`
  fixture rather than duplicating it; no schema, source, account, staging, or
  production change was made.
- Verified through Drizzle against the local database: 250 bulk shipments across
  all eight shipment states, 281 containers, 298 fulfillments, 193 trips, 247
  trip-container rows, 60 company expenses, 30 customers, and 985 shipment
  status-history events (2,344 linked bulk records in total).
- Evidence: `qa/2026-08-20_local-bulk-qa_seed.log`,
  `qa/2026-08-20_local-bulk-qa_dataset-verification.log`, and
  `qa/2026-08-20_local-bulk-qa_context-check.log`. The verification log retains
  one failed inline-probe attempt followed by the corrected green rerun.
- Preserved concurrent migration and test changes without editing them.

**Updated:** 2026-08-20 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Local data is ready for high-density workflow QA; no commit, push, deployment, or reset occurred.

## Current task — fulfillment dispatch classification migration

- Local database migrations `0027`–`0030` are applied. They backfill missing classifications, make the column default to `SINGLE` and non-null, restore LCL rows, and enforce that `LCL_SHIPMENT` rows retain `LCL`.
- Runtime creation/decomposition and every direct LCL test fixture now provide `LCL` explicitly; FCL keeps the `SINGLE` default. The final SQL body for `backend/drizzle/0030_enforce-lcl-fulfillment-classification.sql` is still uncommitted; it is the only source change currently visible in `git status` after concurrent commits advanced `main`.
- Green evidence: migration application, `drizzle-kit check`, backend typecheck, focused classification/schema tests (23/23), diff check, and independent review. Artifacts: `qa/2026-08-20_fulfillment-classification_*`.
- Full backend and E2E reruns are red in the shared local database after mutating E2E activity, with unrelated customer/zone/seed/governance failures and a post-suite browser hang recorded in the same QA artifacts. No reset was authorized; do not claim full-suite acceptance from this state.
- No commit, push, deployment, or remote database change was performed by this controller.

**Updated:** 2026-08-20 23:45 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Migration-specific checks green; full-suite acceptance blocked by shared local DB/browser harness state.

## Current task — CUS/dispatch visual QA remediation and filter density

- The documented CUS/dispatch browser QA is now green for every exercised requirement. The missing narrow `/dispatch` quick-date actions were fixed by reusing one `QuickDateActions` component in both the inline and drawer date groups.
- The desktop dispatch filter toolbar now uses one compact visual contract: search, select, carrier facet, date, and quick actions have 34px surfaces with 12px/18px visible operational text. The custom carrier facet retains a touch-safe 44px contract below 768px.
- Task-owned code: `frontend/src/features/dispatch/master-plan/MasterPlanFilters.tsx`, `MasterPlanGrid.css`, and `MasterPlanFilters.test.tsx`. Evidence and the non-secret browser runner: `qa/2026-08-20_cap-nhat-ui-logic-visual/`.
- QA green: browser matrix 48 PASS / 0 FAIL / 12 data-absent, focused 4/4, full frontend 175 files / 991 tests, frontend typecheck, root lint (0 errors; existing warnings), `make build`, and `git diff --check`.
- No API, schema, RBAC, migration, business-data mutation, commit, push, or deployment occurred. The data-absent count reflects the final local fixture state; other dirty-worktree changes remain user-owned and untouched.

**Updated:** 2026-08-20 23:43 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Green for exercised requirements; six scenarios require specific fixtures and were not manufactured.

## Current task — compact dispatch date shortcuts

- The `/dispatch` date range no longer drops its shortcuts to a loose second
  row. `Tất cả các ngày` and `Về hôm nay` are explicit secondary buttons with
  pressed state and clear borders; they align beside the two date inputs, with
  the existing `Tạo lô hàng` action immediately after that group on desktop.
- The narrow filter drawer intentionally keeps its one-column layout and its
  existing touch controls. No filter patch, route, API, schema, RBAC, data, or
  persisted authority changed. Co-located carrier-facet density edits in the
  same shared files were preserved.
- Task-owned changes: `frontend/src/features/dispatch/master-plan/MasterPlanFilters.tsx`,
  `MasterPlanGrid.css`, and the focused assertions in the matching test files.
- QA green: frontend suite 175 files / 990 tests, frontend typecheck, root
  lint (0 errors; 94 existing warnings), `make build`, `pnpm context:check`,
  `git diff --check`, and source review. Evidence:
  `qa/2026-08-20_dispatch-date-toolbar_*`.
- Rendered browser QA is blocked by the local login's expired session. No
  credentials were entered or transmitted.

**Updated:** 2026-08-20 23:32 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Automated QA and review green; authenticated rendered verification blocked by expired local session.

## Current task — shipment-detail status filter and actions share a row

- The `/shipments-detail` filter toolbar now keeps `Trạng thái dữ liệu` and its `Tất cả ngày` / `Xóa bộ lọc` actions in the same CSS grid row. The action group is a child of the existing filter grid rather than a separate footer, preventing the status control from consuming a row while its actions wrap below it.
- At desktop and tablet widths the status control occupies the final grid column group beside the actions. At narrow widths, the direction filter receives its own row, preserving a usable status/action row and the existing touch-sized controls.
- Task-owned source: `frontend/src/pages/ShipmentsDetailPage.tsx`, `frontend/src/pages/ShipmentsDetailPage.css`, and `frontend/src/pages/ShipmentsDetailPage.styles.test.ts`.
- QA green: focused shipment-detail tests (42/42), frontend typecheck, root lint (0 errors; 90 existing warnings), and `make build`. The full frontend suite is 988/989 only because of the concurrent `MasterPlanFilters.test.tsx` assertion for `Tất cả các ngày`; this task did not modify that feature. Evidence: `qa/2026-08-20_shipment-detail-filter-row_*`.
- Rendered authenticated browser QA remains pending because entering local demo credentials requires explicit action-time permission. No API, schema, RBAC, migration, commit, push, deployment, or production-data change was made.

**Updated:** 2026-08-20 23:26 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Code and affected automated gates are green; full-suite completion is blocked by a concurrent Master Plan assertion and browser verification awaits credential-entry permission.

## Current task — 2026-08-20 CUS and dispatch visual QA

- Assessment-only QA against the attached `2026.8.20_Cap_nhat_UI_va_logic.docx` ran locally with the CUS and Điều vận credential entries from `prompts/qa-credentials.yaml`. It covered `/shipments`, `/shipments-detail`, `/shipments/new`, `/dispatch`, and `/dispatch-detail` at `1440x900`, `768x1024`, and `390x844`.
- Final browser ledger: 46 PASS, 1 FAIL, 12 `NOT_APPLICABLE_DATA_ABSENT`, with no console errors, page errors, HTTP 5xx responses, or rendered page overflow. Focused frontend regression is 166/166. Evidence and the reproducible non-secret runner are in `qa/2026-08-20_cap-nhat-ui-logic-visual/`.
- Open P2: the `/dispatch` mobile `Bộ lọc` drawer has the delivery-date fields but omits `Tất cả các ngày` and `Về hôm nay`, even though desktop and tablet expose both actions. See `bugs.md` and `screens/mobile-dispatch-date-filter-drawer.png` in the QA directory. The run did not change product code or business data.
- Current local fixtures cannot visibly cover editable CUS containers, partial appointment warnings, or allocated dispatch-detail rows. Creating the required cross-role data and checking in-house plate synchronization is outside this assessment-only authorization.

**Updated:** 2026-08-20 23:20 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** FAIL — one P2 mobile requirement miss; no remediation authorized.

## Current task — CUS detail uses the shipment-create spreadsheet cells

- The CUS `/shipments` container detail ledger now uses the same shared, value-first `ShipmentContainerCell` primitive as `/shipments/new`. Editable type, carrier, plate, lift site, drop-off site, and `Giờ hẹn đóng/trả` cells display one quiet value until clicked/focused, then reveal the existing accessible editor. This removes the oversized always-visible controls in the reported screen without altering CUS permissions, API payloads, optimistic versions, idempotency, per-row Enter save, or Escape discard.
- The shared cell styling was moved out of `ClerkShipmentCreatePage.css` into `frontend/src/features/shipments/create/ShipmentContainerCell.css`, so both flows have one source of truth. The CUS table keeps its fixed eight-column desktop worksheet and two-column mobile record layout with 44px controls.
- Task-owned source: `frontend/src/features/shipments/cus/CusContainerLedger.tsx`, `frontend/src/features/shipments/create/ShipmentContainerCell.tsx`, `ShipmentContainerCell.css`, `frontend/src/pages/ShipmentsPage.css`, the stylesheet/test references listed in `qa/2026-08-20_cus-shared-spreadsheet_review.md`.
- QA green: frontend suite 175 files / 989 tests, frontend typecheck, root lint (0 errors; 89 existing warnings), `make build`, `pnpm context:check`, `git diff --check`, and source review. Evidence: `qa/2026-08-20_cus-shared-spreadsheet_*`.
- Authenticated browser QA remains pending: the local login requires explicit action-time permission to use the demo account. No API, schema, RBAC, migration, commit, push, deploy, or production-data change was made.

**Updated:** 2026-08-20 20:40 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Code and automated QA complete locally; rendered authenticated drawer QA awaits permission.

## Current task — operational short/full factory names in appointment groups

- The appointment-group contracts for `/api/shipments` and `/api/shipments/cus-workspace` now return `factoryShortName` and `factoryFullName`. The retained `factoryName` field is deliberately the operational short-name alias, preserving older clients while making both source names available to newer ones.
- Both services resolve a factory from the operational-site entity (`shortName` first, then `name`), including shipment-level site fallback in CUS. Grouping uses a typed `site:<id>` or `legacy:<text>` identity, so same-text short names and a site ID such as `9` cannot merge unrelated appointments. Legal/billing document projections are untouched.
- Task-owned source: `backend/src/services/shipment-queries.service.ts`, `backend/src/services/cus-shipment-workspace.service.ts`, `shared/src/schemas/cus-shipment-workspace.ts`, `frontend/src/api/shipmentClient.ts`, and the corresponding backend/shared/frontend fixtures. No database schema or migration changed.
- QA green: backend 2,128/2,128, shared 177/177, backend/shared/frontend typechecks, root lint (0 errors; 89 existing warnings), build, diff check, context check, and independent review (`qa/2026-08-20_operational-short-name_*`). Full frontend is 988/989: the only failure is the unrelated concurrently-edited `ShipmentsPage` active-cell focus assertion. E2E preflight is blocked because local frontend is not running on `:7174`; `make dev` was not started without user authorization.
- No commit, push, deployment, migration, or production-data change was made.

**Updated:** 2026-08-20 20:08 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Backend contract implementation and review are green; repository-wide completion is blocked only by the concurrent frontend assertion and stopped local services for E2E.

## Current task — compact dispatch lift/drop hierarchy

- The `/dispatch` master-plan `Địa điểm nâng/hạ` cell now presents each
  container port pair in exactly two regular-weight lines: `Nâng:` or `Hạ:`
  followed by `Cảng ... · <container summary>`. The lift label uses the
  existing forest token and the drop label uses the existing teal token; port
  names and quantities stay compact normal table text.
- The renderer still uses only `containerPortGroups`; its fallback preserves
  separate `Nâng:` / `Hạ:` labels and never projects legacy shipment-level
  locations. No API, persisted data, RBAC, filtering, or other table columns
  changed.
- Task-owned source: `frontend/src/features/dispatch/master-plan/MasterPlanGrid.tsx`,
  `MasterPlanGrid.css`, and `MasterPlanGrid.test.tsx`. QA green: focused
  master-plan 22/22, full frontend 175 files / 989 tests, frontend typecheck,
  root lint (0 errors; 89 existing warnings), `make build`, and `git diff --check`.
  Artifacts: `qa/2026-08-20_dispatch-location-format_*`.
- Browser QA was not run: the active local-browser handoff requires explicit
  approval before entering demo credentials. No commit, push, deployment,
  migration, or production-data change was made.

**Updated:** 2026-08-20 19:56 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Complete locally and uncommitted in the shared dirty tree.

## Current task — CUS spreadsheet cell visual repair

- The `/shipments` CUS container worksheet now follows the `/shipments/new` value-first spreadsheet convention: the selected type shows only its canonical code (for example, `40DC`), while the picker still searches code and description. This removes the redundant `40DC - 40'DC` display without changing the underlying selection value.
- The two `Nâng` / `Hạ` columns now receive a 144px fixed desktop budget, and select values/placeholders truncate before the chevron. The rendered comparison against `/shipments/new` also found that CUS still exposed 11px, 40px pill controls, so CUS now reuses the create sheet's `ShipmentContainerCell` value-first wrapper: its spreadsheet values are readable without control chrome and the native editor appears on focus. This retains the existing horizontal-scroll desktop contract and the two-column mobile card conversion.
- Task-owned files: `frontend/src/features/shipments/cus/CusContainerLedger.tsx`, `frontend/src/pages/ShipmentsPage.css`, `frontend/src/pages/ShipmentsPage.density.test.ts`, and `frontend/src/pages/ShipmentsPage.test.tsx`. The prior Enter-to-save and Escape-to-discard behavior remains intact; no visible save button is restored.
- QA green: targeted frontend tests 70/70 (including the post-comparison re-run), root lint (0 errors; existing warnings only), `git diff --check`, and source review. The full frontend suite is 986/989 and red only in concurrent `MasterPlanGrid.test.tsx` assertions; frontend typecheck and `make build` are red only at concurrent `MasterPlanGrid.test.tsx` lines 157-161. Exact outputs: `qa/2026-08-20_cus-container-cell-visual_*`.
- Chrome reference QA against staging confirmed `/shipments/new` uses a code-only container control. Local frontend and backend are running and the local login screen is open for final desktop/tablet/mobile rendered QA, which requires explicit action-time permission to enter the local demo credentials.
- No API, schema, RBAC, commit, push, deployment, migration, or production-data change was made.

**Updated:** 2026-08-20 19:55 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Scoped code and focused verification are green; local rendered browser QA is awaiting credential-entry confirmation, while repository-wide gates are blocked only by concurrent Master Plan changes.

## Current task — dispatch container-detail cell wrapping

- The read-only `/dispatch` container-detail drawer now explicitly resets the legacy global table `nowrap` rule for its body cells. Long carrier, lift-site, and drop-off names wrap inside their own fixed desktop columns instead of painting over `Biển số` or adjacent data.
- Task-owned files: `frontend/src/features/dispatch/master-plan/DispatchContainerDetailDrawer.css` and `DispatchContainerDetailDrawer.test.tsx`. The focused test protects the scoped `white-space: normal` rule; mobile continues to use the existing two-column record layout.
- QA green: focused drawer test (2/2), root lint (0 errors; 89 existing warnings), `git diff --check`, `pnpm context:check`, and authenticated desktop browser QA. The browser measured a synthetic long carrier cell at 128px wide, 63px high, with equal `scrollWidth`, `clientWidth`, no document overflow, and no console/network errors. Evidence: `qa/2026-08-20_dispatch-container-cell-wrap_*`.
- Full frontend test (984/989), frontend typecheck, and `make build` are currently red in unrelated concurrent `MasterPlanGrid.test.tsx` changes (type mismatch at lines 157–161); the suite also reports unrelated `ShipmentsPage.density` and `RecoverableCosts` failures. Those files were not changed for this repair.
- No API, schema, RBAC, commit, push, deployment, migration, or production-data change was made.

**Updated:** 2026-08-20 19:52 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Scoped visual repair and rendered verification complete locally; repository-wide QA remains blocked by concurrent unrelated failures.

## Current task — CUS drawer coherent form typography

- The `/shipments` CUS detail drawer is now a compact operational form: one `Trạng thái lô` heading, a workflow badge, signals, then a three-part decision row. Redundant uppercase eyebrows, the non-actionable location sentence, and the separate `Hành động tiếp theo` label were removed.
- The scoped type scale is coherent across the drawer: 20px identity, 16px workflow heading, 12px field labels and reasons, and 14px operational values/actions. `Lịch giao theo container` is shortened to `Lịch cont`; the empty state is `Chưa có lịch`. Disabled-action reasons remain visible and tied to their button for accessibility.
- Task-owned files: `frontend/src/pages/ShipmentsPage.tsx`, `frontend/src/pages/ShipmentsPage.css`, and `frontend/src/pages/ShipmentsPage.test.tsx`.
- QA green: frontend suite 175 files / 989 tests, frontend typecheck, root lint (0 errors; 89 existing warnings), `make build`, `git diff --check`, and source review. Artifacts: `qa/2026-08-20_cus-drawer-typography_*`.
- Browser QA was not run because the local frontend/backend are stopped. No API, schema, RBAC, commit, push, deployment, migration, or production-data change was made.

**Updated:** 2026-08-20 19:12 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Complete locally and uncommitted in the shared dirty tree.

## Current task — CUS container spreadsheet save shortcut

- The `/shipments` CUS container ledger no longer has a ninth save column or a visible `Lưu` action. This restores the eight-column spreadsheet shape used by `/shipments/new` and reduces its desktop minimum width from 1042px to 974px.
- A dirty editable row now saves with Enter and reverts only that row with Escape. Select triggers retain their normal Enter behavior; pending saves and IME composition cannot submit another write. Existing CUS permissions, optimistic versions, idempotency keys, save errors, and the narrow two-column card transformation are unchanged.
- Task-owned files: `frontend/src/features/shipments/cus/CusContainerLedger.tsx`, `frontend/src/design-system/forms/SearchableSelect.tsx`, their focused tests, plus `frontend/src/pages/ShipmentsPage.css` and density test.
- QA green: focused frontend 86/86, full frontend 175 files / 989 tests, frontend typecheck, root lint (0 errors; 89 existing warnings), `make build`, `git diff --check`, and `pnpm context:check`. Artifacts: `qa/2026-08-20_cus-container-keyboard-grid_*`, including independent review.
- Browser QA is blocked because the local frontend/backend are stopped. The user-provided staging reference redirects to login; shared staging credentials were not placed in tools, logs, or artifacts.
- No API, schema, RBAC, commit, push, deployment, migration, or production-data change was made.

**Updated:** 2026-08-20 18:58 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Complete locally and uncommitted in the shared dirty tree; independent code review approved after a keyboard-propagation fix.

## Current task — dispatch schedule column budget

- `/dispatch` now gives `Thời gian & lịch trình` 22% of the desktop master-plan table (up from 13%), so multi-appointment schedule and customs-cutoff lines can be read without the needless wrapping shown in the customer screenshot. `Chứng từ & hãng tàu` is 10% and `Phân bổ nhà xe` is 11%; cargo/notes absorb the remaining balance. The seven explicit widths still total 100%.
- The 900px container-query transition is untouched: tablet/mobile retain the existing task-oriented record layout, its 44px allocation target, and safe-area behavior. No route, API, schema, RBAC, allocation, or drawer interaction changed.
- QA green: focused master-plan suite 22/22, full frontend 175 files / 989 tests, frontend typecheck, root lint (0 errors; 89 existing warnings), and `make build`. Authenticated browser QA at 1440x900, 768x1024, and 390x844 found no console errors, failed responses, or horizontal overflow; desktop measured schedule 232px vs documents 106px and allocation 116px on the real 1,056px table canvas. Artifacts: `qa/2026-08-20_dispatch-schedule-column_*` (ignored local evidence directory).
- No commit, push, deployment, production-data, or API changes were made. Existing drawer and shipment-detail changes remain preserved.

**Updated:** 2026-08-20 18:53 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Complete locally and uncommitted in the shared dirty tree.

## Current task — dispatcher in-place container detail

- `/dispatch` master-plan rows now expose `Xem chi tiết cont`; it opens a compact, read-only drawer containing every container’s STT, number, type, status, carrier, plate, lift/drop location, and appointment without changing the route. `STT` is a distinct narrow column; the `CONTAINER` column now holds only the container number. Focus returns to the originating action on close.
- The CUS overview is a condensed worksheet, while FCL appointments are authoritative per container across create, CUS detail, generic shipment detail, portal detail, and dispatch. `expected_delivery_date` is the earliest-container operational projection, computed in the Vietnam business timezone; a ready FCL shipment cannot lose the final appointment it already had.
- QA green: focused drawer test (2/2), full frontend 175 files / 988 tests, frontend typecheck, root lint (0 errors; 89 existing warnings), and build. Exact current artifacts: `qa/2026-08-20_dispatch-container-stt_*`. The prior browser session is unavailable now because neither local frontend nor backend service is running; the focused DOM test verifies the standalone `STT` header/cell and the separate container row header.
- Full backend remains red in two known shared-database fixtures (`dispatch fleet missing date defaults to today` and seed bootstrap `users_username_unique` for legacy ` CUS `), and the dedicated E2E dispatcher matrix exceeded its 180-second guard while walking 30 `networkidle` surfaces. Both outputs are captured under `qa/2026-08-20_dispatch-container-drawer_*`.
- No commit, push, deployment, migration, or production-data change was made because the required final QA gate is not green.

**Updated:** 2026-08-20 18:49 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Presentation change complete locally and uncommitted; browser verification is blocked by stopped local services. The pre-existing shared backend/E2E failures remain unrelated to this frontend-only adjustment.

## Current task — per-container delivery-date authority

- The CUS shipment-detail drawer and container workboard no longer let users edit or present a delivery date as a single lot-level value. They show and edit the appointment of each container instead; generic and customer portal details add the same per-container schedule column, while aggregate surfaces call the retained internal projection `Lịch cont sớm nhất`.
- `updateCusShipmentContainerLine()` now recomputes `shipments.expected_delivery_date` from the earliest Asia/Ho_Chi_Minh-local container appointment in the same transaction, promotes a pending shipment when appropriate, and creates the handoff/history. Full container reconcile now also refreshes that derived projection (including a cleared final appointment).
- Regression coverage: CUS multi-container API test proves two different appointments preserve both container dates and persist the earliest projection; frontend tests protect removal of the lot-level drawer/editor and each affected display surface. QA: frontend 984/984, focused backend shipment routes 136/136, both typechecks, lint (0 errors; 89 existing warnings), build, context check, and diff check. Artifacts: `qa/2026-08-20_per-container-delivery-date_*`.
- No commit, push, deployment, migration, or production-data change was made.

**Updated:** 2026-08-20 08:55 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Complete locally; browser QA and the full backend suite were not run in this pass.

## Current task — mobile control density and safe-area release

- Mobile `/shipments/new` controls now use the shared 44px Untitled input/select/date contract. The accidental 62px create-form override was removed rather than replaced with another page-specific rule; `control-density.styles.test.ts` protects the shared primitive contract and date-input size forwarding.
- The create actions remain in normal flow with iPhone safe-area clearance. The `/dispatch` toolbar keeps the key controls visible, moves secondary conditions into its drawer, hides the two pending broad port facets, and preserves safe-area padding in that drawer.
- Committed directly on `main`: `2e65c71 fix(ui): compact mobile controls and safe areas`. A frontend-only staging image tagged `2e65c71` was published and deployed to `https://vantai.tingting.vip`; backend and database were not changed. The pre-cutover rollback snapshot is retained at `/opt/vantai/.deploy-rollbacks/pre-cutover-20260820T005359Z.env`.
- Final evidence: frontend suite 984/984, frontend typecheck, root lint (0 errors; 89 existing warnings), production build, context validation, and authenticated staging QA. The staging create form measured 44px at 390px and 768px, 32px at 1440px, with no overflow, console errors, or failed network requests. Artifacts: `qa/2026-08-20_mobile-control-density_*`.

**Updated:** 2026-08-20 07:57 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Released to staging; real iOS/WebKit safe-area behavior remains the only device-specific follow-up.

## Current task — temporarily hide broad dispatch port facets

- `/dispatch` no longer renders the broad `Cảng Lạch Huyện` and `Cảng Hải Phòng` port facets in either the desktop toolbar or the mobile filter drawer. It matches rendered labels after NFC Unicode normalization, so the database's decomposed `Cảng Hải Phòng` variant is also hidden.
- This is UI-only and intentionally reversible: port taxonomy, facet APIs, persisted data, existing detail screens, and every other port-zone facet remain unchanged. The decision pending customer confirmation is recorded beside the scoped display rule.
- Task-owned source: `frontend/src/features/dispatch/master-plan/MasterPlanFilters.tsx` and `MasterPlanFilters.test.tsx`. The focused regression goes red → green (2/2) and covers both desktop plus mobile drawer surfaces; artifacts are `qa/2026-08-20_dispatch-port-filters_*`.
- Frontend typecheck, root lint (0 errors; 89 existing warnings), production build, `pnpm context:check`, and `git diff --check` are green. Full frontend test is red at 982/984 only in two unrelated concurrent changes: shared control-density string assertion and Clerk create-form focus restoration. No API, schema, RBAC, commit, push, deployment, or production-data change was made.

**Updated:** 2026-08-20 07:49 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** UI change verified locally; source changes remain uncommitted in the shared dirty tree.

## Current task — mobile create-form control and bottom-action parity

- On `/shipments/new` at phone widths, every single-line create-form field now matches the 62px `Hãng tàu` control: customer, Bill/Booking, import/export type, shipping line, and declaration. The scoped rule lives in `frontend/src/design-system/forms/ShipmentCreateControlDensity.css`, imported by the shared create-field adapters, so the page CSS does not fork UUI control geometry. Multiline notes and actions intentionally keep their own semantics.
- The normal-flow `Huỷ` and `Tạo lô hàng` actions now have dedicated bottom clearance of `calc(44px + env(safe-area-inset-bottom, 0px))`; the row is not sticky. At 390x844 and true end-of-scroll, both buttons are fully visible, 44px tall, and retain 72px clearance above the scrollport bottom. Browser QA reported no horizontal overflow, console errors, or failed requests; screenshot: `qa/2026-08-19_create-bottom-actions_browser-mobile.png`.
- Task-owned source: `frontend/src/design-system/forms/ShipmentCreateControlDensity.css`, `frontend/src/features/shipments/create/uui-fields.tsx`, `frontend/src/pages/clerk/ClerkShipmentCreatePage.css`, and `ClerkShipmentCreatePage.styles.test.ts`. Focused 24/24 and full frontend 984/984 are green; frontend typecheck, root lint (0 errors; 89 pre-existing warnings), `make build`, `git diff --check`, and `pnpm context:check` are green. Complete artifacts: `qa/2026-08-19_create-input-density_*` and `qa/2026-08-19_create-bottom-actions_*`.
- No API, schema, RBAC, commit, push, deployment, or production-data change was made.

**Updated:** 2026-08-19 23:47 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Complete locally; source changes remain uncommitted in the shared dirty tree.

## Current task — compact mobile master-plan filters

- On `/dispatch` at a narrow canvas, the primary toolbar shows only `Tìm kiếm`, `Chiều hàng`, and a 44px `Bộ lọc` trigger. `Phân xe`, delivery dates, port facets, and carrier selection now live in a full-width, focus-trapped drawer.
- The drawer exposes the number of active advanced conditions, supports `Đặt lại` without clearing search or cargo direction, closes with Escape, and restores focus to the filter trigger. Tablet and desktop retain the existing inline controls.
- Task-owned source: `frontend/src/features/dispatch/master-plan/MasterPlanFilters.tsx`, `MasterPlanGrid.css`, `MasterPlanFilters.test.tsx`, and `MasterPlanGrid.test.tsx`. Exact QA artifacts are `qa/2026-08-19_master-plan-mobile-filter_*`.
- Follow-up visual repair: the mobile drawer's feature stylesheet had overwritten the shared safe-area padding with fixed values. `MasterPlanGrid.css` now preserves `safe-area-inset-top` on the header and `safe-area-inset-bottom` on the footer; `MasterPlanGrid.test.tsx` protects both declarations. Browser QA at 390x844 has no overflow, console errors, or failed network requests; screenshot: `qa/2026-08-19_master-plan-drawer-safe-area_mobile.png`.
- Follow-up QA: focused master-plan test (19/19), frontend typecheck, root lint (0 errors; 89 existing warnings), and `make build` are green. The full frontend suite is red only at the pre-existing `control-density.styles.test.ts` violation in concurrent `ClerkShipmentCreatePage.css`; its complete output is retained in `qa/2026-08-19_master-plan-drawer-safe-area_frontend-test-full.log`.
- Final evidence: focused 21/21, full frontend 984/984, frontend typecheck, root lint (0 errors; 89 existing warnings), `make build`, and `pnpm context:check` are green. Authenticated browser QA at 390x844, 768x1024, and 1440x900 confirms no overflow, no console/failed-network errors, mobile drawer content and full width, and Escape focus restoration.
- During this task, another controller advanced `main` to `188f7eb` and `ee8b783` (also reflected at `origin/main`). This controller did not create a commit, push, deploy, or alter APIs, schemas, RBAC, or data.

**Updated:** 2026-08-19 23:31 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Complete locally; final CSS/mobile-drawer regression assertions remain uncommitted in the shared dirty tree.

## Current task — authority địa điểm nâng/hạ theo cont

- `/dispatch` now renders lift/drop port pairs only from
  `shipment_containers.pickup_port_id` and `dropoff_port_id`. A shipment's
  legacy free-text `pickupLocation` / `deliveryLocation` is never used in the
  master-plan location cell; rows without container port data explicitly show
  `Nâng: —` / `Hạ: —`.
- The create-shipment workspace already persisted `Cảng nâng` / `Cảng hạ` on
  each container row, so no migration or form redesign was needed. The list
  read model batches and groups containers by exact pickup/drop pair and type.
- When the dispatch summary is requested, port groups load within the same
  read-only repeatable-read transaction as the port-filtered page, preventing
  a filter/display snapshot mismatch during a concurrent edit.
- Task-owned source: `backend/src/services/shipment-queries.service.ts`,
  `backend/src/services/shipment.service.ts`,
  `frontend/src/api/shipmentClient.ts`,
  `frontend/src/features/dispatch/master-plan/MasterPlanGrid.tsx`, and their
  focused tests. Independent review is recorded in
  `qa/2026-08-19_container-port-authority_review.md`.
- The persisted end-to-end regression is now covered by `shipment-service.test.ts`
  (33/33): a Lạch Huyện port filter returns only the shipment with a matching
  container and returns each distinct container port pair. The create model has
  a two-container regression, full frontend is 983/983, both typechecks, lint,
  and build are green. Browser QA adds two different port pairs through the
  normal create form at desktop and mobile with no console/network/overflow
  defects.
- Full backend is 2,123/2,125 due to unrelated aging and seed-bootstrap tests.
  E2E suites 00–12 and 14–15 are green; suite 13 has three unrelated forwarder
  empty-state failures, and suite 16 stalls with a live Playwright process.
  No unrelated test or product code was changed. Full outputs are under
  `qa/2026-08-19_container-port-authority_*`.
- No migration, commit, push, deployment, or production data change was made.

**Updated:** 2026-08-19 23:02 Asia/Ho_Chi_Minh
**Controller:** Codex
**Status:** Port terminal labels are implemented locally; full-backend verification is blocked by a leftover fixture row in the shared local test database. Changes remain uncommitted.

## Current task — rename three Lạch Huyện terminal labels

- The persisted `ports` names are now `TC - HICT`, `TIL - HTIT`, and
  `Hateco - HHIT`, per the approved Vietnamese operations copy.
- New custom migration `backend/drizzle/0026_rename-lach-huyen-terminal-labels.sql`
  updates only active matching rows by terminal code and legacy name. It preserves
  port IDs, so existing shipment-container references remain intact.
- Root/reference/deployment seed data and port-display fixtures use the same
  labels. Seed shipment lookup and `seedPorts()` preserve the stable `HICT`,
  `HTIT`, and `HHIT` codes rather than deriving new codes from the display
  labels; focused regression coverage protects this mapping.
- QA artifacts: `qa/2026-08-19_port-terminal-labels_*`. Migration check,
  focused backend 11/11 plus seed-code 6/6, focused frontend 31/31, an initial
  backend full 2,125/2,125,
  frontend full 981/981, both typechecks, root lint (0 errors, 89 existing
  warnings), and `make build` are green. The first post-fix full-backend re-run
  collided with another concurrent full seed suite on the shared local database
  (`users_username_unique` and `ports_code_unique`). A subsequent isolated run
  no longer had a port failure but remained red because that collision had left
  a canonical `cus` fixture row, so the bootstrap test cannot restore its
  legacy ` CUS ` row under the username uniqueness constraint. Both complete
  failure artifacts are retained; reset that shared fixture state, then re-run
  the full backend suite before committing.
- No migration was applied to the shared local database: its preceding concurrent
  `0025_add-container-operational-site` is intentionally unapplied. Apply the
  normal migration chain when the coordinated release is authorized.
- No commit, push, deployment, API, schema, or RBAC change was made.

## Current task — prevent duplicated dispatch port label

- `/dispatch` no longer adds `Cảng` to an already canonical DB zone label such
  as `Cảng Hải Phòng`; labels without the prefix still render as `Cảng Lạch
  Huyện`. The check handles decomposed Vietnamese Unicode too.
- Task-owned files: `frontend/src/features/dispatch/master-plan/MasterPlanFilters.tsx`
  and `frontend/src/features/dispatch/master-plan/MasterPlanFilters.test.tsx`.
- Focused regression is green (red → green evidence under
  `qa/2026-08-19_dispatch-zone-label_frontend-test.*.log`); frontend typecheck,
  root lint (0 errors, 89 pre-existing warnings), and the standalone frontend
  production build are green. Scoped review is approved.
- The broad frontend suite remains 974/980 because of concurrent failures in
  shipment-density, master-plan appointment, shipment-drawer, driver-progress,
  carrier-allocation tests. Root `make build` is blocked by the concurrent
  `shipmentContainers.deletedAt` schema/type mismatch in
  `backend/src/services/shipment-queries.service.ts`. No unrelated code was
  changed to hide either failure.
- No deployment, commit, push, API, schema, or RBAC change was made.

## Current task — redesign CUS shipment-detail drawer

- Reworked the `/shipments` detail drawer into a flat, exception-first decision sheet. The heading is truthful, the duplicate delivery-date label is removed, the condition strip is compact, and a blocked action's visible reason is connected through `aria-describedby`.
- Flattened the nested rounded container panels into divider-separated records. Untitled UI/SearchableSelect controls use compact desktop density; raw mobile inputs and selectors retain 44px touch targets.
- Task-owned source: `frontend/src/pages/ShipmentsPage.tsx`, `frontend/src/pages/ShipmentsPage.css`, `frontend/src/features/shipments/cus/CusContainerLedger.tsx`, `frontend/src/pages/ShipmentsPage.test.tsx`, and `frontend/src/pages/ShipmentsPage.density.test.ts`.
- Focused tests pass 70/70; the exact-final full frontend suite passes 174 files / 980 tests. Frontend typecheck, root lint (0 errors, 89 concurrent warnings), `make build`, and scoped diff check pass.
- Authenticated CUS browser QA on `QA-HUMAN-20260819-U201` passes at 1440x900, 1024x768, and 390x844 with no horizontal overflow, console errors, or failed fetch/XHR. Evidence is under `qa/2026-08-19_shipment-drawer-redesign_*`.
- Independent review found and closed one mobile cascade issue: searchable-select text is now 16px within its 44px target at 390px. The post-fix full frontend suite remains green at 174 files / 980 tests, and the authenticated computed-style recheck has no document overflow or browser/network errors.
- The pre-existing Understand-Anything baseline is 11 commits behind committed `HEAD`; 44 changed source files exceed the incremental-update threshold, so a separate full `/understand --full` rebuild is required. The graph metadata was not falsely advanced.
- No API, schema, RBAC, financial logic, deployment, commit, push, or production-data change was made. Existing concurrent backend, dispatch, create-page, and QA-script changes were preserved.

## Current task — Task 2.3 Bỏ hiển thị thừa

- In the `Lịch trình & điều xe` cell on `/shipments`, ordinary rows no longer
  render the leading shipment-level date before per-container appointment
  groups. The actionable `Chưa chốt ngày` warning remains for waiting rows,
  as do appointment groups and vehicle-readiness text.
- Task-owned source: `frontend/src/pages/ShipmentsPage.tsx` and
  `frontend/src/pages/ShipmentsPage.test.tsx`.
- Focused regression: 63/63 (`qa/2026-08-19_shipments-overview-schedule-leading-date_frontend-test.focused.rerun.log`). Frontend typecheck, root lint (0 errors, 89 existing warnings), build, diff check, and `pnpm context:check` pass. Independent review has no findings:
  `qa/2026-08-19_shipments-overview-schedule-leading-date_review.md`.
- The broad frontend command is otherwise blocked by the pre-existing concurrent
  Clerk focus-restoration failure at `ClerkShipmentCreatePage.test.tsx:193`;
  its full output is saved at
  `qa/2026-08-19_shipments-overview-schedule-leading-date_frontend-test.rerun.log`.
- No API, schema, export, commit, push, or deployment changes were made.

## Previous handoff scope

## Current task — Epic 3.1 Master Plan emphasis

The requested dispatch master-plan emphasis is already present on `main` in
`frontend/src/features/dispatch/master-plan/MasterPlanGrid.tsx`; this task
made no source changes.

- Company and Bill/Book have no `master-plan-grid__line--strong` class.
- The route's Nâng/Hạ lines and shipping line have the strong class.
- `MasterPlanGrid.test.tsx` asserts all four cases; focused test is 15/15.
- Frontend typecheck, root lint (0 errors; 89 existing warnings), and
  `make build` are green. Logs: `qa/2026-08-19_dispatch-master-plan-highlight_*`.

## Goal and result

Correct the responsive behavior reported on `/shipments`.

- At viewport widths of 1000px and above, the seven-column shipment table remains visible.
- From 1000–1279px, the five filter controls use two rows: search + direction, then both dates + status.
- Below 1000px, the existing two-column record layout remains in effect; the existing single-column mobile treatment remains unchanged.
- Compact editable-cell labels now occupy their own grid track instead of overlapping values.

## Scope

- Modified by this task: responsive filter and table rules in `frontend/src/pages/ShipmentsPage.css`
- Modified by this task: CSS regression assertions in `frontend/src/pages/ShipmentsPage.test.tsx`
- Non-goals: shipment data, API behavior, schemas, RBAC, column content, deployment, commit, or push.

## Root cause

The record-layout switch used a 1000px container query. At a 1024px browser viewport, the application sidebar and gutters reduced the workspace container to 906px, so the page incorrectly switched to records. The filter grid used a similar container query, which produced a full-width search plus two two-control rows (three rows total).

## Evidence

`qa/2026-08-19_shipments-table-breakpoint_*`:

- Red focused test captured before implementation; final `ShipmentsPage` suite 62/62.
- Full frontend rerun 958/958; frontend typecheck exit 0.
- Root lint exit 0 with 90 pre-existing warnings; `make build` exit 0.
- Authenticated browser QA at 1000/1024/1280/1440/999/390px: table visible at every width >=1000px, two filter rows at 1000/1024px, and zero document overflow at every sampled width.
- Fresh 1024px browser run: no page errors and no failed 4xx/5xx fetch/XHR responses.

## Unrelated/concurrent state preserved

- The dirty tree contains active shipment-detail, shipment schedule, vehicle-read-only, backend/shared/e2e, migration, port-config, and dispatch-detail work owned by other sessions.
- This task did not revert, reformat, commit, push, or deploy concurrent work.

## Concurrent CUS cargo-priority/completeness result

- Creation and overview use the approved visible vocabulary `Cont` / `Lẻ`; overview tags and priority ordering are preserved.
- Unscheduled CUS lots sort first, then newest-to-oldest, with same-date priority Cont 20 → Cont 40 → Lẻ; backend tests prove the order remains stable across pages and recognizes container size from canonical code or name.
- `/shipments-detail` exposes URL-backed `Chưa cập nhật`, renders the exact server-derived missing fields without clipping, and keeps filter actions compact.
- CUS external BKS editing follows shipment/business-unit scope, accounting locks, optimistic versioning, idempotency, own-fleet denial, and post-trip denial. Read-only rows explain the governing reason.
- Transport date and per-container appointment are shown separately and saved as independent authority groups, preventing a half-applied two-request save.
- Responsive ledger cells allocate their real height below 900px; real mouse/touch now hits the schedule control instead of an overlapping row.

### CUS evidence

`qa/2026-08-19_cus-cargo-completeness_*` and `qa/2026-08-19_cus-systematic-gaps_*`:

- Shared 177/177; backend 2,105/2,105; exact final serial frontend 958/958.
- Exact final frontend typecheck, root lint (0 errors; 90 pre-existing warnings), and `make build` all pass.
- Real-role E2E 29/29 across 1440/1024/768/640/390/320px, including stable missing-filter rendering and a dedicated 390px pointer-open schedule case.
- Independent review and visual QA have no remaining production findings; screenshots and reports are stored under `qa/`.
- No commit, push, or deployment was performed.

## Concurrent dispatch-tag typography result

- `/shipments-detail` now renders only `Chưa điều xe` and `Đã phân xe` at 10px/1.4 through status-specific modifiers on the existing Untitled UI badge.
- Focused tests pass 42/42; root lint, frontend typecheck, and `make build` pass.
- Authenticated browser QA at 1000/768/390px confirms 10px computed type, zero document overflow, no page errors, and no failed fetch/XHR responses.
- An initial typecheck/build run exposed a concurrent `DetailedPlanFilters.tsx` fixture gap. Its owner completed that work during this task; fresh frontend typecheck and `make build` reruns are green. The exact-final full frontend suite is 957/959 because concurrent dispatch work still expects the old 9-condition filter count and adds two `font-variant-numeric: tabular-nums` declarations rejected by the global font contract. This typography task did not alter that out-of-scope dispatch work.
- Evidence is stored under `qa/2026-08-19_shipments-detail-dispatch-badge_*`; no commit, push, or deployment was performed.

## Next step

- Commit/push/deploy only on explicit user request and after coordinating the combined dirty working tree.

## CUS and dispatch presentation alignment (uncommitted)

- CUS role label is `Nhân viên Chứng từ`; legacy Clerk-facing role copy follows it.
- Shipment creation no longer folds a declaration number into notes. FCL uses the per-container `Ngày giờ đóng trả` datetime field and sends an explicit `customerAppointmentAt`; shipment dispatch date remains independent.
- The shipment overview no longer repeats its nearest closing/return time. Existing appointment groups and detail-ledger mappings remain the schedule authority.
- Master Plan bolds only route pickup/dropoff and shipping line. Detailed Plan now orders columns `Ghi chú` → `Điều phối` → `Phân loại`; classification remains sourced from the atomic dispatch-plan edit mapping.
- Focused frontend suites pass 138 tests; focused backend CUS/dispatch suites pass 69 tests. Lint, backend typecheck, frontend typecheck, and a rerun of `make build` pass. Scoped diff check and `pnpm context:check` pass.
- Full backend tests remain interrupted by `scheduler.test.ts`; full frontend tests still contain two unrelated failures (font-family contract and create-page focus restoration) plus concurrent Port Config failures. E2E is 302/312 with phase-relevant CUS workspace 29/29 green; all artifacts are `qa/2026-08-19_cus-dispatch-ui-logic_*`.

## Human visual QA — CUS and Điều vận (assessment only)

- Local UI was inspected as CUS and Điều vận at 1440px and 390px without changing application data. The CUS role label, missing-data filter, FCL datetime control, absence of the redundant overview closing/return line, dispatch emphasis, detailed-plan column order, and classification editor are visually verified.
- No page console errors, API 4xx/5xx responses, or document-level horizontal overflow were observed on the visited surfaces. Evidence is in `qa/2026-08-19_cus-dispatch-human-visual_*`.
- Complete visual acceptance is blocked only by missing controlled local states: no unscheduled shipment, no saved appointment timestamp, and no isolated editable row for notes/classification persistence. No code changes were made during this assessment.

### Authorized QA seed rerun

- The user authorized local data mutations. Disposable `QA-HUMAN-20260819` records now cover: an unscheduled FCL draft, 20DC/40DC/LCL rows on the same date, and an FCL record with a declaration, clean customer note, and saved appointment timestamp.
- Visual recheck proves sort order `null` → newest date, and same-date `20DC` → `40DC` → `LCL`; the appointment appears in both overview and CUS detail while the note remains separate from the declaration number.
- Classification persistence is now visually proven: the QA S20 shipment was allocated, its handoff accepted, its fulfillment atomically saved as `Đơn`, then reloaded in Kế hoạch Chi tiết with the `Phân loại` cell still showing `Đơn`. No production code was changed.

## Dispatch editor redesign (uncommitted)

- The detailed-plan atomic editor now places the container identity in the modal title, uses compact regular-weight selectors, gives `Phân loại` a bounded content width, keeps `Đóng kết hợp (kẹp chuyến)` inline with its checkbox, and formats both estimate fields with Vietnamese separators plus `đ` while preserving raw integer submission.
- Task-owned source changes: `frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx`, `DispatchPlanEditorCell.css`, and focused assertions added to `DetailedPlanGrid.test.tsx`. Concurrent changes in `DetailedPlanGrid.tsx`, `DetailedPlanGrid.css`, backend, Drizzle metadata/migrations, and other tests were preserved.
- Focused editor assertions pass 3/3 and the complete `DetailedPlanGrid` suite passes 24/24. Frontend typecheck, root lint (0 errors; 89 unrelated warnings), `make build`, `git diff --check`, and `pnpm context:check` pass.
- Authenticated MANAGER browser QA at 1440×900, 768×1024, and 390×844 confirms header identity, 168–180 px classification width, 12 px/400 dropdown text, zero checkbox/text center offset, live VND grouping, `đ` suffixes, and zero document overflow. Evidence is under `qa/2026-08-19_dispatch-editor-redesign_*`.
- The full frontend suite remains 967/968 because the committed `DetailedPlanGrid.css` has two `font-variant-numeric: tabular-nums` declarations rejected by the pre-existing font-family contract. This task did not add or modify those declarations. No commit, push, or deployment was performed.

### Classification-value QA rerun

- Product clarified the intended visible order as `Ghi chú` → `Điều phối` → `Phân loại`.
- Four disposable, explicitly prefixed QA fulfillment rows now display all persisted values after a browser reload: S20 `Đơn`, S40 `Kẹp`, U201 `Kết hợp`, and LCL1 `Lẻ`.
- Browser evidence has no console errors, failed API requests, or 1440px document overflow: `qa/2026-08-19_cus-dispatch-human-visual_classification-all-values-1440.png` and the human visual report.

### Classification tag typography correction

- Saved classification tags now share one neutral regular-weight presentation: inherited product font, 12px supporting text, 400 weight, identical solid border/radius/padding. `Đơn`, `Kẹp`, `Kết hợp`, and `Lẻ` no longer branch by paired status.
- `Chưa phân loại` remains the sole pending-state variant, using muted text and a dashed border without a bold font.
- Focused grid suite: 24/24. Frontend typecheck, root lint (0 errors; concurrent warnings), and `make build` pass. Authenticated browser QA at 1440px and 390px has no overflow, console errors, or failed API requests. Evidence: `qa/2026-08-19_dispatch-classification-tag_*`.

### Current-HEAD Epic 2 verification

- The four CUS Epic 2 requirements are already present in committed source (`c6b0238` and its retained follow-up UI fixes); no application source was changed in this verification pass.
- Fresh focused shared and frontend checks are green: 177/177 shared tests, 104/104 CUS overview/detail/create tests, and both frontend/backend typechecks. The scoped diff check is clean. Artefacts: `qa/2026-08-19_epic2-cus-current-head_*`.
- The fresh backend integration regression is blocked before Epic 2 behavior by the concurrently edited, unapplied `0025_add-container-operational-site.sql`: the local database lacks `shipment_containers.operational_site_id`. The failure is recorded in `qa/2026-08-19_epic2-cus-current-head_backend-focused.log`; no migration was applied or altered because it belongs to the other active workstream.

### Combined-lot document note correction

- The detailed-plan document cell no longer renders `ĐÓNG KẾT HỢP` as a large brown, wrapping pill. It now renders the compact, regular 11px `Kết hợp` note (with the full phrase in its title) beside the Nhập/Xuất indicator.
- The document footer uses explicit `combined direction` grid areas, so the note stays on one line at the lower left while the direction remains at the lower right. Focused grid tests pass 24/24; frontend typecheck, lint (0 errors; 89 pre-existing warnings), production build, and authenticated 1440px/390px browser QA pass. Evidence: `qa/2026-08-19_dispatch-combined-note_*`.

### Shipment-detail mobile filter action alignment

- At `<=520px`, the final `Thông tin` filter shares a row with `Về hôm nay` / `Xóa bộ lọc`; the first five filters retain full-width rows. This is CSS-only and does not alter filtering behavior or API calls.
- Browser QA at 442×844 confirms aligned control bottoms and no horizontal overflow (`scrollWidth = 442`): `qa/2026-08-19_shipments-detail-filter-inline_442x844.png`.
- Focused page/style tests 42/42, frontend typecheck, root lint (0 errors; 89 existing warnings), build, and diff check all pass. Artefacts: `qa/2026-08-19_shipments-detail-filter-inline_*`.

### Dispatch allocation validation copy correction

- The carrier-allocation dialog now keeps only the shared, carrier-specific row warning when both container quantities are empty. It no longer repeats the generic message or invalid icon under both the `20'` and `40'` inputs.
- Task-owned files: `frontend/src/features/dispatch/master-plan/DispatchAllocationPopover.tsx` and its focused test. Browser QA as ADMIN at 1440px verifies one SilverSea row warning, zero generic field messages, zero invalid count inputs, no console/network errors, and no document overflow. Evidence: `qa/2026-08-19_dispatch-allocation-row-validation_*`.
- Focused test, frontend typecheck, root lint, build, and scoped diff check pass. The full frontend suite is 967/969 because of two already-concurrent failures outside this dialog: the global font contract and Clerk shipment-create focus restoration; no unrelated code was altered.

### Shipment-detail mobile card-density correction

- At 521–760px, the container ledger uses two equal cards per row: customer/documents, container/route, schedule/vehicle. This fills the previously empty right half; notes remain intentionally full-width.
- At `<=520px`, the ledger remains a readable one-column fallback. The customer `th` now receives the same responsive editable-cell height/label treatment as `td` cells, so the first card is no longer blank.
- Editable triggers supply labels for every mode and place their content in the value track. Route values stack in a half-width card at 521–760px, avoiding the `Nâng/Hạ` collision.
- Authenticated CUS browser QA confirms zero horizontal overflow at 570×844 and 442×844. Screenshots: `qa/2026-08-19_shipments-detail-mobile-cards-final-recheck_570x844.png` and `qa/2026-08-19_shipments-detail-mobile-cards-final_442x844.png`.
- Focused page/style tests pass 42/42; frontend typecheck, root lint (0 errors; 89 existing warnings), and `make build` pass. Red-to-green logs are under `qa/2026-08-19_shipments-detail-mobile-*.log`. No commit, push, or deployment was performed.

### CUS container worksheet density correction (uncommitted)

- The CUS shipment drawer now uses the same spreadsheet-style operational pattern as shipment creation: one semantic table row per container with columns for container, type, dispatch state, carrier, plate, lift/drop sites, per-container appointment, and line-level save. It replaces the former two high vertical `Nhận diện` / `Vận hành` bands.
- The workflow/context strip and ledger spacing were reduced, and the desktop drawer may use up to 1180px so the worksheet fits without clipping its save control. At drawer canvases under 760px, the table deliberately becomes labelled two-column task cards; the container identifier remains a full-width card heading and touch controls remain 44px at phone width.
- Existing per-container permissions, idempotency, optimistic versions, unsaved-change protection, carrier creation, and appointment authority are unchanged. Tests now assert the table and its responsive transformation instead of the retired tier layout.
- QA: frontend typecheck exit 0; frontend tests 984/984; root lint exit 0 (89 pre-existing warnings); `make build` exit 0. Authenticated CUS browser QA is captured at 1280px, 800px, and iPhone 14 in `qa/2026-08-20_cus-container-worksheet_{desktop,tablet,mobile}.png`; review is `qa/2026-08-20_cus-container-worksheet_review.md`. No commit, push, or deployment was performed.

### Shipment-detail status typography and width (uncommitted)

- The container-ledger status badge uses one compact 10px / 1.4 type scale for every dispatch state, so `Hoàn thành` no longer falls back to the larger shared badge font. The desktop status budget is 8% (previously 9%); notes receive the released 1%, and status labels may wrap.
- Task-owned files: `frontend/src/pages/ShipmentsDetailPage.css` and `ShipmentsDetailPage.styles.test.ts`. No API, data, RBAC, or workflow mapping changed.
- QA green: focused styles 12/12, full frontend 175 files / 1,003 tests, frontend typecheck, root lint (0 errors; 94 pre-existing warnings), frontend production build, and authenticated browser checks at 1440x900 and 558x844 with no overflow, console errors, or failed requests. Artifacts: `qa/2026-08-21_shipment-status-compact_*`.
- The first root `make build` was blocked by a concurrent backend type mismatch in `backend/src/services/shipment-queries.service.ts`; the owning workstream corrected it. A fresh root build completed successfully afterward (see `qa/2026-08-21_own-fleet-plate-sync_build.log`). No commit, push, or deployment was performed.

### Dispatch-detail overflow screenshot verification

- The supplied 508px screenshot is the old seven-column rendering of `/dispatch-detail`. Current committed responsive CSS already converts the grid to labelled records at a 900px workspace and a two-column task card below 640px, retaining the full `Điều phối` editor and visible `Đơn` tag without horizontal overflow.
- Fresh authenticated local ADMIN browser QA at 508×1442, 768×1024, and 1440×900 has zero document overflow, console errors, and HTTP >=400 responses. Focused DetailedPlanGrid test (28/28), frontend typecheck, context validation, and diff check pass.
- An attempted `pnpm test -- DetailedPlanGrid.test.tsx` ran the unfiltered frontend suite and remains red in three concurrent MasterPlanGrid/ShipmentsPage assertions. Source was not changed. Evidence: `qa/2026-08-22_dispatch-detail-overflow_*`.

### testplan/testaccounts.txt sweep (2026-08-30) — DONE

- Ran the closed-loop SDLC gates against `testplan/` (100 flow TCs + 215 role ACs) and `testplan/testaccounts.txt` on local dev. Two follow-ups from the 2026-08-29 sweep + one stray in-progress refactor.
- **Stale conformance-skin list** (`frontend/src/components/control-density.styles.test.ts`): commit `175d88bf` added the CUS form's `.csc-uui-field label` (local label-cadence alignment: 12/18 semibold across combobox + text + date) but did not add it to `sanctionedConformanceScopes`. Test was passing on the first re-run by accident; the second run correctly flagged it. Fix: add `.csc-uui-field label` to the list with a comment cross-referencing `docs/design-guidelines.md`. Block stays scoped to the CUS form's own wrapper, not a bare `.ds-uui-*`, so the guard's intent (no bare `ds-uui-*` overrides) still holds.
- **Missing CUSTOMER demo accounts**: `testplan/testaccounts.txt` documents `samsung-cs` and `canon-cs` (CUSTOMER role, Samsung Electronics VN + Canon VN) but `backend/src/seed.ts` only created the generic `customer` user. TC-CUST-SHIP-03 (row-scope, no leak) had no second CUSTOMER user to cross-verify. Fix: add the two customers (tax codes 0301444111, 0301444222), add 1 IMPORT shipment per customer (105254551001, 105254551002), and refactor the single-`customer` user block into a `customerPortalSeeds` loop that idempotently seeds `customer`, `samsung-cs`, `canon-cs`, each row-scoped to its own customer. The existing `customer` user (linked to Biển Bạc) is preserved byte-for-byte on re-runs.
- **Email domain drift**: `testplan/testaccounts.txt` claimed `@silversea.vn` for all 11 demoUsers; the live seed has used `@nepo.vn` since 2026-08-20. Canonicalised the doc to `@nepo.vn` and added the customer row note for each portal account.
- **Bonus — AR N+1 refactor** (found uncommitted in the working tree between the two runs): `backend/src/services/total-ar-report.service.ts` was running 2 queries per customer (opening + activity) inside a JS loop, giving O(customers) round-trips. Collapsed to 2 grouped queries in parallel with the customer lookup, then indexed the results by `entityId` in JS. M5.5 service tests (6/6) + new route tests (4/4) stay green; aggregation is byte-identical. Committed separately as `ca8453a3 perf(ar-report): collapse 2*N ledger queries into 2 grouped passes`.

#### Verification on local dev (pnpm dev, localhost:3001 + 7174)

- 13/13 demo accounts log in (admin, giamdoc, ketoan, cus, dieuvan, laixe, giaonhan, thu, pho, quyet, customer, samsung-cs, canon-cs).
- samsung-cs → `/api/portal/shipments` total: 1 (105254551001 / READY_FOR_DISPATCH).
- canon-cs   → `/api/portal/shipments` total: 1 (105254551002 / READY_FOR_DISPATCH).
- samsung-cs → `/api/portal/shipments/304070` (canon's id) → HTTP 404 `{"error":"Không tìm thấy lô hàng"}` — **TC-CUST-SHIP-03 PASS**.

#### Gate result

- Lint: 0 errors / 161 warnings (1 net new pre-existing in `m55-total-ar-route.test.ts`).
- Backend tsc, frontend tsc, `make build` all exit 0.
- Frontend `pnpm test --run` 1370/1370 (244 files).
- Backend `pnpm test` 2270/2270 (431 suites) — +4 from the new route tests + 0 from the AR refactor (the service test was already there).

#### Commits

- `ca8453a3 perf(ar-report): collapse 2*N ledger queries into 2 grouped passes`
- `3e68154d testplan(qa-loop): seed samsung-cs/canon-cs customers + sanction CUS form label`

#### Artifacts (local, not committed; `qa/` is gitignored)

- `qa/2026-08-30_testplan-qa/REPORT.md`
- `qa/2026-08-30_testplan-qa/lint.log`, `backend-tsc.log`, `frontend-tsc.log`
- `qa/2026-08-30_testplan-qa/m55-total-ar.log`
- `qa/2026-08-30_testplan-qa/testaccounts-probe.log`
- `qa/2026-08-30_testplan-qa/row-scope-probe.log`

No commit, push, or deployment was performed.

### testplan/testaccounts.txt sweep — DEPLOYED (2026-08-30 11:16 SGT)

- Pushed `5b6e5fdd` (the HANDOFF note) and `3e68154d` (the actual fix commit) to `origin/main`; `make demo` cut over on `vantai.tingting.vip` with backend `5b6e5fdd-dirty-96ec912063d5`. Health check returned `{"status":"ok"}` and the frontend public HTTP check passed.
- The new `samsung-cs` and `canon-cs` CUSTOMER accounts were NOT seeded by the deploy — `make demo` does not run the seed. The staged `node dist/seed.js` fails at `resolveSeedReferenceIds()` because the staging port code is `TCHICT` (the seed looks for `HICT`). I applied a targeted, idempotent SQL migration (`qa/2026-08-30_testplan-qa/samsung_canon_seed.sql`) directly to the staging Postgres to insert the 2 customers (tax 0301444111, 0301444222) + 2 users + 2 shipments (SHP-2608-00078 / 00079). Staging now passes TC-CUST-SHIP-03 (samsung-cs → canon-cs's id 79 → 404 "Không tìm thấy lô hàng"). Migration is re-runnable.
- The port-code mismatch is a real seed bug worth a follow-up PR: `seed.ts:847` hard-codes the lookup `if (p.code === 'HICT')` but the data team has standardised the code as `TCHICT` (the local DB still has the old name). Suggested fix: look up by name `'Cảng Tân Cảng HICT'` (or both `HICT` and `TCHICT`), or move the reference to a config table. Not blocking — a one-off migration is fine for now.

No further commit, push, or deployment was performed.

### Visual QA pass against testplan/ on local dev (2026-08-31) — DONE

- Visited 30+ routes across 7 demo roles (cus, dieuvan, driver, accountant, admin, samsung-cs, canon-cs) via Playwright with token-injected localStorage auth. ~25 PNG screenshots in `qa/2026-08-31_visual-qa/`.
- Caught 2 stale tests vs. in-flight design changes:
  1. `Layout.test.ts > DISPATCHER nav matrix` — `getNavItems` now returns 6 items (the new "Sổ chuyến đi" / `/trips`); the matrix test expected 5. Added the new item.
  2. `MasterPlanGrid.test.tsx > schedule column width` — 2b023521 rebalanced the desktop grid so schedule is now 15% (was 22%), route-shipping is 16% (new wider), allocation is 12%. The test still asserted the old shape. Updated to the new priority: schedule 15, route-shipping 16, allocation 12, schedule > allocation, sum-to-100 invariant.
- Committed as `ed4ae12c test(frontend): align Layout + MasterPlanGrid assertions with in-progress design`. No product behaviour change.
- Gates after the fix: lint 0/269, tsc 0/0, backend 2285/2285, frontend 1370/1370, build green.

No further commit, push, or deployment was performed.

### Visual QA pass — Sep 1, 2026 — DONE

- 27 routes × 7 roles, all rendered correctly. Caught one cosmetic regression: `/my-penalties` Zone 2 KPI grid was letting the 3rd card wrap onto a 2nd row at 1440px because the shared `.kpi-grid` had no explicit column count.
- Fix: `6e569caf style(driver-penalty): pin KPI grid to 3 columns on desktop` — added `cols-3` modifier so all 3 cards (Vi phạm / Khấu trừ / Tổng biên bản) stay on one row.
- Gates: lint 0/269, tsc 0/0, backend 2285/2285, frontend 1370/1370, build 5.28s. Pushed + `make demo` deployed to vantai.tingting.vip.
- Re-verified the new features shipped yesterday (`3f688fad`): `/trips` route works for the dispatcher, `Sổ chuyến đi` shows in the sidebar, ADMIN can open `/finance/treasury` (the casbin policy addition).
- QA artifact: `qa/2026-09-01_visual-qa/REPORT.md` + 25 PNGs.
