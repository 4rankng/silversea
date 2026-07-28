# Q18-Q23 / O01-O02 Completion Audit

**Audit date:** 2026-07-28
**Mode:** read-only, current-worktree production-readiness audit
**Authority:** `docs/prd/business-logic-qa-proposals.md:205-291`
**Classification:** `PROVED` = current code plus direct behavioral proof covers the
material clause; `PARTIAL` = meaningful implementation exists but a required
surface or negative/concurrency case is unproved; `MISSING` = no implementation
or direct proof found; `CONTRADICTED` = current behavior conflicts with the
accepted wording.

## Executive verdict

| Rule | Verdict | Completion blocker |
|---|---|---|
| Q18 | PARTIAL | The accepted rule is universal, but current proof is a set of governed slices; there is no exhaustive locked-entity/write-boundary census. |
| Q19 | PROVED | No material gap found. |
| Q20 | PROVED | Completion-period official reporting, salary, event-date fuel/expense/attendance, operational start-date queries, and in-progress exclusion have direct proof. |
| Q21 | PARTIAL | Late fuel data is allowed when a current month is open, but no persisted adjustment links it back to the closed source month. |
| Q22 | PROVED | The seven accepted authority pairs now have persisted provenance and end-to-end propagation/immutability/race proof. |
| Q23 | PARTIAL | The registry is exhaustive only over routes already using `runIdempotent`; custom declared command paths can still commit effects without an atomic success audit. Universal material-write adoption is therefore unproved. |
| O01 | PARTIAL | Schedule/location/capacity/overlap/reposition/cross-day/cancellation/late-completion behavior is proved, but concurrent pairing and pairing-vs-lifecycle races are not directly tested. |
| O02 | PARTIAL, with one CONTRADICTED clause | Domain filtering/redaction/read-only access work. Literal assigned-scope behavior is contradicted by the no-assignment company-wide fallback and is only weakly tested across supported entity-resolution paths. |

The plan trackers are stale and must not be used as completion evidence:
`phase-02-shared-governance-and-concurrency.md:63-79` still marks Q22/Q23 open,
while `phase-07-two-way-dispatch-and-audit-access.md:52-55` still calls O01
pending. Current source and tests supersede those progress notes, but do not
erase the gaps above.

## Verification performed

Fresh focused command:

```text
cd backend &&
npx tsx --test --test-concurrency=1 \
  src/tests/q18-adjustment-governance.test.ts \
  src/tests/q19-business-calendar.test.ts \
  src/tests/q19-business-calendar-routes.test.ts \
  src/tests/q20-official-reporting-periods.test.ts \
  src/tests/q20-start-date-trip-query.test.ts \
  src/tests/q21-period-authority.test.ts \
  src/tests/q22-source-authority.test.ts \
  src/tests/material-write-registry-exhaustive.test.ts \
  src/tests/q23-durable-command-boundary.test.ts \
  src/tests/q23-gps-job-commands.test.ts \
  src/tests/o01-trip-pairing.service.test.ts \
  src/tests/o01-trip-pairs.routes.test.ts \
  src/tests/audit-log-routes.test.ts
```

Result: **74 tests, 13 suites, 74 passed, 0 failed, exit 0**. This establishes
that the focused implemented behavior is currently green; it does not convert
missing clauses into proof.

Integrated saved evidence is also green at the audited HEAD baseline:

- `qa/2026-07-28_release-final7_backend-test.log`: 1,801/1,801, exit 0.
- `qa/2026-07-28_release-final6_e2e-full.log`: 249 pass, 0 fail, 3 skips,
  exit 0.
- `qa/2026-07-28_release-final7_build.log`: exit 0.
- `qa/2026-07-28_release-final7_lint.log`: 0 errors, 48 warnings, exit 0.

The current worktree contains unrelated uncommitted Q01 type additions in
`backend/src/services/statement.service.ts` and `shared/src/types/index.ts`.
They do not change the audited Q18-O02 control paths, but the saved integrated
artifacts predate those two edits.

## Clause audit

### Q18 — approved/locked data

