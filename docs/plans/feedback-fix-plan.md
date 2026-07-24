# TingTing Feedback Fix Plan — `feedback.docx` (v2, consensus-revised)

**Status:** ✅ CONSENSUS APPROVED (Architect APPROVE + Critic APPROVE) — pending user execution approval
**Source:** `/Users/dev/Downloads/feedback.docx` (Manager/Driver/Giao-nhận/Accountant)
**Cross-ref:** `.kilo/plans/feedback-fixes-vi.md` (other agent — user decisions + schemas adopted), `docs/plans/03-cong-no.md` (payables design — not re-designed here)
**Date:** 2026-06-16
**Scope:** Full roadmap

---

## 0. Headline findings
1. **~40% of "missing" AR/AP features already exist & work** (real-time aging, `POST /payments/receive` + `POST /payments/vendor`, per-customer/supplier statements + export, `DebtListPage`/`PayableListPage`). "Chưa có" mostly = "can't find it." → **verify-before-build**, don't rebuild.
2. Several **snapshot/FK infra already exists** but is bypassed: `trips.fuel_price_applied` (snapshot column) exists yet legacy zero-rows fall back to **live** price; `tripContainerId` FK exists on `tripPhotos`/`tripContainerSeals` but `tripExpenses` uses a loose `containerNumber` string.
3. The accountant's photo-upload blocker is a **wrong-endpoint** bug (`ExpenseEntryPage` POSTs `/upload` w/o required `trip_id`/`type` → 400), NOT a size/codec issue. HEIC *is* handled in code; the real runtime risk is a **deploy image whose libvips lacks HEIC**.
4. **User already decided** the open product questions (from `.kilo/plans/feedback-fixes-vi.md` §"Quyết định đã chốt") — adopted verbatim below; not re-litigated.

## RALPLAN-DR Summary
**Principles** — (1) Fix-all (no skips). (2) Verify-before-build, grading each "existing" feature **wired vs stub**. (3) Backend-correctness-first; append-only ledger; `round2dp`+`computeTripTotals`; VND no decimals. (4) **Snapshot point-in-time financials — never read live config on update** (B3 must NOT write back the live value). (5) Guard the **LOCKED-trip invariant**: locked trip totals are contractually fixed — never recompute.

**Decision Drivers** — (a) Accountant actively blocked; (b) manager-trust erosion; (c) scope realism (tire module = standalone epic).

**Options considered** — A=bugs only (rejected, leaves financial blockers); B=bugs+financial (minimum); **C=full roadmap (chosen)** with B3 promoted to its own gated phase and N1 extracted to its own epic.

---

## Phase 0a — Reproduce & Verify (NO code changes) 🔎
> Mandatory before any fix. Output: `qa/feedback-repro-log.md` (root cause + file:line per item).
- **Reproduce** the 5 hard bugs: A3.1 (upload→auto-complete), A3.2 (revenue lost on refresh), D1 (category/supplier missing), D2 (photo 400), D4 (fuel price retroactive). Per role via `e2e/helpers.py login_as(role_key)`.
- **Grade wired-vs-stub** for every Phase-1 "existing" feature: `FORWARDER_SETTLEMENT` (enum exists, **never posted** = stub), `COMMISSION` (absent), AR real-time refresh, record-payment, statements.
- **Verify `fuel_price_history` coverage** (`api-paths.ts:77`): does it contain rows pre-dating every `fuel_price_applied=0` trip? If NO → reconstruction impossible → fall back to "freeze legacy, never recompute" (avoids irreversible write entirely). **This gates the B3 approach.**

---

## Phase 0b — Stabilization bugs (fix-all, low-risk batch)
> Pure UI/label/validation bugs. One PR. No state-machine or financial writes.

