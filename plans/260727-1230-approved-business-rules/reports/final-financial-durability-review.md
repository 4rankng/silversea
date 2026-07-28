# Final Financial Durability Review

**Date:** 2026-07-28  
**Reviewer:** `/root/final_financial_durability_review`  
**Mode:** independent read-only adversarial review  
**Verdict:** **FAIL / NO-GO**

## Code Review Summary

### Scope

- Reviewed the implementation and evidence described by:
  - `plans/260727-1230-approved-business-rules/reports/q23-durable-mutations.md`
  - `plans/260727-1230-approved-business-rules/reports/q15-profit-tx-integrity.md`
  - `plans/260727-1230-approved-business-rules/reports/q15-official-identity-snapshots.md`
  - `plans/260727-1230-approved-business-rules/reports/review-q18-q22-q23-integration.md`
- Primary implementation surface: durable idempotency/audit middleware, upload/OCR/expense storage compensation, multipart retry keys, profit distribution governance, billing-document identity snapshots, and the credit-override performance paths.
- Focused diff size for the named implementation files: approximately 2,672 insertions and 658 deletions. The whole pending worktree is much broader (172 changed files), so this review does not certify unrelated changes.
- DB-backed tests were not run because the controller assigned the shared DB lane elsewhere.

### Overall Assessment

Stage 1 spec compliance **fails**. The new transaction-local audit insert is sound only for routes declared in `MATERIAL_WRITE_RULES`, but several reachable forwarder mutations using `runIdempotent()` are not declared. Storage rollback remains best-effort, actor binding remains nullable for historical keys, and legacy issued documents still render live identity. The profit fingerprint closes the same-aggregate drift case, but the table-lock implementation introduces a production deadlock/availability hazard.

Pre-landing two-pass result: **7 issues (1 critical, 4 high, 2 medium)**.

## Critical Issues

### 1. Undeclared forwarder mutations still commit without atomic success audit

**Evidence:** `backend/src/middleware/material-write.ts:98-100` declares only forwarder expense-completion and photo create/delete. The router also performs idempotent material writes for container creation (`backend/src/routes/forwarder.ts:168-189`), expense creation (`:197-228`), expense update (`:231-276`), expense delete (`:302-325`), advance-request creation (`:358-377`), and advance-settlement creation (`:443-461`). `persistMaterialWriteSuccessAuditInTransaction()` returns without inserting anything when the route is undeclared (`backend/src/services/audit.service.ts:189-192`).

**Impact:** these business effects and their idempotency rows can commit while mandatory audit remains post-commit/best-effort. This directly violates atomic effect-plus-audit and Q23's requirement that every attempt/conflict be retained. The registry test is curated and samples only the forwarder photo endpoints, so it cannot detect this class of omission.

**Required fix:** make the registry exhaustive for every `runIdempotent()` material route and add a structural/table-driven test that derives or enumerates all mounted mutation routes, not a hand-picked sample. Each route must prove audit-insert failure rolls back its business effect and idempotency row.

## High Priority

### 2. Rollback compensation suppresses storage deletion failures

**Evidence:** company logo and trip-photo rollback hooks catch and log deletion failures (`backend/src/routes/upload.ts:329-337,372-380`); OCR capture/persist-only do the same (`backend/src/routes/ocr.ts:240-248,354-362`); company expense photos do the same (`backend/src/routes/expense.ts:333-341`); the forwarder photo wrapper also logs and suppresses cleanup failure (`backend/src/routes/forwarder.ts:546-556`).

**Impact:** a DB/audit rollback can leave an external object with no durable DB owner and no cleanup job. Deterministic object keys help an exact manual retry but do not make cleanup durable; a user may never retry, and a company-logo orphan matches an authenticated serving-key shape. The report's “rollback cleanup hooks” are therefore not a complete durability guarantee.

**Required fix:** persist a transactional cleanup/outbox record before external upload or durably enqueue failed compensation; process it until deletion succeeds. Add failure-injection tests proving a failed cleanup remains discoverable and is eventually removed.