| Material clause | Status | Current evidence | Weakness / exact proof still needed |
|---|---|---|---|
| Approved or locked data cannot be edited in place. | PARTIAL | `backend/src/tests/q18-adjustment-governance.test.ts:372-409` blocks direct unlock; `:756-808` blocks approved trip-expense rewrites; `backend/src/tests/q21-period-authority.test.ts:123-174` protects confirmed debit notes. Fuel-invoice and settlement correction slices are additionally exercised by `backend/src/tests/q06-fuel-invoice-routes.test.ts:916-1055` and `backend/src/tests/forwarder-settlement-workflow.test.ts:602-713,951+`. | No executable census maps every status-bearing/locked entity to every reachable update/delete route. Add a table-driven `q18-locked-write-boundary-exhaustive.test.ts` that enumerates trip, expense, fuel invoice, settlement, debit note/AR, payment/refund, salary close/confirmation, price/config governance and any other approved/posted entity, then proves direct PUT/PATCH/DELETE rejection for each terminal state. |
| Only adjustment/reversal is allowed after lock; reopen is exceptional and only before issue/posting/payment. | PARTIAL | `q18-adjustment-governance.test.ts:195-363` proves governed adjustment with three actors and one concurrent winner; `:372-648` proves exceptional reopen and races against posting/issuance; Q22 proves issued-note adjustment rather than overwrite at `q22-source-authority.test.ts:698-793`. | Strong for named slices, not universal. The exhaustive test above must also assert the only surviving path is an append-only adjustment/reversal and that reopen is unavailable after each domain’s irreversible milestone. |
| Reason, before/after values, actor, and approver are retained. | PARTIAL | `backend/src/db/schema.ts:942-1054` defines non-empty reason, snapshots, maker/checker/approver and lifecycle constraints; `q18-adjustment-governance.test.ts:240-304` asserts exact snapshots/actors/result; migrations `0135`, `0136`, `0153`, `0154` add governed correction histories. | No cross-domain invariant proves every correction adapter stores all four required dimensions. Add a schema/adapter registry test that inspects every Q18 correction action/result and asserts reason, immutable before/after, maker, checker/approver and applied effect reference. |
| Operational, money, and period-reopen authority are split as accepted. | PARTIAL | Current tests use ACCOUNTANT maker, MANAGER checker, ADMIN approver (`q18-adjustment-governance.test.ts:240-304`); salary reopen limits and payout blocker are proved by `m73-salary-period-close.test.ts:398-428`. | Code roles are generic `ADMIN`/`MANAGER`/`ACCOUNTANT`; there is no explicit persisted “Finance/Accounting head” or delegated-director authority model. Either document the approved role mapping or add policy data/tests proving who represents each accepted authority and how delegation expires. |

### Q19 — weekend/holiday due dates

| Material clause | Status | Current evidence |
|---|---|---|
| Default rolls to the next business day. | PROVED | `backend/src/tests/q19-business-calendar.test.ts:38-60,86-111` covers weekend, holiday, make-up weekend and DB authority. |
| Original contractual date is preserved and displayed beside processing date. | PROVED | Immutable persistence is asserted at `q19-business-calendar.test.ts:166-192`; XLSX/PDF output renders both at `backend/src/services/billingDocument.service.ts:1723-1724,2314-2315` and `backend/src/services/debit-note-pdf.service.ts:269-274,372-375`; portal UI renders both at `frontend/src/pages/portal/PortalStatementPage.tsx:134-140`. |
| Overdue/reminders use the adjusted date. | PROVED | `q19-business-calendar.test.ts:76-79,223+`; `backend/src/services/ar-status.service.ts:93-96,144-160`; `backend/src/services/receivable-reminder.service.ts:758-772`. |
| Contract calendar-day override wins. | PROVED | `q19-business-calendar.test.ts:63-69`; persisted customer policy is consumed by the integrated DB test at `:179-192`. |

No additional Q19 command is required for completion. Retain the focused Q19
tests plus the full backend/E2E gates for regression.

