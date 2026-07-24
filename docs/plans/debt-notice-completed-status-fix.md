# Plan — Fix empty "giấy báo nợ": bill COMPLETED + LOCKED trips (not LOCKED-only)

> **STATUS: ⏸️ PENDING APPROVAL** (ralplan consensus — Planner pass 2, post-Architect synthesis; Critic review next).
> Product rule confirmed by user (Pete), 2026-06-25: *"LOCKED is just an extra tool to prevent editing; for the ledger we should look at COMPLETED + LOCKED records."*

## 1. Problem — confirmed empirically (root cause found)

**Symptom:** `/debt/2` → click "Tạo giấy báo nợ" → modal opens with **0 rows / total 0**.

**Root cause (one predicate):** `backend/src/services/billingDocument.service.ts:57` filters
`eq(s.trips.status, 'LOCKED')`. Customer 2 (CÔNG TY TNHH TRÀ THU ĐAN) has **3 trips, all `COMPLETED`, zero `LOCKED`** → 0 rows.

**Why this is wrong — the statement ↔ debt-notice asymmetry:**
- Revenue posts to the customer AR ledger at **COMPLETED**: `LedgerService.postTripLock` fires on the `IN_TRANSIT → COMPLETED` transition (`trip-status-machine.service.ts:206-232`); confirmed by data (customer 2 has 3 `TRIP_REVENUE` rows = 66,900,000 ₫).
- The **statement (sao kê)** reads the ledger → correctly shows 66.9M debt.
- The **debt notice (giấy báo nợ)** filters `LOCKED` only → shows nothing.
- → A customer can owe 66.9M (per sao kê) yet receive a **blank** debt notice.

**DB-wide blast radius (verified):**

| status | trips | TRIP_REVENUE rows | billable? |
|---|---|---|---|
| CREATED | 2 | 0 | ✗ |
| IN_TRANSIT | 0 | 0 | ✗ |
| **COMPLETED** | **72** | **125** | **✓** |
| **LOCKED** | **6** | **6** | **✓** |
| CANCELED | 10 | 0 | ✗ |

Old `LOCKED`-only filter missed **72 of 78** billable trips (92%). Billable set = `{COMPLETED, LOCKED}` — exactly the user's rule.

**Sibling defects (same predicate, all verified):**
- `buildCarrierPaymentLines` (`billingDocument.service.ts:116`) — carrier AP (`EXTERNAL_CARRIER_COST`) also posts at COMPLETED (`postTripLock` §4) but the payment statement filters `LOCKED`.
- `backend/drizzle/0073_backfill_service_fee_ar.sql:31` — `WHERE t.status = 'LOCKED'` backfills chi hộ SERVICE_FEE AR for only 6 trips, missing 72 COMPLETED historical trips.

## 2. RALPLAN-DR summary

**Principles**
1. **The ledger is the single source of truth for "what the customer owes".** Any bill/notice must agree with ledger AR.
2. **The status predicate must match posting semantics.** Revenue/AP posts at COMPLETED → the bill must include COMPLETED.
3. **Surgical change** — touch only the billable-status predicate; do not refactor the builder.
4. **Append-only / idempotent** for any data backfill (no UPDATE/DELETE of ledger rows).

**Decision Drivers (top 3)**
1. Customer 2 (and 72 other COMPLETED-trip customers) cannot be billed today — blocks a core AR workflow.
2. Statement ↔ debt-notice reconciliation (the entire purpose of the chi hộ feature on this branch).
3. Minimal blast radius on a financial code path.