### 3. Profit source table locks can deadlock ordinary trip/truck mutations and block the whole fleet

**Evidence:** both request and approval acquire a quarter advisory lock and then `SHARE` table locks on `trips`, `truck_cap_table`, and `trucks` (`backend/src/services/profit-distribution.service.ts:80-90,117-121,212-215`).

**Impact:** `SHARE` conflicts with the `ROW EXCLUSIVE` locks taken by every insert/update/delete. A normal transaction that has already updated `trucks` and later updates `trips` can deadlock with profit distribution after it locks `trips` and waits on `trucks`. Even without a deadlock, the snapshot calculation blocks all writes to all three tables, not only rows in the selected quarter. The focused test proves stale fingerprint rejection and competing approval, but not concurrent source DML or deadlock behavior.

**Required fix:** avoid full-table `SHARE` locks. Use a transaction isolation/locking design scoped to the exact source rows, with a consistent lock order and retry handling for serialization failures. Add a concurrent test with source mutation during request and approval, and verify unrelated-quarter trip writes are not blocked.

### 4. Historical issued documents without `officialIdentity` still drift to live identity

**Evidence:** newly issued debit notes capture identity during `DRAFT -> SENT` (`backend/src/services/debit-note-lifecycle.service.ts:128-135`), and issued template overrides are correctly ignored (`backend/src/services/billingDocument.service.ts:521-530`). However, `resolveBillingDocumentIdentity()` falls back to live company/counterparty data whenever the snapshot lacks the new nested field (`backend/src/services/billingDocument.service.ts:1646-1654`). No migration/backfill or explicit immutable legacy snapshot is provided; the test covers only documents issued after this implementation.

**Impact:** every pre-existing issued document without `officialIdentity` can still change legal name, tax code, address, bank account, and representative on re-export after live master-data edits. This silently breaks historical official-document immutability.

**Required fix:** backfill issued documents from a defensible historical authority where possible, or mark them explicitly as legacy/unverifiable and prohibit silent live rendering. Add a regression fixture representing a pre-change issued snapshot.

### 5. Actor-bound replay permits nullable historical ownership

**Evidence:** replay rejects a different actor only when both current and stored `createdBy` are non-null (`backend/src/services/idempotency.service.ts:287-298`), while the schema remains nullable. Route authorization frequently occurs inside `create`; replay returns a stored snapshot or calls `load` without rerunning that create-time row-scope authorization (`:306-323`).

**Impact:** a historical/null-owned idempotency key can be replayed by any otherwise route-authorized actor who obtains or guesses the key, potentially exposing the original response or bypassing resource-scope checks. Current non-null rows are protected, but the claimed actor-bound contract is not exact across persisted data.

**Required fix:** for authenticated material routes, reject any replay unless `existing.createdBy === createdBy`, including null mismatch; backfill or expire legacy null-owned rows and make `created_by` non-null where the contract requires an actor. Add null-owner and row-scope replay tests.

## Medium Priority

### 6. Q18/Q22/Q23 performance findings remain unresolved

**Evidence:** credit checks still load every customer ledger row into application memory and aggregate in JavaScript (`backend/src/services/credit-limit.service.ts:190-209`). The override list still runs one governance decision query per returned request, up to 200 parallel follow-up queries (`backend/src/services/credit-limit.service.ts:589-610`).

**Impact:** ledger history growth increases memory/latency linearly, while list traffic can produce 201 database queries per request and saturate the connection pool. These were already identified by the integration review and are unchanged.

**Required fix:** aggregate outstanding balance in SQL/Drizzle and fetch latest governance decisions for the page in one joined/windowed/batched query. Add query-count or bounded-load evidence.

### 7. Upload audit status is persisted as 200 while the route returns 201