### Q20 — cross-period attribution

| Material clause | Status | Current evidence |
|---|---|---|
| Revenue, salary, official trip count and profit use completion date. | PROVED | `backend/src/tests/q20-official-reporting-periods.test.ts:205-293` proves P&L, dashboard count, quarterly profit/distribution and fuel variance across month/quarter boundaries. Salary close proves completion-period salary at `backend/src/tests/m73-salary-period-close.test.ts:172-204,297-307`. |
| Attendance, fuel and expense use actual event date. | PROVED | Fuel invoice-event attribution is proved at `q20-official-reporting-periods.test.ts:295-364`; billing expense membership uses `trip_expenses.expense_date` at `backend/src/services/billingDocument.service.ts:615-631`; actual cross-midnight attendance is proved at `m73-salary-period-close.test.ts:208-246`. |
| Start date remains the dispatch/search date. | PROVED | `backend/src/tests/q20-start-date-trip-query.test.ts:74-116`. |
| In-progress trips stay operationally visible but out of official totals. | PROVED | `q20-official-reporting-periods.test.ts:227-271` asserts exclusion from official P&L/count while the operational in-transit count remains visible. |

### Q21 — period locking and late data

| Material clause | Status | Current evidence | Weakness / exact proof still needed |
|---|---|---|---|
| Salary and fuel lock monthly. | PROVED | `backend/src/services/period-lock.service.ts:139-164`; salary mirror proof at `backend/src/tests/q21-period-authority.test.ts:307-340`. |
| Debit note follows customer cycle: monthly default, weekly only by contract. | PROVED | `period-lock.service.ts:95-136`; weekly contract negative proof at `q21-period-authority.test.ts:251-264`; shared/frontend contract tests are retained in `qa/2026-07-28_final-q12-q14-q20-q21_shared-test.log` and `...frontend-mode-test.log`. |
| Late data moves to the current open period as an adjustment linked to the source closed period. | PARTIAL | Debit-note linkage is proved at `q21-period-authority.test.ts:213-249`; salary has `salary_period_adjustments.source_period/target_period` in `backend/src/db/schema.ts:2739-2766`. | Fuel contradicts the intended persistence shape: `assertFuelPeriodCanAbsorbLateApproval()` only checks source/current lock state (`period-lock.service.ts:430-447`) and returns without creating any source→target adjustment link. Add a fuel-period-adjustment table/authority or an equivalent immutable link, then test closed May + open June approval persists source `2026-05`, target `2026-06`, reason/actor/approval and leaves May unchanged. |
| Old period is not edited; reopen is only pre-issue/pre-payment and approved. | PARTIAL | Debit-note direct create/delete and reopen blockers are proved at `q21-period-authority.test.ts:176-210,266-290`; salary payout-gated reopen is proved at `m73-salary-period-close.test.ts:398-428`. | Fuel has no governed reopen/late-adjustment application proof. Extend the fuel test above with direct closed-month mutation rejection and approved reopen authority, or explicitly disallow fuel reopen and prove that policy. |

Required focused command after fixing:

```text
cd backend &&
npx tsx --test --test-concurrency=1 \
  src/tests/q21-period-authority.test.ts \
  src/tests/q06-fuel-invoice-routes.test.ts \
  src/tests/m61-fuel-ap-recon.test.ts
```

### Q22 — source authority and provenance

| Material clause | Status | Current evidence |
|---|---|---|
| Shipment owns customer/cargo/container; trip owns assignment/time/status; approved expense owns cost; issued note owns receivable; receipts/allocations own paid/outstanding. | PROVED | Seven fail-closed policies are explicit in `shared/src/governance/source-authority.ts:9-198`, including approved-only expense authority. |
| Before milestone, dependent drafts recompute and stakeholders are warned. | PROVED | Shipment→trip cargo recompute/version proof at `backend/src/tests/q22-source-authority.test.ts:350-429`; draft debit-note and approved-expense propagation at `:499-696`. |
| After dispatch/lock/issue, sources do not overwrite dependents; changes create version/adjustment/reversal. | PROVED | Post-dispatch shipment request at `q22-source-authority.test.ts:431-493`; issued-note immutability, stale provenance, notification and governed adjustment at `:698-793`. |
| Provenance/history survives end-to-end through AR and paid/outstanding consumers. | PROVED | Persisted columns: `trips.source_shipment_version` (`backend/src/db/schema.ts:645,682-683`), trip-container shipment IDs/version (`:1375-1399`), billing-line source ID/version/change time (`:1079-1082`), allocation source trip (`:2625-2648`). Consumer authority and immutable allocation/refund history are proved at `q22-source-authority.test.ts:795-1065`, including real races at `:948-1058`. |