**Viable Options**
- **Option A (recommended): widen the predicate to `status IN (COMPLETED, LOCKED)`** in both builders + align migration 0073's WHERE + de-rig the reconciliation test. *Pros:* ~2-line core fix; matches user rule; reconciles notice with ledger. *Cons:* (none material — see pre-mortem #1, verified).
- **Option B: derive billable trips from the ledger** (`JOIN ledger WHERE txn_type='TRIP_REVENUE'`) instead of `trips.status`. *Pros:* structurally incapable of disagreeing with AR. *Cons:* bigger rewrite; duplicate trip↔ledger join; loses the clean `departureDate` range filter; higher regression risk on a financial path. The reconciliation argument for B collapses once the COMPLETED-edit ledger sync (pre-mortem #1) is verified — A already reconciles.
- *Invalidated:* "LOCKED-only" is the bug itself. "COMPLETED-only" drops the 6 LOCKED trips (whose revenue IS posted) → under-bills.

**Pre-mortem (4 scenarios)** — *deliberate mode (financial)*
1. *A COMPLETED trip is edited after being billed, changing revenue.* → **Verified (Architect-challenged, held):** the figure-edit path gates `if (tripStatus === COMPLETED)` and runs `postTripUnlock(OLD)` + `postTripLock(NEW)` (`trip-mutations.service.ts:672-712`), atomically reversing the original ledger rows and posting fresh `TRIP_REVENUE`/`SERVICE_FEE` at the new values. Edits are admitted only for non-LOCKED/non-CANCELED trips (`trip-mutations.service.ts:354`). So the ledger tracks `trips.revenue` for COMPLETED trips, and the debt notice (reads `trips.revenue`) reconciles with the statement (reads the ledger) **even after an edit**. A saved debt notice is an immutable snapshot; re-generating reflects the new revenue. ✓
2. *A LOCKED trip needs its figures changed.* → User must unlock first: `LOCKED→COMPLETED` (`trip-status-machine.service.ts:71-89`) does **not** touch the ledger; the subsequent edit fires the swap in #1; re-locking `COMPLETED→LOCKED` (`trip-status-machine.service.ts:103-137`) posts nothing. Ledger stays correct at every step. ✓
3. *Migration 0073 re-run double-posts.* → Idempotent `NOT EXISTS (... txn_type='SERVICE_FEE' AND txn_id=fee.id AND entity_type='CUSTOMER' AND entity_id=customer_id)` guard (`0073:36-47`) is composite-key correct; widening the WHERE only adds the missing COMPLETED candidates. ✓
4. *A billable trip must later be un-billed (disputed/canceled).* → `COMPLETED→CANCELED` is the real reversal path: `trip-status-machine.service.ts:166-188` calls `postTripUnlock`, zeroing the ledger, and the trip becomes `CANCELED` which the debt notice excludes. (`LOCKED→CANCELED` is blocked at `:145-147`.) No "hold/dispute" state exists today; adding one is out of scope. ✓

## 3. ADR

- **Decision:** Bill `COMPLETED + LOCKED` trips on customer debt notices and carrier payment statements; align the chi hộ backfill migration and the reconciliation test to the same set.
- **Drivers:** §1 asymmetry; user-confirmed rule; reconciliation goal.
- **Alternatives considered:** Option B (ledger-derived), LOCKED-only (status quo = bug), COMPLETED-only (drops LOCKED).
- **Why chosen:** Smallest correct fix; matches the user-confirmed rule; preserves the builder's `departureDate` range semantics; reconciles with the ledger (pre-mortem #1 verified — no new divergence introduced).
- **Consequences:** 72 previously-invisible COMPLETED trips become billable (intended). Customer AR already reflects them — **no going-forward ledger change** (`postTripLock` already fires at COMPLETED). Aging/DSO/top-overdue unchanged (already ledger-based). Vendor carrier statements widen identically and intentionally.
- **Follow-ups:** (1) Backfill 0073 must run staging/vantai → prod per the existing chi hộ plan §7. (2) Optionally extract `BILLABLE_TRIP_STATUSES` (Step 1). (3) Debt-notice default date-range UX is a separate, out-of-scope enhancement.

## 4. Implementation steps

**Step 1 — Shared constant (recommended).** `shared/src/constants/index.ts` next to the `TripStatus` enum (L1-7): add
```ts
/** Trip statuses whose revenue/AP has posted → billable on debt notices & payment statements. */
export const BILLABLE_TRIP_STATUSES = [TripStatus.COMPLETED, TripStatus.LOCKED] as const;
```

**Step 2 — Customer debt notice.** `backend/src/services/billingDocument.service.ts:57`:
replace `eq(s.trips.status, 'LOCKED')` → `inArray(s.trips.status, [...BILLABLE_TRIP_STATUSES])`.
(`inArray` is already imported on line 3.)

**Step 3 — Carrier payment statement (same bug).** `buildCarrierPaymentLines` line 116: identical change.

**Step 4 — Backfill migration 0073.** `backend/drizzle/0073_backfill_service_fee_ar.sql:31`:
`WHERE t.status = 'LOCKED'` → `WHERE t.status IN ('COMPLETED', 'LOCKED')`; update the header comment. (File is untracked / not yet applied to prod → free edit. Idempotent guard handles re-runs.) **Order matters:** widen the WHERE *before* first applying — do not run the LOCKED-only version first, or the `NOT EXISTS` guard will freeze those rows out and a later re-run won't revisit them. After widening, a re-run inserts exactly the new COMPLETED candidates; a second re-run inserts 0.

**Step 5 — De-rig the test + add real regression guards.** `backend/src/tests/chiho-reconciliation.test.ts`:
- Helper `createLockedTripWithFees` forces `COMPLETED → LOCKED` (lines 148–150) *because* of the bug. Add a sibling helper / `{ lock?: boolean }` param that leaves the trip **COMPLETED**, and assert its draft surfaces freight + phí chi hộ lines. (Direct guard for customer 2's scenario.)
- Add an **edited-COMPLETED reconciliation test**: create a COMPLETED trip, edit its revenue via the figure-update path, then assert `draft.totalInclVat == Σ(TRIP_REVENUE + SERVICE_FEE) == new revenue + sell fees`. Locks down pre-mortem #1 as an invariant.
- Add a **carrier-payment regression test** mirroring the debit-note COMPLETED-only case (`generateDraft({type:'PAYMENT_STATEMENT', entityType:'CUSTOMER', entityId:<carrier>})` surfaces the external-freight line for a COMPLETED trip). Step 3 has no coverage otherwise.
- Add: a **CANCELED trip is excluded**.
- Keep the existing LOCKED cases (LOCKED must remain billable — no regression).

**Step 6 — Verify.**
- `cd backend && pnpm exec tsc --noEmit`
- `cd backend && npm test` (PG is up). New COMPLETED-only, edited-COMPLETED, carrier, mixed-status, and CANCELED tests must pass; existing reconciliation still passes. *(Runner note: `chiho-reconciliation.test.ts` uses `node:test`, not Vitest — confirm the backend runner config picks it up; run `pnpm db:migrate` first if migrations are pending.)*
- `pnpm --filter shared build` (Step 1 added a constant).
- Manual repro: backend + frontend up → `/debt/2` → "Tạo giấy báo nợ" → expect **3 freight rows, total = 66,900,000 ₫** (frontend dev port **7173**).

## 5. Acceptance criteria (testable)
1. `generateDraft({type:'DEBIT_NOTE', entityType:'CUSTOMER', entityId:2, rangeFrom:'2026-06-01', rangeTo:'2026-06-30'})` → **3 lines, totalInclVat = 66,900,000**.
2. A purely COMPLETED trip (never LOCKED) appears on its customer's debt notice.
3. A LOCKED trip still appears (no regression).
4. A CANCELED trip never appears.
5. Reconciliation passes for COMPLETED-only trips: `Σ(TRIP_REVENUE + SERVICE_FEE debits) == draft.totalInclVat`.
6. **Edited-COMPLETED reconciliation:** after a figure edit, `draft.totalInclVat == ledger AR == new revenue + sell fees` (pre-mortem #1 invariant).
7. **Carrier payment:** a COMPLETED external-carrier trip surfaces its freight line on the carrier's payment statement.
8. **Migration 0073 idempotency:** before run, candidate count == (COMPLETED+LOCKED trips with APPROVED sell-side fees and no prior SERVICE_FEE row); a dry re-run after applying inserts **0** rows (true idempotency, not just fewer rows).
9. **Mixed-status draft:** for one customer with both a COMPLETED trip and a LOCKED trip in range, `generateDraft` surfaces **both** (locks the `IN (COMPLETED, LOCKED)` set semantics directly — the actual production state for most customers).

## 6. Risks & mitigations
| Risk | Severity | Mitigation |
|---|---|---|
| COMPLETED trip edited after billing | LOW (verified non-issue) | Unlock+relock swap at `trip-mutations.service.ts:672-712` keeps ledger in sync; acceptance #6 locks it as an invariant. |
| Backfill double-post on re-run | LOW | Composite-key `NOT EXISTS` guard; acceptance #8 asserts true idempotency. |
| Carrier payment statement behavior change | LOW | Same semantic (AP posts at COMPLETED); widen is intentional; acceptance #7 covers it. |
| Test encoded the bug as a requirement | MED | Step 5 replaces the rig with COMPLETED-only + edited-COMPLETED + carrier + CANCELED guards. |

## 7. Out of scope (with guardrails)
- Debt-notice default date-range UX — customer 2's trips are June (= current-month default) so the reported symptom is fully resolved by the status fix; other customers' older debt uses the existing range picker.
- Approval-time chi hộ posting gap (deferred to Pete; observations 36745/36754/36755).
- Prod deploy of migrations (owned by the existing chi hộ plan §7).
- **`pnl.service.ts` (~L290) and `profit-distribution.service.ts` (~L190) also filter `status='LOCKED'` — these are correct and MUST NOT be widened.** P&L / profit distribution are spec-defined as LOCKED-only (`grossProfit` is finalized at the "chốt" lock; per memory `spec-compliance-audit-2026-06-18`). That is a *distinct* concept from AR billing: AR is owed at completion, profit is distributed at lock. Do not pattern-match this fix onto them.

## 8. Architect-review synthesis (Planner pass 2)
Verdict received: **APPROVE WITH CHANGES**. Disposition:
- **Accepted:** (a) add carrier-payment regression test (Step 5 + acceptance #7); (b) strengthen migration 0073 idempotency acceptance (#8); (c) document why `pnl`/`profit-distribution` LOCKED filters are spec-correct and must not be widened (§7); (d) make `COMPLETED→CANCELED` the explicit safety net (pre-mortem #4); (e) place `BILLABLE_TRIP_STATUSES` next to `TripStatus`.
- **Rejected (with evidence):** the Architect's headline objection "Tension A — editing a COMPLETED trip leaves the ledger stale forever; Option A creates notice↔statement divergence; rewrite pre-mortem #1." This is **falsified** by `trip-mutations.service.ts:672-712`, which runs `postTripUnlock(OLD)` + `postTripLock(NEW)` on every COMPLETED figure edit (gate confirmed reachable via the `LOCKED||CANCELED`-only block at `:354`). The ledger tracks `trips.revenue` for COMPLETED trips; pre-mortem #1 holds and is now cited precisely. Option A remains correct; Option B is unnecessary. A defensive edited-COMPLETED reconciliation test (acceptance #6) is added so this property cannot silently regress.
