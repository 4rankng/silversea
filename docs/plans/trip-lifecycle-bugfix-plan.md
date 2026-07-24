# Trip Lifecycle Bugfix Plan — Complete 500 / Lock Photo Gate / Revenue Override

> **Status: `pending approval`** (Critic APPROVED) — produced by `/ralplan` consensus over 2 iterations (Planner → Architect ITERATE → revise → Critic ITERATE → revise → Critic APPROVE). All evidence verified against source.
> No `--interactive` flag was passed: this plan is **not** auto-executed. Approve before any implementation.
> Date: 2026-06-28. Owner: backend (ledger + status machine) + shared (schemas) + small frontend change (lock `confirmNoPhoto`).

---

## 0. RALPLAN-DR Summary

### Principles (5)
1. **Evidence before fix.** Bug 1's exact runtime root cause is not yet pinned by static analysis; we reproduce and capture the real error before coding the fix (systematic-debugging).
2. **Fail loud, never silent.** A malformed ancillary fee must produce a clear, actionable domain error — not a one-sided ledger entry and not an opaque 500.
3. **Surgical changes.** Touch only the completion/lock/expense-validation paths. No schema migrations, no new tables, no raw IDs in UI.
4. **Preserve proven contracts.** The revenue split-override contract is intentional and covered by 125 lines of tests; we harden the footgun without changing the happy-path semantics.
5. **Lock is the last financial gate.** If evidence is required anywhere, lock (chốt — final close) is the correct place; completion stays permissive per Pete's B2 decision (2026-06-18).

### Decision Drivers (top 3)
1. **Financial correctness.** The ledger is append-only and feeds debt notices, P&L, and statements; a one-sided chi hộ entry is a real money bug, not a cosmetic one.
2. **Product-decision sensitivity.** Finding 2 (photo gate) and Finding 3 (revenue contract) intersect explicit prior Pete decisions (B2 permissive completion; A3 §9 split contract). These need sign-off, not silent implementation.
3. **Regression safety.** The completion/ledger path has multiple call sites (`transitionTripStatus`, `trip-mutations.service.ts` relock); any fix must be verified at every call site and covered by a regression test.

### Viable Options (per finding)

**Finding 1 (Complete 500 + chi hộ ledger):**
- **Option A (Recommended): Diagnose → harden both sides + symmetric validation.** (1) Reproduce & capture the real error; (2) make null-counterparty APPROVED fees a loud `ApiError` on BOTH buy and sell sides of `postTripLock`/`postTripUnlock`; (3) add symmetric Zod refine so `FORWARDER_ADVANCE` requires `forwarderId` and `COMPANY_DIRECT` requires `supplierId`; (4) regression test.
- **Option B: Patch only the 500 symptom.** Narrow fix once the stack trace is known. *Rejected:* leaves the one-sided-ledger correctness bug and the malformed-fee enabler in place; the same class of bug recurs.
- **Option C: Block accountant auto-approve entirely.** Force all expenses through forwarder PENDING. *Rejected:* breaks the legitimate accountant-direct entry flow (`forwarder.service.ts:105`).

**Finding 2 (Lock photo gate):**
- **Option L1 (Recommended): Soft photo gate at lock, mirroring `confirmZeroRevenue`.** Baseline ≥1 photo of any type; admin override via `confirmNoPhoto`; stricter CONTAINER+SEAL tier when `cargo_types.requires_photos = true`. Preserves B2 permissive completion.
- **Option L2: Hard gate, no override.** Strictest; risks blocking legitimate ops (e.g. legacy trips).
- **Option L3: Docs-only.** Update `DELIVERY_TRIP_LIFECYCLE.md` to remove stale "photos required at completion" language; no code. Loses the evidence guarantee the user is asking for.
- *Invalidation rationale:* The user's report asserts lock should require photos; L3 contradicts that. L2's rigidity conflicts with the existing soft-guard pattern (`confirmZeroRevenue`) and B2's "don't block the user" spirit. L1 is the only option consistent with both the user's intent and prior product decisions.