Fresh Q22 focused suite: 11/11 passed in this audit. Migrations
`0151_q22_source_provenance` and `0152_q22_shipment_cargo_authority` are present
in `backend/drizzle/meta/_journal.json`.

### Q23 — idempotency, stale writes and concurrent approval

| Material clause | Status | Current evidence | Weakness / exact proof still needed |
|---|---|---|---|
| Every material write requires a unique transaction key; exact replay returns the original result with no second effect. | PARTIAL | `runIdempotent()` requires a key and serializes `(endpoint,key)` with a transaction advisory lock (`backend/src/services/idempotency.service.ts:256-375`). The focused boundary test passes replay/concurrency/rollback. | The purported exhaustive test only scans files that already contain `runIdempotent()` (`backend/src/tests/material-write-registry-exhaustive.test.ts:115-130`), so it cannot detect a mutation route that never adopted the boundary. Build a route census from all mounted POST/PUT/PATCH/DELETE handlers (with an explicit, reviewed non-material allowlist) and assert every material handler resolves to a declared rule and calls the shared durable boundary. |
| Business identifiers prevent duplicates. | PARTIAL | Trip-pair schema has distinct/order uniqueness (`backend/drizzle/0141_two_way_dispatch_pairing.sql:18-20,37-40`); many financial/shipment/trip suites prove domain-specific keys. | No exhaustive natural-key inventory exists. Extend the same material-write manifest with required DB uniqueness or a documented idempotency-only rationale per entity; migration tests must prove each declared unique business identifier. |
| Stale writers reload; no silent overwrite. | PARTIAL | Q18 adjustment versions, shipment/trip/config write suites and `idempotency.service.ts:309-344` reject actor/payload drift. O01 checks expected trip versions at `backend/src/services/trip-pairs.service.ts:98-105,306-318`. | There is no structural check that every mutable material update accepts and enforces `expectedVersion`. Add a manifest field for concurrency mode and a table-driven HTTP test for every update/delete entry. |
| First valid approval/transition wins; later attempts are rejected. | PARTIAL | Strong direct race proof exists for Q18 adjustment/issue, Q22 allocations/refunds, penalties, debt offsets, salary and other focused suites. | The material-write manifest must enumerate every approval/transition and require a two-caller race test; aggregate green tests are not a coverage argument. |
| Every attempt and conflict is retained in audit history. | PARTIAL | `backend/src/middleware/audit.ts:223-245` persists 409 conflicts; `idempotency.service.ts:368-373` inserts successful audit atomically for shared-boundary callers; `q23-durable-command-boundary.test.ts:205-304` proves replay/conflict/rollback. | `admin-gps.ts` is a concrete counterexample to universal atomicity: it implements a separate command protocol (`backend/src/routes/admin-gps.ts:132-243`), writes GPS effects outside the idempotency transaction, and does not call the transaction-local success-audit insert. It is nevertheless declared material at `backend/src/middleware/material-write.ts:211-212`, so an audit failure can yield HTTP 500 after the GPS effect committed. Also, GPS replay does not compare `createdBy` at `admin-gps.ts:154-169`. Migrate GPS commands to the shared durable boundary or add an atomic/outbox protocol; inject audit failure and prove no un-audited effect, plus cross-actor replay rejection. |

