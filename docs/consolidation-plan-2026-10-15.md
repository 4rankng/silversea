# Consolidation plan — cost-doc split-brain (2026-10-15)

**Status: PLAN ONLY.** No merge, no reset, no write to the main checkout was performed.
**Snapshot:** 2026-10-14 ~23:45 (+07), main HEAD `b47fffc5`. Several fleet agents were
**still running** when this was inventoried (waves A–D, sweep-v2, qa-batch, hero) — every
"in-flight" number below is a point-in-time reading. Re-inventory before executing.

Main checkout: `/Volumes/LexarSSD/projects/silversea` (branch `main`).
Two pre-existing stabs live in the shared stash stack
(`audit-recovery-session-01a0f570`, `On prod: pre-polish-patch`) — consolidation must
**never** pop or touch the shared stash.

---

## TL;DR

1. The main checkout does **not** hold ~22 files — it holds **76 uncommitted entries**
   (67 modified + 2 deleted tests + 7 untracked files + 2 untracked dirs): a complete,
   coherent "Card 20261005" cost-doc batch (1,350+/679− on tracked files alone), with
   **zero gate evidence** and **3 migrations that drizzle would never run** (no journal
   entries, no snapshots — newest snapshot is 2026-10-13).
2. The fleet is mostly **not on branches yet**: only wave A has a commit (1 of its 4
   planned P0s); waves B, C, D and hero-illustration are **uncommitted worktree state**;
   `fix/pre-qa-sweep` (+v2) is **already merged** into main — only stale refs remain;
   `fix/qa-new-batch-1014` has 3 solid commits with committed UI-DRIVEN evidence.
3. Four head-on collisions: **OPS lot-cost scope** (3 implementations: wave A commit,
   Ghostty working tree, wave C testplan), **driver cost form** (wave B vs Ghostty, same
   files, different batch strategy), **PENDING tạm ứng + hoàn ứng settle** (wave A
   CPB-03/04 vs Ghostty, already written), **bill-digit-search endpoint** (wave D vs
   Ghostty built two).
4. Recommended order: qa-batch → hero → wave D → wave A → wave B/C (after decisions) →
   **Ghostty last**, committed to a new branch *inside the main checkout* (switch -c
   carries the working tree; never stash), with migrations registered via drizzle-kit
   and superseded hunks dropped.
5. Decisions U1–U8 (§6) gate execution. U1 (is the Ghostty session finished?) is a
   precondition for everything.

---

## 1. Ghostty main-checkout inventory (read-only)

`git status` on `/Volumes/LexarSSD/projects/silversea`: 67 `M`, 2 `D`,
untracked: 3 migrations, 3 backend services/tests + 2 test files, 1 advisory doc,
`frontend/public/brand/`, `frontend/src/features/accounting/phoiPhieu/`,
3 frontend files. Diffstat (tracked): 69 files, +1,350/−679.

### Feature groups

**G1 — "Cược" Bill/Book on phơi phiếu (trip-level deposit field)**
| File | Change |
|---|---|
| `backend/src/db/schema/trips.ts` | +`deposit_shipment_id`, +`deposit_bill_number` (nullable, app-level FK, documented) |
| `backend/drizzle/20261014090000_trip_deposit_reference.sql` | NEW migration (unregistered — see Q1) |
| `backend/src/services/phoi-phieu-control.service.ts` | +66: `setPhoiPhieuDeposit` (version lock + audit log), `getPhoiPhieuDeposit` (joins deposit-lot customer) |
| `backend/src/routes/expense-accounting.ts` | +GET/PUT `/phoi-phieu/:tripId/deposit` (PHOI_PHIEU_ROLES + `requireExpenseFinance` on write) |
| `backend/src/services/bill-book-search.service.ts` | NEW (59 ln): digit search over live lots' bl/booking, max 10 rows |
| `backend/src/routes/shipments/core.routes.ts` | +GET `/bill-book-search` (1–4 digits, digits-only guard, empty → no query) |
| `frontend/src/features/accounting/phoiPhieu/DepositBillField.tsx` | NEW: suggestion combobox field |
| `PhoiPhieuChiHoDialog/TienDuongDialog/phoi-phieu-dialogs.css/api clients/keys` | wiring (+8–12 each) |