**Finding 3 (Revenue override footgun):**
- **Option R1 (Recommended): Schema-level ambiguity guard.** `.refine()` on `updateTripFiguresSchema` rejecting payloads where `revenue` AND a split are both present → clear 422. Frontend unaffected (it omits `revenue` when sending splits).
- **Option R2: Docs only.** Document precedence in API/OpenAPI docs. No behavior change. Lighter, but does not prevent the silent zero-out for direct API callers.
- *Invalidation rationale:* The user already flagged this as a footgun for API callers; docs alone (R2) does not convert the silent failure into an actionable error. R1 is the minimal strict improvement. (Behavior-change option — treating `0` as absent — is rejected: it breaks the pinned "explicit-zero-zeros-revenue" contract, `revenue-persistence.test.ts:54-59`.)

---

## 1. Finding 1 — `POST /api/trips/:id/complete` → 500 with an approved ancillary expense

### 1.1 Evidence (verified this session)
- **Route:** `backend/src/routes/trips.ts:164-195` → `tripService.transitionTripStatus(id, COMPLETED, ...)`.
- **Completion ledger branch:** `backend/src/services/trip-status-machine.service.ts:206-232` — selects **all** `tripExpenses` for the trip **unfiltered** (`eq(tripId)`), maps each to `ancillaryFees`, calls `LedgerService.postTripLock`.
- **`postTripLock`:** `backend/src/services/ledger.service.ts:167-284`.
  - §5 buy side (232-261): both branches FK-guarded (`fee.supplierId` / `fee.forwarderId`).
  - §6 sell side (270-283): **no FK guard** — posts `SERVICE_FEE` AR to the customer whenever `sellAmount > 0`.
- **Expense schema:** `backend/src/db/schema.ts:759-787` — `forwarderId`, `supplierId` **nullable**; `approvalStatus` defaults `APPROVED`; `settlementMethod` defaults `FORWARDER_ADVANCE`.
- **Auto-approve enabler:** `backend/src/services/forwarder.service.ts:105` — `forwarderId == null ? 'APPROVED' : 'PENDING'`. So an accountant-created expense is `forwarderId=null` AND `APPROVED`.
- **Asymmetric Zod:** `shared/src/schemas/index.ts` requires `supplierId` for `COMPANY_DIRECT` but **nothing** for `FORWARDER_ADVANCE`.
- **Hypotheses ruled out this session (verified, not assumed):** (a) `SERVICE_FEE` missing from the enum — **migrated** in `drizzle/0072_safe_quasimodo.sql`; (b) unique-constraint collision on `(txn_type, txn_id)` — **no such constraint** exists (only non-unique indexes); (c) null-FK dereference in TS — **all paths guard**; (d) **DB-level CHECK constraint or trigger on `ledger`** — the table DDL (`drizzle/0000_flat_doctor_spectrum.sql` ledger block) has **only columns/defaults/NOT NULL**, no CHECK and no trigger (the sole grep hit for "trigger" is a prose comment in `0062`). So CHECK/trigger is **near-zero probability** and must NOT be sent as the primary diagnostic lead.

### 1.2 Root-cause status
Static analysis has **eliminated the obvious in-code throws AND the obvious DB-level throws** (enum, unique constraint, CHECK, trigger — all ruled out above). The exact 500 trigger is therefore one of the remaining realistic candidates (to be confirmed by the captured stack trace, NOT guessed):
1. A **NOT-NULL / FK / type violation on a `ledger` column** for the specific fee's insert (e.g. a value shape the `numeric(15,0)` column rejects, or a column added by a later migration that the `postEntry` insert doesn't populate for the SERVICE_FEE path).
2. A **numeric/precision failure** — `postEntry` computes `newBalance` from `Number(lastEntry.balance)` then inserts `String(newBalance)`; a malformed source value could surface here.
3. A **concurrent-transition interaction** on the `postEntry` read-then-write (`select … order by id desc limit 1` → `newBalance` → `insert`), though the per-entity advisory lock (`lockEntity` at `ledger.service.ts:127`) normally serializes this.