An additional forensic mismatch exists at `backend/src/routes/trips.ts:169-184`:
trip-pair create returns HTTP 201 but does not pass `responseStatusCode: 201` to
`runIdempotent`, so the persisted result/audit status defaults to 200. Fix and
assert first/replay status consistency.

Required verification after closure:

```text
cd backend &&
npx tsx --test --test-concurrency=1 \
  src/tests/material-write-registry-exhaustive.test.ts \
  src/tests/q23-durable-command-boundary.test.ts \
  src/tests/q23-gps-job-commands.test.ts \
  src/tests/q23-approved-financial-idempotency.test.ts \
  src/tests/q23-config-crud-idempotency.test.ts \
  src/tests/q23-direct-money-idempotency.test.ts \
  src/tests/q23-field-operations-idempotency.test.ts \
  src/tests/q23-forwarder-durable-material-routes.test.ts \
  src/tests/q23-shipment-idempotency.test.ts \
  src/tests/q23-trip-idempotency.test.ts
```

Then run full backend, lint, typecheck, build and E2E because the boundary is
cross-cutting.

### O01 — two-way dispatch authority

| Material clause | Status | Current evidence | Weakness / exact proof still needed |
|---|---|---|---|
| Each candidate has authoritative planned start/end, canonical locations, cargo weight and vehicle capacity. | PROVED | Persisted columns/migration at `backend/drizzle/0141_two_way_dispatch_pairing.sql:23-30`; service locks and loads persisted authority at `backend/src/services/trip-pairs.service.ts:238-292`; forged request fields are rejected at `:98-156` and by `backend/src/tests/o01-trip-pairs.routes.test.ts:298-391,477-535`. |
| No overlap; compatible next origin; sufficient reposition time; no overload. | PROVED | Deterministic evaluator at `backend/src/services/trip-pairing.service.ts:96-197`; focused unit tests cover overlap, impossible reposition, buffer and overload at `backend/src/tests/o01-trip-pairing.service.test.ts:38-153`; HTTP overlap/RBAC proof at `o01-trip-pairs.routes.test.ts:263-296`. |
| Preserve each trip’s independent status, revenue and cost. | PROVED | Pair persistence updates only plan/pair/version columns (`trip-pairs.service.ts:378-417`); revenue, total cost and status are read but not overwritten. Pair schema stores only relationship/efficiency data (`0141_two_way_dispatch_pairing.sql:1-20`). |
| Cancellation preserves the surviving trip; late completion and cross-day operation are explicit. | PROVED | Cross-day valid pair at `o01-trip-pairing.service.test.ts:38-66`; cancellation/late lifecycle functions at `trip-pairing.service.ts:200-259`; persisted lifecycle proof at `o01-trip-pairs.routes.test.ts:393-475`. |
| Concurrent pairing is explicit and safe. | PARTIAL | Production code locks both trip rows in deterministic ID order (`trip-pairs.service.ts:238-262`) and rejects an already-active pointer (`:158-170`). | No test launches concurrent pair attempts. Add: (1) same two trips/same and different keys; (2) A+B racing A+C; (3) pair create racing cancellation; (4) pair create racing first-trip completion. Assert exactly one active pair, loser 409, no orphan `trip_pairs` row, both pointers consistent, and no surviving-trip deletion. |
| FORWARDER cannot pair. | PROVED | Route requires ADMIN/MANAGER (`backend/src/routes/trips.ts:169-170`); HTTP 403 proof at `o01-trip-pairs.routes.test.ts:290-295`. |

Required focused command:

```text
cd backend &&
npx tsx --test --test-concurrency=1 \
  src/tests/o01-trip-pairing.service.test.ts \
  src/tests/o01-trip-pairs.routes.test.ts
```

The command is currently green (13/13); it needs the concurrency cases above
before O01 is fully proved.

### O02 — ACCOUNTANT audit access