| ID | Bug | Root cause (file:line) | Fix | Objective acceptance |
|----|-----|----------------------|-----|----------------------|
| **B1** | Photo upload 400 (accountant) | `ExpenseEntryPage.tsx:147` POSTs `/upload` w/o `trip_id`+`type`; `upload.ts:188-194` 400s | Add `POST /api/expenses/:id/receipt` (no trip_id/type); wrap `sharp` in try-catch→400 | Small jpg+HEIC upload→201; corrupt→400 w/ message. **CI gate: `npx sharp -i heic -o jpg` smoke test in Dockerfile/CI** |
| **B5** | Giao-nhận double container | `ForwarderTripDetailPage.tsx:62-74` redundant free-text `containerNumber`; `tripExpenses.containerNumber` loose varchar (`schema.ts:553`) | **Reuse existing `tripContainerId` FK pattern** (sister tables already have it): add nullable `tripExpenses.tripContainerId` FK + migration; auto-fill from clicked row; deprecate loose string; keep per-container voucher grouping | Click row→form pre-filled; voucher still grouped per container |
| **B6** | Voucher not chronological | `SettlementPrintPage.tsx:75` + `settlement-export.service.ts:52` iterate unsorted Map | Sort date keys ascending before iterate (FE+BE) | Rows ordered by transport date asc |
| **B7** | Category/supplier missing until refresh | `ExpenseEntryPage.tsx:78-92` `staleTime`+`enabled:!catalogsLoaded` | `queryClient.invalidateQueries` on create; **audit ALL `useCatalogs` consumers** | Quick-create supplier→dropdown updates, no refresh |
| **B8** | Driver salary "Tiền kết hợp" | `DriverTripDetailPage.tsx:209` label; `trip-mutations.service.ts:351` uses `/26` vs `attendance.service.ts:280` `standardWorkDays` | Rename "Lương phân bổ chuyến"; single divisor = `standardWorkDays` | Label correct; trip salary == attendance dailyRate×wageDays |

---

## Phase 1 — Fuel Snapshot Stabilization (B3 — gated, high-risk) 🔴
> Promoted out of Phase 0. Financially sensitive. NEVER write back the live value (violates Principle 4).

**Decision tree (gated by Phase 0a):**
- If `fuel_price_history` has full coverage → **temporal reconstruction**: `SELECT price FROM fuel_price_history WHERE effective_date <= trip.created_at ORDER BY effective_date DESC LIMIT 1`; write snapshot column only.
- If coverage incomplete → **freeze-and-never-recalc**: set snapshot to a sentinel, skip recalc for legacy rows, surface "chưa snapshot" tooltip (D4 UI).

**Hard rules:**
1. **LOCKED-trip invariant guard**: backfill writes `fuel_price_applied` ONLY; recalculation (`updateTripFigures` + `recalc-trip-figures.ts`) is **skipped for `status=LOCKED`** trips. If a locked trip's recomputed total would differ, post an `ADJUSTMENT` ledger entry — never silently rewrite a locked row.
2. **Recompute route through `computeTripTotals`** (precision guarantee).
3. **Dry-run gate**: `pnpm run backfill:fuel-price --dry-run` prints every affected trip + reconstructed price + before/after `totalFuelCost`. Requires sign-off before write.
4. **Reconcile-vs-locked-ledger**: after write, report diff of locked-trip totals vs their posted ledger entries; non-empty diff ⇒ abort.
5. **Reversibility**: toolchain (`drizzle-kit`) has no down-migrations — ship a **custom reverse SQL script** (`backfill:fuel-price:revert`) that restores prior `fuel_price_applied` from an audit table the backfill writes. "Reversible" is real only with this script.
6. **Internal ordering**: `backfill:fuel-price` writes the snapshot column ONLY; then `recalc-trip-figures` runs on **non-locked rows only**. Both npm scripts land in the **same PR** with matching entries in `backend/package.json`; dry-run flags on both.