The diagnostic gate (1.4 step 1) captures the truth; **do not rank-order these as if one is proven.** Principle 1 controls: no code fix lands until the real error is reproduced.

### 1.3 Confirmed code-level defects (fix regardless of 500 trigger)
- **D1 — One-sided ledger (correctness).** An APPROVED fee with no valid counterparty (`COMPANY_DIRECT` w/o supplier, or `FORWARDER_ADVANCE` w/o forwarder) is **silently skipped on the buy side** (§5) but **posted on the sell side** (§6) → the customer is billed for a chi hộ fee while the company's cost is never recorded. Unbalances the books; feeds wrong numbers into debt notices / P&L.
- **D2 — Asymmetric validation (enabler).** `FORWARDER_ADVANCE` has no `forwarderId` requirement, so the malformed fee can be created.
- **D3 — Test gap (narrow, not zero).** `backend/src/tests/ledger.service.chiho.test.ts` already exercises the §5/§6 `postTripLock`/`postTripUnlock` paths end-to-end against real Postgres — balanced FORWARDER_ADVANCE + COMPANY_DIRECT fees, sell-side SERVICE_FEE assertions, zero-sell and PENDING cases, and reversal at unlock. **BUT** every test fee defaults to a *real* counterparty (`fee.forwarderId ?? forwarderId!` / `fee.supplierId ?? supplierId!` at test line 124/129). The **null-counterparty (malformed) branch is never exercised** — that is the gap. (`trip-ledger-completion.test.ts` covers only TRIP_REVENUE / DRIVER_SALARY / FUEL_EXPENSE postings, not chi hộ.) Fix = **extend** `ledger.service.chiho.test.ts`, not create a new file.

### 1.4 Fix (Option A — revised per Architect review)
> **Change of frame (Architect):** the null-counterparty check must live in **ONE helper** and behave **differently per call site**. A blanket "throw on null-counterparty fee" is correct at completion (gate of origin) but is a **hard regression on the `updateTripFigures` relock path** (`trip-mutations.service.ts:683-711`), which runs `postTripUnlock`+`postTripLock` on every figures edit of a COMPLETED trip — throwing there blocks editing fuel/salary/legs/notes on any trip carrying a legacy bad fee.

1. **Diagnose (gate):** Reproduce trip-81's scenario locally (APPROVED ancillary fee → `POST /complete`). Capture the exact stack trace / PG error code (e.g. `23502` not-null, `23503` FK, `22P02` invalid numeric). Inspect expense 425's actual column values (`settlementMethod`, `supplierId`, `forwarderId`, `buyAmount`, `sellAmount`). NOTE: CHECK/trigger is already ruled out (§1.1d) — do NOT spend time hunting for one; the realistic leads are NOT-NULL/FK/type or numeric-precision (§1.2). Record the finding before proceeding.
2. **D1 fix — one `validateAncillaryFees(fees, { strict })` helper, two call-site behaviors.** Add a single guard (new, inside `LedgerService`) invoked **once at the top of `postTripLock`** (`ledger.service.ts:175`, right after `collectTripEntities`) **and once at the top of `postTripUnlock`** (`:299`) — NOT four inline checks across §5/§6. It scans APPROVED fees with `buyAmount > 0` whose settlement has no valid counterparty (`COMPANY_DIRECT` w/o `supplierId`, or `FORWARDER_ADVANCE` w/o `forwarderId`):
   - **`strict: true` (completion; cancel-from-completed throws too):** throw `new ApiError(422, 'Phí chi hộ #<id> đã duyệt nhưng chưa có đối tác thanh toán (nhà cung cấp / forwarder).')` *before any ledger row is written*. Surfaces the bug at the gate of origin; transaction rolls back cleanly (single outer `db.transaction` at `trip-status-machine.service.ts:21`).
   - **`strict: false` (relock on `updateTripFigures`, `trip-mutations.service.ts:683-711`; also `postTripUnlock` on CANCEL-from-COMPLETED, `:167`):** do **not** throw. **Skip the offending fee entirely — post NEITHER its buy-side entry NOR its sell-side SERVICE_FEE entry** (so no one-sided ledger is created), log a structured warning, and return the skipped fee IDs so the caller can surface a **non-blocking** UI warning. The unrelated figures edit (revenue/legs/salary) persists.
   - The completion call site (`trip-status-machine.service.ts:210`) passes `strict: true`; the relock and cancel-unlock call sites pass `strict: false`.