| Material clause | Status | Current evidence | Weakness / exact proof still needed |
|---|---|---|---|
| ACCOUNTANT can read only money/receivable/payment/salary audit domains. | PROVED | Casbin is read-only (`backend/src/casbin/policy.csv:27`); route exposes GET only (`backend/src/routes/config.ts:1839-1854`); finance-domain predicate and role gate are server-side (`backend/src/services/audit-query.service.ts:20-76,270-291`). Negative auth/config proof is at `backend/src/tests/audit-log-routes.test.ts:223-260`. |
| Access is within assigned scope. | CONTRADICTED for no-assignment accounts; PARTIAL for assigned accounts | Assigned-customer SQL resolves direct customer/trip plus trip-expense, billing-document, debt-offset and credit-override relationships (`audit-query.service.ts:102-206`). One direct payment case passes at `audit-log-routes.test.ts:299-353`. | `audit-query.service.ts:193-206` explicitly grants legacy company-wide finance/payroll visibility when the accountant has no customer link and lets any row deemed “not recognizably customer scoped” pass even when links exist. That conflicts with the literal accepted “within assigned scope” rule unless SilverSea separately approves a company-wide fallback. Obtain that decision; otherwise fail closed for unassigned/unresolved customer-bound rows. Add tests for every resolver branch, zero assignments, removed assignment, payload-less customer-bound rows, unrelated business unit, and pagination/count parity. |
| Security configuration, login-sensitive information and unrelated data are hidden. | PROVED for current response contract | ACCOUNTANT query excludes auth/access-denied and non-finance rows (`audit-query.service.ts:280-291`); response strips method/path/IP/body and whitelists five payload fields (`:228-252,321-348`); redaction assertions are at `audit-log-routes.test.ts:233-251`. | Preserve a negative test where sensitive keys are nested at multiple depths and embedded in a finance event. Consider redacting or categorizing free-form `message` if producers can include credentials/PII; current test does not challenge that field. |
| Access is read-only and discoverable in responsive navigation. | PROVED | Backend route is GET-only; frontend guard includes ACCOUNTANT (`frontend/src/App.tsx:150,255`); nav includes audit logs (`frontend/src/components/Layout.tsx:93`), with route/nav tests at `frontend/src/App.audit-route.test.tsx:33-64` and `frontend/src/components/Layout.test.ts:6-11`. |

Required focused verification after the scope decision/fix:

```text
cd backend &&
npx tsx --test --test-concurrency=1 src/tests/audit-log-routes.test.ts
cd ../frontend &&
npx vitest run \
  src/lib/audit-helpers.test.ts \
  src/App.audit-route.test.tsx \
  src/components/Layout.test.ts
```

## Required actions before declaring Q18-O02 complete

1. Implement and test persisted source→target linkage for late fuel adjustments
   (Q21).
2. Replace Q23's circular “all existing `runIdempotent` callers” census with an
   all-mounted-mutation route census and reviewed non-material allowlist.
3. Bring custom GPS commands under atomic effect/idempotency/audit semantics,
   including actor-bound replay, or supply an equivalent transactional outbox
   proof.
4. Add true concurrent O01 pairing and pairing-vs-cancel/complete tests.
5. Resolve the O02 no-assignment policy against the accepted “within assigned
   scope” wording; fail closed if the fallback was not explicitly accepted.
6. Expand O02 row-scope tests across every resolver branch and unknown/unresolved
   customer-bound finance rows.
7. Add a Q18 exhaustive locked-entity/write-boundary manifest rather than
   inferring universality from slice tests.
8. After fixes, rerun affected focused suites, both typechecks, root lint, full
   backend/frontend tests, `make build`, and full E2E; save artifacts under
   `qa/` as required by `AGENTS.md`.

## Final status

Status: DONE_WITH_CONCERNS
Summary: Q19, Q20 and Q22 are directly proved. Q18, Q21, Q23, O01 and O02
cannot be marked complete because universal locked-write coverage, fuel late
adjustment provenance, universal material-write adoption/atomic audit, O01
concurrency, and literal O02 assignment scope remain unproved or contradicted.
Concerns/Blockers: The strongest blockers are Q21 fuel-period provenance,
Q23's circular coverage mechanism plus custom GPS atomicity, O01 missing race
proof, and O02's fail-open legacy/unresolved scope behavior.