**Acceptance (objective):** dry-run report reviewed+signed; locked-trip reconcile diff empty; post-write, changing today's price leaves all existing trips' fuel cost unchanged (tolerance 0 VND); legacy zero-rows now show a reconstructed/tooltip price, never live.

---

## Phase 2 — Trip completion + persistence (B2 + B4 — state-machine batch)
> Shipped **as one PR** with all three pieces (Architect requirement).

- **B2 auto-complete removal:** delete block `trip-mutations.service.ts:415-438`; add `POST /api/trips/:id/complete` that **explicitly calls `trip-status-machine.service.ts`** (`canTransition` + photo gate at `:123-135`) — do NOT re-implement the photo requirement. Manual "Hoàn thành" button.
  - **B2.a client 409 recovery:** on `PUT /:id/actuals` 409 (`expectedVersion` mismatch, `:222-225`/`:481-483`), surface "dữ liệu đã thay đổi — tải lại" + auto-refetch; never silent.
  - **B2.b admin force-complete tool:** model on existing approval-action pattern (e.g. `ADVANCE_SETTLEMENT_APPROVE`) — un-strands any trip stuck by the removal.
  - **Data migration:** trips auto-completed-but-unfinished (detection: photos/containers present but `completedAt` set during actuals-save) → reset to `IN_TRANSIT`.
- **B4 revenue "not persisting":** reproduce first (Phase 0a); leading hypothesis = silent 409 (now surfaced by B2.a). Also fix: salary auto-fill only when field **truly unset** (not `0`); revenue-decomposition precedence documented. Add **server log on 409** (observability).

**Acceptance:** A3.1 repro now: upload→stays IN_TRANSIT; button→COMPLETED. A3.2 repro now: revenue persists across refresh OR 409 is visible with reload prompt. Unit tests on `/complete` + status-machine reuse + fuel-snapshot-freeze.

---

## Phase 3 — Verify & Surface existing features (Tier-2, low build)
> Each item graded wired/stub in Phase 0a; only surface if wired, else build minimal.
- **V1 AR real-time (A8):** confirm `aging.service.ts` recomputes on each ledger post + FE invalidates debt queries; add **AR KPI card** (totalOutstanding, overdue) on Dashboard/Finance.
- **V2 Payables surfacing (A9):** add **filter chips** on `PayableListPage` (Fuel/Carrier/Ancillary/Commission); add `COMMISSION` txn type + posting (`pgEnum` ALTER migration). Reference `docs/plans/03-cong-no.md` — do not redesign.
- **V3 P&L check (A6):** hand-compute a sample trip set, diff vs `pnl.service.ts`; fix via `computeTripTotals` consistency only.

---

## Phase 4 — Financial Completion (Cluster F)
- **F1 Advance balance + per-container settlement (A11/C2/D3):** `getAdvanceBalance(forwarderId)=Σapproved advances−Σsettled` (computed inside advisory-lock path — `ledger.service.ts:57-60` — to avoid races); per-container breakdown via `settlementExpenses→trip_containers`; **post `FORWARDER_SETTLEMENT`** (currently never posted); **accountant view** showing requested/paid/remaining so settlements approvable (currently blind). Container-level settlement via new `container_advances`-style linkage (adapt schema from `.kilo` plan to real FK names).
- **F2 Driver income dashboard (B2):** extend `getDriverEarnings`+`computeSalary` to return road-allowance MTD, **advances paid** (from ledger, sign convention `credit−debit` per `ledger.service.ts:144-146`), unpaid balance. **5 cards, per user decision:** Lương CB / Lương SX / Tiền đi đường / Đã tạm ứng+đã thanh toán / **Còn lại = (CB+SX+Đường)−(Tạm ứng+Kỷ luật+Đã thanh toán)**.
- **F3 Profit per-vehicle (A7), per user decision:** **fixed % of gross profit per truck**; schema `trucks.partner_id` (FK→forwarders/partners, nullable) + `trucks.profit_share_pct` (decimal 5,2). **`blockedBy`: Phase-0a cap-table audit.** The existing `profit-distribution.service.ts` `distributeProfit` + `capTableHistory` may already cover per-truck share — so: **F3-UI surfacing** (show existing distribution per truck) proceeds regardless; the **F3-schema addition** (`profit_share_pct`) only proceeds if the audit proves the cap-table doesn't cover it. First disambiguate whether `% of gross profit per truck` = **operator/driver payout** (a cost stream) vs **investor equity distribution** (the existing cap-table) — these are different money paths; don't conflate. Prevents a second divergent distribution ledger.