3. **D1-precondition — legacy data plan (concrete, not "tracked").** Existing prod rows created via the `forwarderId == null → APPROVED` enabler (`forwarder.service.ts:105`) will hit the new guard. Because the relock path is non-strict (skips+logs), legacy data **degrades gracefully** (no hard regression) — but the fees remain unfixed and silently omitted from the ledger on every relock until backfilled. Detection query (run on prod, file the result as a ticket):
   ```sql
   SELECT id, trip_id, settlement_method, supplier_id, forwarder_id, buy_amount, sell_amount
   FROM trip_expenses
   WHERE approval_status = 'APPROVED' AND buy_amount > 0
     AND ((settlement_method = 'COMPANY_DIRECT' AND supplier_id IS NULL)
       OR (settlement_method = 'FORWARDER_ADVANCE' AND forwarder_id IS NULL));
   ```
   Each hit must be reconciled (attach a counterparty, or re-classify to `COMPANY_DIRECT` + supplier) before the non-strict skip-and-log path is considered retired. This is a **follow-up with an owner + the SQL above + the retire-when-empty criterion**, not a vague "tracked" item.
4. **D2 fix — symmetric Zod refine (the enabler).** In `shared/src/schemas/index.ts` expense schema: add `.refine()` requiring `forwarderId` when `settlementMethod === 'FORWARDER_ADVANCE'` (mirrors the existing `COMPANY_DIRECT`/`supplierId` check). Prevents NEW bad rows at the door. Reconcile the accountant auto-approve path (`forwarder.service.ts:105`): an accountant creating a `FORWARDER_ADVANCE` fee must now supply a forwarder, or pick `COMPANY_DIRECT` + supplier. Verify the expense-creation UI still works (see Risks).
5. **D3 fix — extend `backend/src/tests/ledger.service.chiho.test.ts`** (do NOT create a new file — it already covers the balanced §5/§6 path). Add cases for the null-counterparty branch, asserting against `validateAncillaryFees` + the full `transitionTripStatus` flow: (a) balanced APPROVED fee, `strict:true` → no throw, buy+sell both posted, ledger nets; (b) null-counterparty APPROVED fee, `strict:true` → throws the clear 422, **no** ledger row inserted for that fee; (c) same bad fee, `strict:false` → no throw, **fee skipped entirely** (neither buy nor sell posted), skipped IDs returned, unrelated entries still post; (d) `postTripUnlock` mirrors (non-strict on cancel-from-completed returns skipped IDs, strict on relock-from-clean posts normally).
6. **Rebuild shared** (`shared` is read from `dist/` by the backend) and run `cd backend && npm test`.

