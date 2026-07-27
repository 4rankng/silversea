# Q18/Q15 material-adjustment governance implementation

Status: implementation green; final independent re-review GO

## Delivered behavior

- Added a bounded `governance_actions` authority for trip AR adjustments and
  exceptional pre-posting trip reopen requests.
- Captures reason, exact before/after/delta snapshots, source version, applicable
  closed-period authority, maker/checker/approver identities, action version,
  application timestamp, and resulting ledger entry.
- Enforces three distinct actors and role checks. Request creation, checking,
  and approval use optimistic versions; stale source/action versions return 409.
- Requires `expectedVersion` at both public request boundaries. Missing versions
  return 400 before service execution.
- Reopen is denied when the trip has any accounting posting, non-draft debit-note
  issue marker, direct payment allocation, or payment against a debit note that
  contains the trip. Approval repeats these checks transactionally, so a source
  posted after request creation cannot be reopened.
- Reopen request/approval and first debit-note issuance share a trip-scoped
  transaction advisory lock. Debit-note issuance rechecks that every source
  trip is still `LOCKED` after acquiring the lock. Concurrent issue versus
  reopen therefore has exactly one valid winner.
- Debit-note issuance locks the billing-document row before reading source
  lines, acquires ordered trip authority locks, then re-reads the authoritative
  source set. Canonical save/update line replacement uses the same document-row
  and trip-lock order. Once a document is issued (`SENT` or later), its source
  lines cannot be replaced.
- Direct `LOCKED -> COMPLETED` remains blocked. A synthetic locked trip with no
  posting/issue/payment markers can reopen only after governed approval.
- Authenticated trip-expense creation records the maker. Approval fails closed
  for an unknown legacy maker (`created_by IS NULL`) in both direct approval and
  settlement approval; no actor separation is invented.
- Approved trip-expense source rows reject direct update/delete.
- Settlement corrections are append-only in
  `settlement_expense_adjustments`. Each correction preserves its sequence,
  source version, exact before/after snapshots, reason, actor, and eventual
  approver/time.
- Ordinary settlement update retains corrected links and effective amounts.
  Removing a link that already has correction history is rejected. Approval
  consumes the latest corrected amount and links all pending history rows to
  the approver in the same transaction.
- Any ordinary settlement update or correction invalidates a prior accountant
  check by returning the settlement to `PENDING` and clearing checker identity
  and timestamp. A fresh check is required against the final snapshot.
- Settlement approval rejects an approver who appears as `adjusted_by` on any
  pending correction history row.
- Settlement checking also rejects a checker who appears as `adjusted_by` on
  pending correction history, completing correction-maker/checker/approver
  separation.

## Second independent-review blocker closure

| Blocker | Closure | Regression proof |
|---|---|---|
| Debit-note issuance could race reopen approval | Shared trip advisory lock, ordered by trip ID, is consumed by reopen request/approval and debit-note transition. Issuance validates source trips after the lock. | Held-lock concurrent test proves both operations wait; after release exactly one succeeds and the persisted trip/document/action tuple is valid. |
| Material post-check settlement mutation retained checker sign-off | Update and correction atomically reset status to `PENDING`, `checked_by` and `checked_at` to null while preserving correction history. | Check→update/correct→approve rejection and fresh re-check success tests. |
| Correction actor could approve their own correction | Approval queries unapproved adjustment history under the locked settlement transaction and rejects matching `adjusted_by`. | Correction actor rejection followed by distinct approver success; history retains actor and independent approver. |
| Issuance could validate an old source-line set while update replaced it | Issue and replacement both lock the document row first, then the ordered union of trip authorities; issuance re-reads lines after locking and save/update require DRAFT. | Document-row-blocked concurrent replacement versus SENT test proves both wait, exactly one succeeds, and SENT never contains the unvalidated replacement trip. |
| Correction maker could self-check | Check queries pending correction history while holding the settlement row and rejects matching `adjusted_by`. | Correction-maker self-check rejected; distinct checker and distinct approver succeed with durable linkage. |

## Independent-review blocker closure

| Prior blocker | Closure | Regression proof |
|---|---|---|
| Reopen restored an editable posted source | Posting, issue, and payment authorities are checked at request and approval; denied sources and ledger remain unchanged | `q18-adjustment-governance_rereview-focused-test.final.log` |
| Unknown legacy makers failed open | Direct and settlement approval now reject `created_by IS NULL` with 409 | focused and compatibility logs |
| Settlement update erased corrections | Retained links keep corrected snapshots/amounts; corrected removals fail closed | focused log |
| Correction history was overwritten | Additive migration 0136 and append-only correction rows preserve every transition and approval link | focused and migration rerun logs |
| Source version was optional | Shared schemas and services require it; missing returns 400 and stale returns 409 | focused and public-boundary logs |

The prior medium-severity observation about superseded concurrent requests
remaining visibly pending is not part of these financial-integrity blockers.
Only one request can apply; the losing request returns 409. A terminal
`SUPERSEDED` workflow state remains a separate operator-experience enhancement.

## Main implementation files