---

## Phase 5 — New Modules (Cluster N)
- **N1 Tire management → OWN EPIC** `docs/plans/tire-management.md` (to be written; referenced not detailed here). Schemas from `.kilo` plan (`tires` w/ serial-unique, size, position, installed/removed, supplier, warranty, status enum) adapted to real `trucks`/`suppliers` FKs. New service+routes+`/fleet/:id/tires` UI. MVP = CRUD + grid + warranty/install alerts; defer "days-in-service" km math if no km data.
- **N2 Manager guidance (B1.3):** `trip_instructions` table (contact_name, contact_phone, notes) — manager writes, driver reads (`DriverTripDetailPage` section).
- **N3 Back-dating (A10.2):** add `expense_date` (occurrence) distinct from `recorded_at`; default occurrence=recorded date.
- **N4 Forwarder search + color status (C1):** `search`(container/customer)+`dateFrom/to` on `getForwarderTrips`+`/forwarder/me/trips`; color rows by `tripExpenses.approvalStatus`/`paymentStatus` (green/yellow/white).
- **N5 Warnings (A12/B4):** `vehicle_alerts` (oil/inspection/insurance, lead-days) + daily scan; warn on FleetPage + driver's vehicle. Reuse notification infra.
- **N6 Customer/Supplier drill-down (A13/A14):** surface AR/AP balance on detail pages.

---

## Cross-cutting requirements (apply to ALL phases) — added per Architect+Critic
- **RBAC (Casbin):** every new endpoint gets a policy — `trips/:id/complete`, `expenses/:id/receipt`, advance-balance, tire CRUD (MANAGER), trip-instructions (write=MANAGER/read=DRIVER), receivables reports (MANAGER+ACCOUNTANT), vehicle-alerts (MANAGER+DRIVER-self), driver-earnings (DRIVER-self+MANAGER+ACCOUNTANT).
- **Shared types + Zod:** update `shared/src/types` + `shared/src/schemas` for every schema/enum change (txn types, tire types, trip-instructions, container-advance, `truck.partner_id`/`profit_share_pct`).
- **Migration strategy:** toolchain is forward-only (no `.down.sql`). Each migration ships a **custom reverse SQL script**; irreversible financial writes (B3) additionally write an audit/restore table.
- **Data-backfill ordering graph:** B2 status-reset → B3 fuel backfill → F1 settlement posting → V2 COMMISSION enum. Document dependencies before execution.
- **Observability:** server log on every 409 (B4) and on B3 backfill writes; report endpoints for locked-trip reconcile + advance balance.
- **vantai re-seed:** update `deploy/seed-vantai.sql` per phase for new entities; tie to acceptance.

## Pre-mortem (3 failure scenarios) — deliberate mode
1. **B3 corrupts locked P&L**: backfill recomputes a locked trip → ledger totals no longer tie. *Mitigation:* LOCKED guard + reconcile gate (Phase 1 rule 1/4); abort on non-empty diff.
2. **B2 stale-tab 409 storm**: removing auto-complete strands every open tab. *Mitigation:* client 409 recovery + force-complete tool ship in same PR (Phase 2 B2.a/b).
3. **F2 sign-convention inverted**: "advances paid" shows negative. *Mitigation:* honor `credit−debit` for DRIVER entity; unit test the unpaid-balance formula.