### 1.5 Acceptance criteria (testable)
- AC1: `POST /api/trips/81/complete` with the exact expense-425 shape returns either 200 (balanced) or a **domain 422** with a Vietnamese message — never a bare 500.
- AC2: A balanced APPROVED ancillary fee produces **both** a buy-side entry (VENDOR or FORWARDER) **and** a sell-side `SERVICE_FEE` entry; the two sides reconcile.
- AC3: A null-counterparty APPROVED fee is rejected at creation (Zod 422) **and** — if one already exists in the DB — at completion (domain 422), with **zero** ledger rows inserted for that fee.
- AC4: `postTripUnlock` inherits the same helper and the same strict/non-strict split (no one-sided reversal on any path).
- **AC13 (relock regression — the Architect landmine):** `updateTripFigures` on a COMPLETED trip carrying a legacy null-counterparty APPROVED fee (a) **succeeds** in non-strict mode — the figures edit (revenue/legs/salary) persists, the bad fee's ledger line is skipped on both sides, a warning is logged, and skipped fee IDs are surfaced; (b) in strict mode (after the fee is fixed/backfilled) posts both sides normally. The edit is never blocked by a sibling fee's data-quality issue.
- **AC14 (cancel-from-completed):** Canceling a COMPLETED trip that carries a null-counterparty APPROVED fee (`postTripUnlock`, `strict:false`) succeeds — the trip moves to CANCELED, the bad fee is skipped entirely, and skipped IDs are returned (no throw, no stranded transaction).
- **AC15 (collectTripEntities invariant):** When `validateAncillaryFees` skips a null-counterparty fee, `collectTripEntities` (`ledger.service.ts:106-117`) does NOT attempt to lock an entity for it — the same `&& fee.supplierId` / `&& fee.forwarderId` guards apply, so no dangling advisory-lock attempt occurs.
- AC5: `cd backend && npm test` green; `pnpm exec tsc --noEmit` exit 0 (backend) + shared rebuilt.

---

## 2. Finding 2 — `POST /api/trips/:id/lock` permits locking with zero photos

### 2.1 Evidence (verified)
- **Route:** `backend/src/routes/trips.ts:197-217` → `transitionTripStatus(..., LOCKED, ...)`.
- **Lock branch:** `trip-status-machine.service.ts:103-137` — checks role, prior status (`COMPLETED`), and a zero-revenue soft guard. **No photo check** (confirmed by grep: zero `tripPhotos`/`requiresPhotos`/`count` hits in the status-machine service).
- **Photo schema:** `trip_photos` table (`schema.ts:905-921`) with `type ∈ {CONTAINER, SEAL, OTHER}`. Cargo-type-driven stricter rule flag: `cargo_types.requires_photos` (`schema.ts:198-205`).
- **No `countTripPhotos(tripId)` helper exists** — photos are only queried inline (`trip-queries.service.ts:382`, `forwarder-trip-query.service.ts:92`).
- **Documented rule vs. code:** `docs/flows/DELIVERY_TRIP_LIFECYCLE.md:132-136, 425-428` place the photo requirement at **completion** (≥1 any type; if `requires_photos` then ≥1 CONTAINER **and** ≥1 SEAL). Pete's **B2 decision (2026-06-18)** deliberately removed that completion gate (`trip-status-machine.service.ts:97-102`, `trips.ts:160-163`). Result: **no lifecycle step currently enforces photos**.

### 2.2 Product-decision tension (needs Pete's sign-off — see ADR)
B2 made **completion** permissive so photos can be added later. The user now asks that **lock** require photos. These are *consistent* (lock is a stronger state than completion), but the stricter cargo-type tier and the override semantics are product decisions not yet recorded for lock.

### 2.3 Fix (Option L1 — recommended, pending product sign-off)
1. Add a `countTripPhotos(tripId): Promise<{any: number; container: number; seal: number}>` helper (new, in `trip-queries.service.ts` or a small `trip-photos.service.ts`).
2. **Cargo-type lookup scope (Architect required):** the lock branch (`trip-status-machine.service.ts:103-137`) does not currently load `cargo_types`. Add **one** indexed fetch — `SELECT requires_photos FROM cargo_types WHERE id = trip.cargoTypeId` (join off the trip loaded earlier in `transitionTripStatus`) — scoped to the lock branch only. Do NOT add it to the generic transition path. Cache is unnecessary (lock is low-frequency).
3. In the lock branch (after the zero-revenue guard), add a photo gate mirroring `confirmZeroRevenue`. The rule is a **conjunction** (not if/else):
   - **Baseline (always):** require `count.any >= 1`. If `count.any === 0` and `confirmNoPhoto !== true` → `throw new ApiError(422, 'Chưa có ảnh bằng chứng. Vui lòng tải lên ít nhất 1 ảnh hoặc xác nhận chốt không ảnh.')`.
   - **Stricter tier (only when `requires_photos === true`):** ADDITIONALLY require `count.container >= 1 && count.seal >= 1` (so a `requires_photos` cargo needs ≥1 photo AND ≥1 CONTAINER AND ≥1 SEAL). Same `confirmNoPhoto` override, separate message listing the missing types.
   - **`requires_photos IS NULL` or `false`:** baseline ≥1-any-photo rule only (the column is `boolean('requires_photos').default(false)` — no `.notNull()`, so handle null as false).