Quality: good. Optimistic `expectedVersion` 409, audit row, empty-input guard so a blank
ô never table-scans. Comments cite card 20261005 throughout.

**G2 — Driver cost form: payer removal, evidence kind, batch save**
| File | Change |
|---|---|
| `backend/drizzle/20261014104501_clear_driver_cost_payer.sql` | NEW: `UPDATE driver_incidental_costs SET payer_kind = NULL` — **destructive data op** (documented: driver only records spend, accountant assigns payer; safe per reconciliation reasoning) (U8) |
| `backend/src/db/schema/costs.ts` | +`evidenceKind` (`INVOICE`/`RECEIPT`, NULL = legacy) |
| `backend/src/routes/driver.ts` | +POST `/trips/:tripId/incidental-costs/batch`: one Idempotency-Key ≤50 rows, one txn, per-row write path reused, rollback names `Dòng n` |
| `backend/src/services/driver-fulfillment.service.ts` | +43: extracted `insertDriverIncidentalCostTx` so single + batch share one rule set |
| `frontend/src/features/driver/useDriverExpenseEntry.ts` | 142 ln: drafts table, per-row evidence state, "Lưu tất cả (n)" |
| `frontend/src/components/trip/ShipmentCostEntryForm.tsx/.css` | rework + shared `receiptStillNeeded()` photo rule |
| `frontend/src/features/expense-accounting/ExpenseEvidenceFields.tsx` | NEW shared evidence-kind fields |
| `ShipmentCostEntryDraft.test.tsx` NEW, form/hook tests, `driverClient`, `expense-accounting` drawers | +tests & client batch support |

Quality: strong — all-or-nothing txn with idempotent replay, shared single/batch write
path, the photo rule stated once. **Collides head-on with wave B** (same 3 files).

**G3 — OPS lot-cost scope: grant removed + duplicate-cont warning**
| File | Change |
|---|---|
| `backend/src/services/expense-owner-scope.service.ts` | −68: `assertOpsExpenseAssignment` + `opsExpenseWriteScope` **deleted**; only DRIVER keeps trip-assignment scope |
| `backend/src/routes/ops.ts` | `GET /expenses/write-scope` → `GET /expenses/cont-claimants` (warning data, never blocks) |
| `backend/src/services/ops-expenses.service.ts` | +47: `listOpsExpenseContainerClaimants` (dedupe/container, non-VOIDED); all 5 grant asserts removed |
| `backend/src/services/photo-authz.service.ts` | rides same removal |
| tests | **deleted** `ops-expense-truck-scope` (78) + `ops-expense-write-scope-route` (119); **new** `ops-expense-cont-claimants-route.test.ts` (144); card197 / remediation / photo-scope updated |
| `frontend/src/features/ops/OpsExpenseFormModal.tsx/.containers.test` | claimants confirm dialog |

Quality: clean; matches accountant docx ("tất cả các Ops đều được điền chi phí") and
**wave C's TC-COSTUX-01/02 acceptance text verbatim**. Three-way overlap with wave A's
commit (§3, F1).

**G4 — Accountant batch entry + shipment-level (no-trip) expense**
`expense-accounting.ts` route +POST `/entries/batch` (all-or-nothing, row-numbered
errors, idempotency required); `expense-accounting-create.service.ts` +56
(`createShipmentLevelAccountingExpense`: tripId=null, road-never-charges-customer
invariant kept, payer assertions, SUPPLIER→company-style recording);
`expense-accounting-carriers.service.ts` NEW (46); `ExpenseCreateDrawer.tsx` 134 ln
continuous-entry ("không đóng sau khi lưu", running session); shared batch schema.
Overlaps wave C TC-04 (not yet coded).