**Evidence:** company-logo, trip-photo, and company-expense photo calls do not pass `responseStatusCode: 201`, so `runIdempotent()` persists the default 200 and records that value in the atomic audit (`backend/src/services/idempotency.service.ts:271,338-353`), while their routes return 201 (`backend/src/routes/upload.ts:339,383`; `backend/src/routes/expense.ts:344`).

**Impact:** durable audit and response metadata do not describe the actual HTTP outcome, weakening forensic accuracy and response-contract replay.

**Required fix:** pass the real response status to `runIdempotent()` and return `outcome.statusCode` from the route. Add audit assertions for first execution and replay.

## Edge Cases Found by Scout

- Missing registry entries are an architectural omission risk because adding a new `runIdempotent()` route does not force a corresponding fail-closed declaration.
- Storage-upload success followed by audit/DB failure plus storage-delete failure has no durable recovery state.
- Profit distribution can deadlock with a transaction that touches the same tables in a different order; unrelated-quarter writes are also blocked.
- Legacy idempotency rows with null actor and legacy issued documents without nested identity are not covered by the new happy-path tests.
- Identity capture reads company settings and counterparty data without locking them; under `READ COMMITTED`, concurrent master-data edits can also produce an identity snapshot that is not from one stable issuance-time view. This should be covered while fixing the legacy snapshot boundary.

## Positive Observations

- Multipart payload hashes include file bytes server-side, and the reviewed frontend callers supply stable retry fingerprints that include file metadata plus operation scope.
- Newly issued debit notes ignore a template override and retain the captured identity after later company/customer edits.
- Profit approval now uses the supplied transaction and rejects source drift even when aggregate profit remains unchanged.
- The transaction-local audit insert correctly rolls back the business effect when the route is declared and audit insertion fails.

## Recommended Actions

1. Block landing and add all missing material routes to the fail-closed registry with exhaustive registry/audit-rollback tests.
2. Replace best-effort storage compensation with a durable cleanup/outbox mechanism.
3. Replace full-table profit locks with scoped, consistently ordered concurrency control and test concurrent source DML.
4. Define and implement a safe policy/backfill for legacy issued identity snapshots; serialize identity capture against master-data updates.
5. Enforce exact actor equality for replay and remediate null-owned historical keys.
6. Remove the credit-override N+1 and in-memory ledger aggregation.
7. Align persisted idempotent response/audit status with actual 201 responses.

## Verification

- `pnpm lint` — exit 0; 0 errors, 44 warnings.
- `cd backend && npx tsc --noEmit` — exit 0.
- `cd frontend && npx tsc -b` — exit 0.
- `git diff --check` — exit 0.
- DB-backed tests — not run by this reviewer due to the assigned shared-DB lane constraint.

## Metrics

- Type coverage: not measured; backend and frontend compiler gates passed.
- Test coverage: not measured; no coverage run was performed.
- Lint issues: 0 errors, 44 warnings.
- Review findings: 1 critical, 4 high, 2 medium.

## Plan Follow-up

- `plans/260727-1230-approved-business-rules/plan.md` correctly remains `in-progress`.
- Do not mark Q23 durable mutation closure complete while registry and storage compensation gaps remain.
- Do not mark official identity history complete without a legacy issued-document policy.
- Treat the profit fingerprint as a correctness improvement, but keep Q15 profit transaction integrity open until the table-lock production hazard is removed and concurrency-tested.
- Q18/Q22/Q23 performance follow-up remains open for credit override and ledger aggregation.

## Unresolved Questions

- What historical source, if any, can defensibly backfill issuer/counterparty identity for already-issued documents?
- Is there an existing durable jobs/outbox table appropriate for storage cleanup, or should cleanup records be a narrow new domain table?

Status: DONE_WITH_CONCERNS  
Summary: Final review is NO-GO: atomic audit coverage is incomplete, storage compensation is not durable, profit table locks are unsafe, and legacy actor/identity records remain outside the new guarantees.  
Concerns/Blockers: One critical, four high, and two medium findings require correction and re-verification before landing.