4. **Confirm-flag threading (Architect Rec 4 — non-breaking choice).** The existing `transitionTripStatus` signature is `(tripId, targetStatus, userId, userRole, confirmZeroRevenue?)` — **5 params; `confirmZeroRevenue` is the 5th** (`trip-status-machine.service.ts:11-17`). **Decision: add `confirmNoPhoto?` as the 6th positional arg** (consistent with the existing pattern; non-breaking to the `POST /lock` body, which simply reads `req.body.confirmNoPhoto === true`). A cleaner `confirm: { zeroRevenue?, noPhoto? }` envelope is **deferred** to avoid a breaking change — recorded in the ADR.
   - **Frontend plumbing (in scope, small):** the server defaults `confirmNoPhoto = false`, but for the admin override to be *reachable* from the UI, `frontend/src/api/tripClient.ts` (`lockTrip`) and the lock call site (`frontend/src/features/trip-detail/useTripDetailPage.ts`) must accept and forward `confirmNoPhoto`. Wire it alongside the existing `confirmZeroRevenue` confirmation flow (same dialog pattern). If the UI confirmation is deferred, the gate is still enforced (hard 422 with no override) — acceptable as an intermediate deploy.
5. Update `DELIVERY_TRIP_LIFECYCLE.md` so the photo rule is documented **at lock** (Bước 4), and the completion section reflects B2 permissive.
6. **Decision points (flagged for approval):** (a) baseline = "≥1 any type" vs. stricter; (b) allow `confirmNoPhoto` override (admin only?) or hard block; (c) whether the cargo-type CONTAINER+SEAL tier applies at lock. The plan recommends baseline ≥1 + override + stricter-tier-for-requires-photos.