**G5 — Tạm ứng PENDING approval (KP-148)**
`_enums.ts` +`PENDING` (additive text value, no migration needed — commented);
`advance-request.service.ts` +`options.pending` (PENDING born without approver/money);
`ops.ts` route passes `pending: true`; reconciliation/advance-draft adjusted; card197 /
remediation tests updated. **Same feature as wave A CPB-03** (A hasn't committed it yet).

**G6 — Hoàn ứng settle + chốt-debit screen**
`expense-accounting.ts` schema +`refund_settled_at/by`; `AccountingDebitClosePage`
+42 ln + columns + css (settle action + settled-by display); reads/write services.
Related-but-different from wave A CPB-04 (signed negative remainder + confirm checkbox)
and wave C TC-05 (UI-only restyle). Same screens, three angles.

**G7 — Port-zone surcharge catalog (Lạch Huyện giá nâng/hạ theo cảng)**
`catalog-crud.routes.ts` +CRUD (server-forced `kindSlug`, port-active + uniqueness
guards, governance label); `PortZoneSurchargesConfigPage.tsx` NEW (166);
`port-zone-surcharge-config.test.ts` NEW (182); shared schema/constants; ConfigPage +
searchRegistry registration. **Standalone — no fleet overlap.** Quality: good.

**G8 — Stragglers**
`idempotency.service.ts` (+2 endpoints), `ops-reconciliation-report.service.ts` (+4),
`OpsOrdersPage.test`, `ShipmentDetailPage`, `ExpenseAccountingWorkspace`,
`ExpenseCashDrawer/EntryDrawer` tests, `check-structure.mjs`, `qa-seed-factory.mjs`
(+26), `docs/argon-cost-ux-advisory-2026-10-14.md` (Gemini UX advisory — context, not
code), `frontend/public/brand/logistics-hero-van.png` (**orphan: referenced nowhere** —
U5), 3 migrations total (one per G1/G2/G3-schema).

### Quality assessment (Ghostty batch)

- Consistent house style: Vietnamese domain comments citing cards, `ApiError` +
  Vietnamese messages, `declareMaterialWrite` on every write, txn + lock discipline
  (`lockTripFinancialAuthority`, `for('update')`), audit rows on money writes.
- **Q1 — blocking:** the 3 new migration SQL files are hand-placed:
  `backend/drizzle/meta/_journal.json` is unmodified and the newest snapshot is
  2026-10-13. As-is, **drizzle's migrator will never run them** and schema↔snapshot
  drifts. Must be regenerated via drizzle-kit (or journal+snapshots completed) before
  any merge. `drizzle-safe-migrations` skill applies.
- **Q2:** 197 lines of scope tests deleted; replacement coverage exists
  (cont-claimants 144 + updated card197/remediation/photo/m84) but the truck-scope
  *rewrite* wave A committed becomes orphaned if G3's deletion wins (§3 F1).
- **Q3:** no `qa/` artifacts, no gate runs, nothing verified — entire batch is
  CODE-READ ONLY (rung 1). Backend tests were **not** run by this inventory
  (read-only mandate, live session checkout).
- **Q4:** destructive `payer_kind` wipe (U8) and orphan brand PNG (U5).

---

## 2. Fleet census (`paseo ls` + `git branch` + worktree reads)

| Branch / wave | Worktree | Commits (vs main) | Uncommitted in worktree | Tests status | Feature coverage |
|---|---|---|---|---|---|
| `fix/pre-qa-sweep` | money-deer | **none — already merged** (`ba790f13` is in main) | 1 stray script `frontend/pre-qa-sweep.mjs` | n/a | landed; stale ref to delete later (U7) |
| `fix/pre-qa-sweep-v2` | wise-jellyfish | none (tip = main HEAD) | none yet | agent started 23:42, nothing yet | unknown — wait |
| `fix/qa-new-batch-1014` | wicked-koala | **3**: qa1-007 create-form asterisks, qa2-004 inbox sort, qa2-008 sidebar titles-from-nav (base `ba790f13`, already in main → clean merge) | seed-purge fixtures 3 files +150 (in flight) + `scratch-census-probe.ts` (exclude, U6) | **committed UI-DRIVEN evidence** on branch: 14 screenshots, driver logs, API calls, persisted-state identity, 2 local driver scripts, testplan. Not re-run by me | layout/nav/inbox QA fixes — disjoint from cost work |
| A `fix/cost-permissions-bugs` | bold-hedgehog | **1 of 4** (`5c185fe1` CPB-01: `assertOpsExpenseAssignment`→`assertOpsLotCostPolicy`, role grants any live lot; keeps write-scope probe + 404 distinct) | none yet | commit cites **pre-existing base failures** (QA-AUDIT-PHOI-11 ×3, card197 road-fee) recorded in its testplan; no fresh gate artifacts | CPB-01 done; CPB-02 (form acts before lot loads), CPB-03 (PENDING approval), CPB-04 (signed hoàn ứng remainder) still to come — **all three collide with Ghostty G4/G5/G6** |
| B `feat/driver-cost-ux` | dreamy-eel | 0 (branch at main) | 4 files +325/−196 + NEW `components/costs/LotCostForm{.tsx,.css}` + testplan DCUX-01…05; **frontend-only** (per-row POSTs, per-row idempotency keys — no backend change) | none attributable (`qa/round18*` files are a **previous** task's leftovers — verified they cite `fix/round18-wave`) | two labelled tables, no người-chi/invoice fields, evidence-kind selector locked by catalog class, photo required, system Tiền đường/Lạch Huyện rows, continuous entry — **same docx requirements as Ghostty G2, same 3 files** |
| C `feat/cost-ux-accounting` | fearless-racoon (branch `fearless-racoon`; target branch doesn't exist) | 0 | **testplan only** (TC-COSTUX-01…05), no code yet | none | 01 scope removal + 02 claimants modal (= Ghostty G3), 03 compact phoi-phieu entry form, 04 continuous entry (= G4), 05 chốt-debit visual-only (= G6 surface) |
| D `feat/timesheet-hoancuoc` | mellow-llama (branch `mellow-llama`; target branch doesn't exist) | 0 | **29 entries**: full timesheet module (schema 68 / routes 121 / service 565 / grid tests 303 / grid page 214 / feature dir / client / casbin `timesheet` resource / nav catalog / App+Layout+routes) **+ hoàn cược**: reuses `deposit_refund_trackers` + `POST /api/accounting/deposits`, NEW `bill-suggestions` endpoint (RIGHT-4-digit match) + `deposit-bill-suggestions.service.ts` + Thêm-cược modal on DepositRefundTrackerPage; pre-code design doc as required | none attributable yet | timesheet grid (K/Q/Đ/L/N/P, tiers, rollup) + deposit tracker add-flow — **duplicates Ghostty's bill-digit-search endpoint** (different UI surface); additive overlaps in `App.tsx`, `keys.ts`, `_journal.json` (drizzle journal conflict with G-migrations!) |
| `feat/hero-illustration` | nice-shark (branch `nice-shark`; target branch doesn't exist) | 0 | `LoginPage.tsx` +3/−3 (proper `<picture>` swap, real alt text) + 4 assets (svg+webp, desktop+mobile) + `verify-hero.tmp.mjs` (scratch, U6) | none; visual change | login/landing illustration — **Ghostty's `brand/logistics-hero-van.png` is an unreferenced near-duplicate** |

---

## 3. Per-feature matrix & recommendation

| # | Feature (accountant docx / card) | Ghostty main | Fleet | Keep | Rationale |
|---|---|---|---|---|---|
| F1 | OPS khai chi phí mọi lô + cont-claimants warning | G3: grant deleted, endpoint → claimants, UI modal, tests | A CPB-01 committed (role-policy predicate, endpoint kept); C TC-01/02 planned (matches G3 exactly) | **Ghostty G3, landed after A** | A's commit is a correct *intermediate* (unblocks OPS today, fleet-first); G3 is the docx-end-state and C's own acceptance text. Sequence: land A → G3 supersedes (deletes endpoint + grant, adds claimants). A's rewritten truck-scope test then dies with the grant — expected, note in review. C re-scopes to verification of 01/02 + owns 03–05. |
| F2 | Driver cost entry (no payer, evidence kind, photo rule, 2 tables, continuous entry) | G2: frontend drafts-table **+ backend batch endpoint** (txn, idempotent replay, row errors) + shared `ExpenseEvidenceFields` | B: frontend-only rework, extracted `LotCostForm` base, per-row POSTs, strong 5-case testplan | **Ghostty G2 — but decide (U3)** | G2 is the fuller implementation (server-side all-or-nothing batch, shared evidence component) but unreviewed; B is smaller with the best testplan. Whichever loses, port its unique gain (B's `LotCostForm` base vs G2's batch endpoint) and adopt B's DCUX-01…05 as the QA script. Do **not** merge both. |
| F3 | Tạm ứng PENDING + approval | G5: enum+service+route done | A CPB-03 planned, not committed | **Whoever lands first; default G5** | Identical design (PENDING, approve endpoint, audit, RECORDED-gated funding). Second implementation is redundant — cut it during its branch's merge. |
| F4 | Hoàn ứng settle / chốt-debit | G6: settle action + fields + page rework | A CPB-04 (signed remainder + checkbox), C TC-05 (visual only) | **All three partially — needs U4-adjacent call** | G6 adds the settle *action*; CPB-04 fixes signed-remainder *math*; TC-05 is presentation only. They compose but touch the same page/tests. Merge order: A → C → G6 last, reconciling the page once. |
| F5 | Accountant batch/continuous entry | G4 done | C TC-04 planned | **Ghostty G4** | Already implemented + tested; C's case becomes acceptance. |
| F6 | Bill-digit search (Cược suggestion) | `bill-book-search.service` + shipments route (1–4 digit flexible) | D `bill-suggestions` + deposit route (strict last-4) | **ONE service — recommend Ghostty's, rewiring D's modal to it (U4-adjacent)** | Same lookup built twice on different routes. Keep one; semantics differ (flexible vs last-4) — pick per business preference; both small. |
| F7 | Timesheet grid + rollup | — | D only | **D** | No overlap. Watch `App.tsx`/`keys.ts`/`pageCatalog`/drizzle `_journal.json` additive conflicts. |
| F8 | Hoàn-cược tracker add-flow | — (G1 is the trip-level cược field, different surface) | D only | **D**, with F6 consolidation | G1 (phơi phiếu field) and D's tracker are complementary, not duplicates — verify in review that G1 doesn't double-write `deposit_refund_trackers` (it doesn't: G1 writes `trips` only). |
| F9 | Port-zone surcharge catalog | G7 only | — | **Ghostty G7** | Standalone. |
| F10 | Hero illustration | orphan PNG only | nice-shark wired set | **nice-shark; drop Ghostty's PNG (U5)** | nice-shark is wired, responsive, accessible; Ghostty's asset is referenced nowhere. |
| F11 | QA batch (asterisks, inbox sort, sidebar titles) | — | qa-new-batch-1014 | **qa-new-batch-1014 first** | Independent, evidenced, clean base. |

---

## 4. File-conflict map (will collide on merge)

| File | Ghostty | Fleet | Severity / resolution |
|---|---|---|---|
| `backend/src/services/expense-owner-scope.service.ts` | G3 deletes grant (−68) | A rewrote predicate (67 ln) | **High — three-way.** Ordered succession per F1; final state = G3. |
| `backend/src/routes/ops.ts` | G3+G5 rewrite region | A `5c185fe1` same region | **High.** Same succession; claimants endpoint + pending flag survive. |
| `backend/src/tests/ops-expense-truck-scope.test.ts` | G3 **deletes** | A **rewrote** (107 ln) | **High.** Final state: deleted (test dies with the grant). Record in review. |
| `backend/src/tests/expense-source-remediation.test.ts`, `card197-negative-cost-totals.test.ts` | G3/G5 updated | A updated | **High.** Keep G3/G5 versions (they test the end-state); re-run. |
| `backend/src/services/photo-authz.service.ts`, `ops-expenses.service.ts` | G3 | A | Medium — same succession. |
| `frontend/src/components/trip/ShipmentCostEntryForm.tsx/.css`, `frontend/src/features/driver/useDriverExpenseEntry.ts` | G2 (142/…) | B (280/59) | **High — pick one lineage (U3).** Files cannot be sensibly hand-merged. |
| `backend/src/routes/driver.ts`, `driver-fulfillment.service.ts`, `driverClient.ts` | G2 batch endpoint | B none (frontend-only) | Low if B loses; if B wins, decide whether G2's backend batch still lands. |
| `frontend/src/api/keys.ts`, `frontend/src/App.tsx` | G1/G4 wiring | D additive (+12/+6) | Low — additive; textual conflicts only. |
| `backend/drizzle/meta/_journal.json` | G-migrations **not** registered (Q1) | D modified (+7 entries) | **Medium — must sequence**: register Ghostty's via drizzle-kit *after* D lands, single journal. |
| `frontend/src/pages/accounting/AccountingDebitClosePage*` | G6 | C TC-05 (future) | Medium — reconcile once, G6 last. |
| `frontend/src/features/ops/OpsExpenseFormModal*` | G3 claimants UI | C TC-02 (future) | Low — same design; C verifies instead of reimplementing. |
| `frontend/src/features/accounting/PhoiPhieu*Dialogs` | G1 (8–9 ln each) | C TC-03 (future) | Low. |
| `scripts/qa-seed-factory.mjs` vs `backend/src/seed/*` | G8 | qa-batch uncommitted purge work | None — different files. |

---

## 5. Safe merge sequence (fleet first, Ghostty last)

**Gate 0 — preconditions.** All fleet agents stopped (re-run `paseo ls`); U1 answered
(Ghostty session finished); U2/U3 decided; this doc approved. Nothing below starts
before Gate 0.

1. **`fix/qa-new-batch-1014`** — let its agent finish the seed-purge commit (excluding
   `scratch-census-probe.ts`, U6), run affected gates, independent review, merge.
   Clean base (`ba790f13` already in main). Evidence already at rung 3 on branch.
2. **`feat/hero-illustration`** — commit `nice-shark`'s LoginPage + 4 assets (drop
   `verify-hero.tmp.mjs`, U6). Visual verify at 390/768/1440 per §3 of AGENTS.md.
3. **Wave D → branch `feat/timesheet-hoancuoc`** (create in `mellow-llama`) — commit
   the timesheet module + hoàn-cược flow as grouped commits; resolve additive
   `App.tsx`/`keys.ts` conflicts; run backend tests (303-line grid test) + full set
   (schema + RBAC/casbin changed → full §5 gate set); review; merge.
4. **Wave A — remaining commits CPB-02/03/04** (or skip 03 if G5 already landed in a
   prior step — see ordering note). A's branch merges next-to-cleanly against post-D
   main; F1 succession note applies *at step 7*, not here.
   *Ordering note:* if you accept the F1/F3 default (Ghostty end-state), the cheapest
   sequence is: land A's committed CPB-01 now, let A's agent **stop after CPB-02**,
   and let G5/G6 (steps 7) supersede CPB-03/04 — avoids writing code that's deleted
   one step later. Owner call (U2).
5. **Wave C — re-scope to TC-03/04/05 remainder** after checking what G3/G4 already
   cover; merge before Ghostty.
6. **Wave B — per U3.** If G2 wins: archive B's worktree diff as reference, adopt
   DCUX-01…05 as the QA script for G2's form, merge nothing from B. If B wins: merge
   B, and G2's frontend hunks are dropped at step 7 while its backend batch endpoint
   is decided separately.
7. **Ghostty last — new branch created *inside the main checkout*** (owner-authorized
   exception to trunk-only, per your instruction): with the working tree intact,
   `git switch -c feat/ghostty-cost-doc-20261014` from **post-fleet main**, then:
   a. Re-register the 3 migrations with drizzle-kit (journal + snapshots) — Q1.
   b. Commit in groups: schema+migrations / services / routes / frontend / tests /
      docs — **excluding** superseded hunks per the F-matrix (F1/F3/F4 outcomes),
      the orphan `brand/` PNG (U5), and nothing else.
   c. Full gate set (schema + financial + RBAC changed → all six §5 gates) + QA
      artifacts under `qa/`; independent code-reviewer pass; regression cases into
      `testplan/` (G1–G7 have none yet — B's DCUX and C's TC cases seed it).
   d. Merge only on green.
8. **Cleanup (needs your instruction, U7):** delete stale refs `fix/pre-qa-sweep`,
   `fix/pre-qa-sweep-v2`, and landed fleet branches; archive `money-deer`'s stray
   `pre-qa-sweep.mjs`. Never touch the shared stash stack.

Rollback: every step is an ordinary merge on trunk; revert (never reset) per §4.
The destructive `payer_kind` wipe (migration 104501) needs a DB backup before it ever
runs outside local (U8) — house rule: back up before any data change.

---

## 6. Decisions needed from you

- **U1 (blocking):** Is the Ghostty main-checkout session finished? A live writer
  invalidates this entire snapshot.
- **U2:** F1/F3 succession — land wave A's CPB-01 then let Ghostty supersede
  (recommended), or halt wave A after CPB-01 and make Ghostty carry CPB-03/04 too?
- **U3:** Driver cost form lineage — Ghostty G2 (backend batch, unreviewed) vs wave B
  (frontend-only, best testplan)? Default recommendation: G2 + adopt B's DCUX cases;
  port B's `LotCostForm` base only if G2's form lacks it.
- **U4:** Bill-digit search — one service (recommend Ghostty's, rewire D's modal);
  match semantics: flexible 1–4 digits vs strict last-4?
- **U5:** Confirm dropping Ghostty's orphan `brand/logistics-hero-van.png`.
- **U6:** Confirm excluding scratch files (`verify-hero.tmp.mjs`,
  `scratch-census-probe.ts`) from any commit.
- **U7:** Permission to delete stale branch refs after landing (§4 requires explicit
  direction).
- **U8:** Confirm the destructive `payer_kind` data wipe is intended beyond local, with
  a backup taken first.

## 7. Coverage honesty (per AGENTS.md §9)

| Claim | Rung | Evidence | Not covered |
|---|---|---|---|
| Main-checkout inventory (76 entries, diff summaries above) | CODE-READ ONLY | `git status`/`diff` reads, file heads | No gates run; no tests executed (read-only mandate, live session) |
| Fleet branch census | CODE-READ ONLY | `git log`/`show --stat`, worktree status, testplans, committed qa/evidence | qa-batch's rung-3 evidence is its agent's, not re-verified here; waves in-flight — numbers will drift |
| Ghostty code quality | CODE-READ ONLY | diff reads (services/routes/tests read substantially) | No compile, no test run, no UI drive — nothing in G1–G7 is verified behavior |
| Merge sequence | PLAN | this doc | Execution gated on U1–U3 + fleet completion |