## Expanded test plan (unit/integration/e2e/observability)
- **Unit:** `/complete` status-machine reuse; fuel-snapshot-freeze (locked vs not); `getAdvanceBalance`; unpaid-salary formula; tire replacement (sets removed_at+creates new).
- **Integration:** `customer_payments`/`PAYMENT_RECEIVED` → ledger balance decreases; snapshot unchanged when config price changes; forwarder balance with advance+settlement; upload 4xx on oversize/bad-content.
- **E2E:** rerun all feedback repros per role (`e2e/helpers.py login_as`); empty/loading/error/permission-denied/happy states on each new page.
- **Observability:** 409 logs; backfill dry-run + write logs; reconcile reports.
- **Performance:** `EXPLAIN ANALYZE` on 3 heaviest queries post-index (trips, receivables, tires).

## ADR
- **Decision:** phased full-roadmap; reproduce-first; B3 isolated + gated; tire module extracted; user-decisions adopted.
- **Drivers:** accountant blockers; trust erosion; incremental shipping.
- **Alternatives:** bugs-only (rejected); rebuild debt (rejected — exists); write-back-live-price for B3 (rejected — self-violates Principle 4).
- **Consequences:** multi-sprint; B3 + N1 need their own sub-plans/migrations; ledger integrity guarded throughout.
- **Follow-ups:** per-phase PRs; `/code-review` (max) before each merge; write `tire-management.md`; vantai re-seed.

## Verification (executable)
- `rtk tsc --noEmit` (3 CI tsc cmds) green; `make test` green; `pnpm build` green.
- `pnpm run backfill:fuel-price --dry-run` reviewed+signed; locked-trip reconcile report empty.
- vantai role-based repro: B1–B8 + A3.1/A3.2/D1/D2/D4 via `e2e/helpers.py login_as(role_key)`.
- Financial reconciliation: ledger balances tie before/after F1–F3 (report endpoint, tolerance ≤0.01 VND).
- `/code-review --max` before each phase merge.

## TASK_QUEUE.md (to be created) — Size/Priority
`Size`: S≤2h, M=2–8h, L≥1d. `Prio`: P0=blocker-bug, P1=core-feature, P2=nice-to-have.
- **P0:** B1, B4(+B2.a), B5, B6, B7, B8, B2(completion bundle), Phase-0a reproduce, B3 fuel gated. *(B3 is P0-urgency but gated/risky — its own PR.)*
- **P1:** V1/V2/V3, F1/F2/F3, N2/N3/N4/N5/N6, schemas (tires/alerts/instructions/container_advances), services, routes, RBAC, shared-types.
- **P2:** N1 tire epic (own plan), performance pass.

---

## Status Tracker — `feedback202606.docx` (verified 2026-06-17)

> Source: `docs/feedback202606.docx` (4 sections: A=Manager / B=Driver / C=Forwarder / D=Accountant).
> Status verified against codebase (wired vs stub), not just commit messages. Update this table as phases ship.

### ✅ Implemented (wired end-to-end)