### 2.4 Acceptance criteria
- AC6: `POST /lock` on a trip with 0 photos → 422 with the Vietnamese message; with `confirmNoPhoto: true` (admin/manager) → succeeds.
- AC7: `POST/lock` on a `requires_photos === true` cargo trip with only `OTHER` photos → 422 (needs CONTAINER + SEAL); with ≥1 CONTAINER and ≥1 SEAL → succeeds. A trip whose `requires_photos` is `false` or `NULL` → baseline ≥1-any-photo rule only.
- AC8: Completion (`POST /complete`) remains permissive — no photo gate added there (B2 preserved).
- AC9: `trip-status-machine.test.ts` extended with a data-driven + functional assertion for the photo gate (note: existing tests are pure data-driven and don't call the real service — add at least one functional/integration test that exercises the photo count).

---

## 3. Finding 3 — Revenue override footgun (`revenueEmptyReturn`/`revenueCombine` override `revenue`)

### 3.1 Evidence (verified)
- **Override logic:** `backend/src/services/trip-mutations.service.ts:110-123` (`resolveRevenue`). If **either** split is `!== undefined` → `revenue = emptyReturn + combine` and direct `revenue` is **discarded**.
- **Why zero splits zero-out revenue:** `0 !== undefined` is `true` (line 111), so explicit `0` counts as "provided" → `0 + 0 = 0`; the `data.revenue` fallthrough (line 121) is unreachable. There is **no** `?? 0` bug — the `|| 0` on lines 115/118 only coerces null-ish *stored* fallbacks.
- **Zod:** `shared/src/schemas/index.ts:124-126` — all three `.optional()`, no default, no nullable. Absence is preserved as `undefined` (distinct from `0`).
- **Frontend is the intended caller and is unaffected:** `frontend/src/hooks/useTripFormDispatch.ts:764-770` omits `revenue` and sends splits as `undefined` (never `0`) when blank. The contract is UI-coupled, documented (JSDoc 82-108, "feedback202606 A3 §9"), and pinned by `backend/src/tests/revenue-persistence.test.ts`.

### 3.2 Conclusion
This is **not a bug** — it is an intentional, tested contract. The user agrees ("may be correct for the UI contract"). It is a **footgun for direct API callers only.**

### 3.3 Fix (Option R1 — recommended)
1. Add a `.superRefine()` to `updateTripFiguresSchema` (`shared/src/schemas/index.ts`): if `data.revenue !== undefined` AND (`data.revenueEmptyReturn !== undefined` || `data.revenueCombine !== undefined`) → `addIssue({ code: 'custom', message: 'Gửi revenue HOẶC splits (revenueEmptyReturn/revenueCombine), không gửi cả hai.', path: ['revenue'] })`.
2. **Pre-flight grep (HARD GATE):** `grep -rn "revenueEmptyReturn\|revenueCombine" backend/src frontend/src` plus a search of any agent-bot / n8n payloads. **Pass criterion: zero callers outside `frontend/src/hooks/useTripFormDispatch.ts` send `revenue` together with a split.** If any integration test or external caller sends both, block merge until each is reconciled (the mixed shape now returns 422). The unit tests in `revenue-persistence.test.ts` call `resolveRevenue` directly (bypass the schema) → unaffected, and this is verified, not assumed.
   - **Explicit boundary (Architect Rec 5):** the refine does NOT reject single-split payloads — `{revenueEmptyReturn: 0}` alone is legal and meaningful (`revenue-persistence.test.ts:62`, returns `0 + stored`). The shape R1 **outlaws** is exactly `revenue-persistence.test.ts:67` (`{revenue: 9999, revenueEmptyReturn: 100, revenueCombine: 200}` → currently 300). That test survives only because it calls `resolveRevenue` directly and bypasses the schema; the schema-layer refine is what makes the mixed shape a 422 for real HTTP callers.
3. Add a schema-level test asserting the mixed payload is rejected with a clear 422, and that split-only and revenue-only payloads still pass.
4. Document the precedence in the API docs / a comment block referencing A3 §9.

### 3.4 Acceptance criteria
- AC10: A direct API caller sending `{revenue: 1500000, revenueEmptyReturn: 0, revenueCombine: 0}` → **422** with the Vietnamese message (not silent zero-out).
- AC11: Frontend trip-figure edits (split-only and revenue-only) continue to persist correctly — no UI regression.
- AC12: `revenue-persistence.test.ts` (unit) still green; new schema-reject test green. **Gate:** shared is rebuilt (`shared` → `dist/`) BEFORE running the backend schema-reject test — the backend reads shared from `dist/`, so an unbuilt refine is invisible and produces a false-green.

---

## 4. Risks & Mitigations
| Risk | Mitigation |
|---|---|
| D2 symmetric Zod breaks an existing expense-creation UI flow that sends `FORWARDER_ADVANCE` w/o forwarder | Audit `frontend` expense-create path before merge; gate the Zod change behind the verified UI behavior |
| Bug 1 root cause is environmental (local DB desync), not code | Diagnostic step (1.4.1) captures truth before code changes; if env-only, the code hardening is still merged as defense-in-depth |
| Lock photo gate (L1) reverses perceived spirit of B2 | Plan preserves completion-permissive; gate is at lock only; soft override (`confirmNoPhoto`) mirrors `confirmZeroRevenue`; **product sign-off recorded in ADR** |
| R1 refine rejects a legitimate mixed payload used somewhere unseen | Pre-flight grep (3.3.2) is a gate; refine is additive and reversible |
| Multiple `postTripLock`/`postTripUnlock` call sites (completion, cancel-from-completed, `updateTripFigures` relock) | One `validateAncillaryFees(fees,{strict})` helper at the top of each method inherits to all callers; `strict:false` on the relock path prevents the figures-edit regression (AC13); legacy data degrades gracefully (skip+log), tracked backfill as follow-up |

## 5. Verification plan (run before claiming done)
- `cd backend && pnpm exec tsc --noEmit` → exit 0.
- Rebuild shared (`shared` → `dist`, backend reads from `dist/`).
- `cd backend && npm test` → green, including the **extended** `ledger.service.chiho.test.ts` (null-counterparty cases), extended `trip-status-machine` photo test, and revenue schema-reject test.
- Manual/E2E: reproduce trip-81 complete (AC1) and trip-82 lock (AC6/AC7) against the local dev DB; capture HTTP status + body.
- `/code-review` pass before merge (per project convention "always /code-review before merging").

## 6. ADR — Architectural Decision Record
- **Decision:** (1) Bug 1 → diagnose-then-harden with a **call-site-aware guard**: one `validateAncillaryFees(fees,{strict})` helper at the top of `postTripLock`/`postTripUnlock`; `strict:true` throws 422 at completion (gate of origin), `strict:false` skips-and-logs on the `updateTripFigures` relock path so legacy bad fees never block an unrelated figures edit (AC13); plus symmetric Zod refine + regression test + tracked legacy backfill. (2) Bug 2 → soft photo gate at lock (≥1 photo; cargo-type CONTAINER+SEAL tier when `requires_photos`; `confirmNoPhoto` admin override); completion stays permissive (B2). (3) Bug 3 → schema-level `.superRefine()` rejecting revenue+split mixed payloads; no change to the `resolveRevenue` happy path.
- **Drivers:** financial correctness (append-only ledger feeds debt/P&L); consistency with prior Pete decisions (B2, A3 §9); fail-loud at the gate of origin vs. graceful degradation on re-sync.
- **Alternatives considered:** B (patch symptom only), C (block auto-approve), blanket-throw on all paths (rejects — hard relock regression), L2 (hard gate), L3 (docs-only), R2 (docs-only), "treat 0 as absent" for revenue (rejects — breaks pinned explicit-zero contract). Note: the non-strict `skip-and-log` path adopted for relock is **not** the rejected "skip-silently everywhere" — it is (a) logged with structured output, (b) surfaces skipped fee IDs to the caller, (c) scoped to the re-sync path where a one-sided entry already exists, and (d) time-bounded by the concrete backfill SQL in §1.4-3 with a retire-when-empty criterion. It is a deliberate, bounded degradation, not a return to silent correctness loss.
- **Why chosen:** The strict/non-strict split is the only framing that satisfies Principle 2 (fail loud) at completion AND Principle 3 (surgical) on the relock path — the Architect's tradeoff tension is resolved rather than dissolved by a single global rule.
- **Consequences:** Expense-create UI must supply a counterparty for `FORWARDER_ADVANCE`; the frontend lock dialog must forward `confirmNoPhoto` (else the override is unreachable and the gate is hard); direct API callers sending mixed revenue payloads get a new 422; lock requires evidence (soft-overridable); legacy null-counterparty APPROVED fees degrade gracefully (logged, non-blocking) until backfilled via the §1.4-3 SQL. No DB migration.
- **Follow-ups:** (a) Pete sign-off on lock photo-gate tier + override semantics; (b) backfill/audit existing null-counterparty APPROVED fees in prod; (c) update `DELIVERY_TRIP_LIFECYCLE.md` to move the photo rule to lock; (d) deferred `confirm:{zeroRevenue?,noPhoto?}` envelope refactor (avoid breaking `POST /lock` body now); (e) `/code-review` after implementation.

## 7. Out of scope
- No new DB tables, no migrations, no enum changes.
- No change to the frontend revenue-submission contract (splits-as-undefined).
- No change to completion permissiveness (B2).
- DRIVER mobile photo-upload UX unchanged.