- `backend/drizzle/0135_q18_adjustment_governance.sql`
- `backend/drizzle/0136_q18_settlement_adjustment_history.sql`
- `backend/drizzle/meta/0135_snapshot.json`
- `backend/drizzle/meta/0136_snapshot.json`
- `backend/src/db/schema.ts`
- `backend/src/services/adjustment-governance.service.ts`
- `backend/src/services/trip-financial-authority-lock.service.ts`
- `backend/src/services/debit-note-lifecycle.service.ts`
- `backend/src/services/financial.service.ts`
- `backend/src/services/approval.service.ts`
- `backend/src/services/advance.service.ts`
- `backend/src/routes/financial/payments.routes.ts`
- `backend/src/routes/financial/index.ts`
- `backend/src/routes/trips.ts`
- `shared/src/schemas/index.ts`
- `shared/src/index.ts`
- `backend/src/tests/q18-adjustment-governance.test.ts`
- `backend/src/tests/forwarder-settlement-workflow.test.ts`
- `backend/src/tests/comprehensive.test.ts`

## Migration evidence

- The additive 0136 migration upgrades a real 0135-shaped fixture and backfills
  its existing corrected link with exact before/after values, reason, actor,
  and approval linkage.
- A fresh isolated database migrates through the complete 0000-0136 chain.
- The resulting history table has the expected 13 columns.
- The local shared test database had no migration-ledger history despite already
  containing the schema, so the direct local migrate attempt is preserved as a
  red environment artifact. It was not used as proof. The isolated upgrade and
  fresh-chain reruns are the valid migration proofs.
- The second-review fixes change services and tests only. They do not modify
  schema, migration 0135, migration 0136, or either snapshot; the prior isolated
  upgrade and fresh-chain proofs remain applicable unchanged.

Migration evidence:

- `qa/2026-07-27_q18-adjustment-governance_0136-upgrade-proof.rerun.log`
- `qa/2026-07-27_q18-adjustment-governance_0136-fresh-migrate.rerun.log`
- `qa/2026-07-27_q18-adjustment-governance_0136-upgrade-migrate.log`

## Verification

- Q18/Q15 focused governance and related finance tests: 44/44 green.
- Compatibility suites covering approval, invoice, concurrency, and fuel
  guards: 59/59 green.
- Public HTTP adjustment and reopen boundaries: comprehensive flow 7/7 green,
  including missing-version 400 checks.
- Backend, shared, and frontend typechecks: green.
- Frontend suite: 62 files / 327 tests green.
- Lint: 0 errors; 23 warnings outside the corrected Q18 surface.
- Production build: green.
- Full backend suite: 1,509/1,510 green. The sole failure is the separately
  owned Q04 app-settings email route (`500 !== 200`); all Q18 and compatibility
  cases pass. This prevents claiming the repository-wide backend gate green but
  is not a Q18 regression.

Final evidence:

- `qa/2026-07-27_q18-adjustment-governance_second-rereview-regressions.red.log`
- `qa/2026-07-27_q18-adjustment-governance_second-rereview-focused-test.log`
- `qa/2026-07-27_q18-adjustment-governance_second-rereview-compatibility-test.log`
- `qa/2026-07-27_q18-adjustment-governance_second-rereview-backend-typecheck.log`
- `qa/2026-07-27_q18-adjustment-governance_second-rereview-lint.log`
- `qa/2026-07-27_q18-adjustment-governance_final-rereview-focused-test.log`
- `qa/2026-07-27_q18-adjustment-governance_final-rereview-focused-test.rerun.log`
- `qa/2026-07-27_q18-adjustment-governance_final-rereview-backend-typecheck.log`
- `qa/2026-07-27_q18-adjustment-governance_final-rereview-lint.log`
- `qa/2026-07-27_q18-adjustment-governance_rereview-focused-test.final.log`
- `qa/2026-07-27_q18-adjustment-governance_rereview-compatibility-test.log`
- `qa/2026-07-27_q18-adjustment-governance_public-boundary-test.rerun.log`
- `qa/2026-07-27_q18-adjustment-governance_rereview-backend-typecheck.final.log`
- `qa/2026-07-27_q18-adjustment-governance_rereview-shared-typecheck.log`
- `qa/2026-07-27_q18-adjustment-governance_rereview-frontend-typecheck.log`
- `qa/2026-07-27_q18-adjustment-governance_rereview-frontend-test.log`
- `qa/2026-07-27_q18-adjustment-governance_rereview-lint.rerun.log`
- `qa/2026-07-27_q18-adjustment-governance_rereview-build.log`
- `qa/2026-07-27_q18-adjustment-governance_rereview-backend-test-full.rerun.log`
- `qa/2026-07-27_q18-adjustment-governance_rereview-self-review.md`

## Scope boundary

This slice does not create a generic workflow engine, implement Q17 shipment
versioning, or add a frontend governance work queue. It also does not modify
Q04 app-settings/email behavior. Those remain separate plan ownership areas.

The final independent verdict is recorded in
`qa/2026-07-27_q18-adjustment-governance_independent-review.md`. It verifies
the document/source/trip lock order, authoritative line re-read, concurrent
issue-versus-replacement invariant, checker invalidation, and correction
maker/checker/approver separation.