| Doc item | ID | Key evidence (file:line) |
|---|---|---|
| A3.1 trip completion (no auto-complete) | B2 | `trips.ts:155`, `trip-status-machine.service.ts:71`, auto-complete block removed `trip-mutations.service.ts:519`, button `TripHeader.tsx:87` |
| A3.2 revenue-persist (409 surfaced) | B4 | `useTripFormDispatch.ts:684` retry-once + `TripEditPage.tsx:65` confirm |
| A8 record customer payment | — | `payments.routes.ts:17` → `financial.service.ts:26`; modal `DebtDetailPage.tsx:226` |
| A8 per-customer + consolidated AR reports | — | pre-existing: DebtListPage / statements / export |
| A12 fleet alerts (oil/inspection/insurance) | N5 | migration 0049; `computeVehicleAlerts` (`vehicleAlerts.ts:54`); badges `TruckFormModal.tsx:49` |
| B1.1 driver detail shows container + customer | — | `DriverTripDetailPage.tsx:143,170` |
| B1.2 driver salary label | B8 | relabeled "Lương phân bổ chuyến" (`DriverTripDetailPage.tsx:214`) |
| B1.3 manager→driver guidance | N2 | migration 0048; GET/PUT `trips.ts:351,357`; manager card + driver read `DriverTripDetailPage.tsx:237` |
| B4 driver registration/insurance reminder | N5 | `driver.ts:33`; strip `DriverEarningsPage.tsx:106`; excludes CANCELED+deleted `driver.service.ts:146` |
| C1.1 forwarder search (container/customer/date) | N4 | `forwarder.service.ts:112-132`; `ForwarderTripsPage.tsx:143` |
| C1.2 color-coded cost status | N4 | `forwarder.service.ts:152`; CSS `fwd-row--paid/--pending` (`ForwarderTripsPage.css:183`) |
| C3 voucher chronological order | B6 | ascending date sort FE+BE (`SettlementPrintPage.tsx:99`, `settlement-export.service.ts:66`) |
| D1 category/supplier missing-until-refresh | B7 | `invalidateQueries` (`ExpenseEntryPage.tsx:202,220`) |
| D1 photo upload error | B1 | `POST /:id/photos` no trip_id/type (`expense.ts:118`); sharp try-catch→400 (`:140`) |
| D3 fuel price retroactive | B3/D4 | `fuel_price_applied` snapshot (`schema.ts:239`); committed/locked skip recalc (`trip-mutations.service.ts:338`) |
| *(bonus)* multi-seal + per-container photos | — | `tripContainerSeals` (`schema.ts:537`); `tripPhotos.tripContainerId` |
| *(bonus)* Gemini OCR container/seal | — | `ocr.ts:34`, `ocr.service.ts` |

### ⚠️ Partial — real gaps to close

| Doc item | ID | What's done | What's missing |
|---|---|---|---|
| A8 AR real-time + KPI | V1 | cache invalidation (`DebtDetailPage.tsx:94,236`) | **no AR KPI card** — only attention text (`DashboardPage.tsx:259`) |
| C1.3 double-container removal | B5 | FK + dropdown (`schema.ts:588`, `ForwarderTripDetailPage.tsx:505`) | **no click-to-auto-fill** from container row |
| A6 P&L check | V3 | accurate | `pnl.service.ts` duplicates (doesn't call) `computeTripTotals` — fragile |
| A11 advance balance + per-container | F1 | `FORWARDER_SETTLEMENT` posts (`advance.service.ts:408`) | balance surfaces + container-level settlement not built |

### ❌ Not started / blocked

| Doc item | ID | Blocker |
|---|---|---|
| A7 profit-share per vehicle | F3 | cap-table audit / product disambiguation |
| A9 payables (fuel/carrier/commission) | V2/F1 | irreversible `COMMISSION` enum migration + sign-off |
| A10.2 back-dating | N3 | — (medium, no migration) |
| A10.3 tire management | N1 | own epic; plan doc `tire-management.md` not written |
| A13 customer → AR; A14 supplier → AP | N6 | — (medium) |
| B2 driver earnings 5-card | F2 | 3/5 cards; blocked on "advances paid" txn-type question |
| C2 / D2 forwarder advance settlement + accountant view | F1 | surfaces not built (no migration) |

### Next-up priority
1. **F2** driver earnings — resolve 1 product question, then build
2. **V2 + A9** payables — needs COMMISSION migration sign-off
3. **F1 surfaces** (A11, C2, D2) — balance read-out + accountant view, no migration
4. **B5** click-to-fill + **V1** AR KPI card — quick partial-fix closures
5. **N3, N6** — medium, no migration
6. **F3** profit per vehicle; **N1** tires (epic)
