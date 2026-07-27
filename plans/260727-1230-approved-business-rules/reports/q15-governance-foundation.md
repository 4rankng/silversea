# Q15 Governance Foundation — Tranche 1

Status: DONE_WITH_CONCERNS

## Delivered

- Added an additive governance-action contract with explicit subject, action,
  status, capability, actor-role snapshot, reason, evidence, optimistic version,
  application result, and audit timestamps.
- Added reusable policy and transition services. Policies declare the maker,
  checker, and approver capabilities plus evidence, source-version, and
  threshold requirements. Transitions enforce pairwise actors, current
  capability, locked status/version guards, and durable reject/return/cancel
  reasons.
- Added financial-role-protected inbox and detail routes with server-derived
  `allowedActions`, plus reject, return-for-evidence, and cancel routes.
- Kept the domain effect behind a transaction-bound adapter, so approval and
  the business mutation either commit together or roll back together.
- Refactored Q18 trip AR adjustments and exceptional trip reopen approvals onto
  the shared foundation without changing their public route behavior.
- Preserved legacy Q18 multiple-request behavior while enforcing one active
  action per subject ID for future governance action kinds.
- Added focused regression coverage for actor separation, capabilities, role
  snapshots, evidence return, version/status guards, durable decisions,
  concurrency, rollback, authorization, and active uniqueness.

## Main files

- `shared/src/schemas/governance-action.ts`
- `shared/src/schemas/index.ts`
- `shared/src/index.ts`
- `backend/src/db/schema.ts`
- `backend/drizzle/0139_q15_governance_foundation.sql`
- `backend/drizzle/meta/0139_snapshot.json`
- `backend/drizzle/meta/_journal.json`
- `backend/src/services/governance-policy.ts`
- `backend/src/services/governance-transition.service.ts`
- `backend/src/services/adjustment-governance.service.ts`
- `backend/src/routes/financial/governance-actions.routes.ts`
- `backend/src/routes/financial/index.ts`
- `backend/src/tests/q15-governance-foundation.test.ts`
- `backend/src/tests/q18-adjustment-governance.test.ts`

## Verification

Green scoped evidence:

- `qa/2026-07-27_q15-governance-foundation_focused-test.log` — 9/9
- `qa/2026-07-27_q15-governance-foundation_q18-compatibility.log` — 10/10
- `qa/2026-07-27_q15-governance-foundation_shared-typecheck.log`
- `qa/2026-07-27_q15-governance-foundation_backend-typecheck.log`
- `qa/2026-07-27_q15-governance-foundation_lint.log` — 0 errors
- `qa/2026-07-27_q15-governance-foundation_frontend-typecheck.log`
- `qa/2026-07-27_q15-governance-foundation_frontend-test.log` — 331/331
- `qa/2026-07-27_q15-governance-foundation_build.log`
- `qa/2026-07-27_q15-governance-foundation_migration-generate.log`
- `qa/2026-07-27_q15-governance-foundation_migration-drift.log`
- `qa/2026-07-27_q15-governance-foundation_diff-check.log`
- `qa/2026-07-27_q15-governance-foundation_review.md`

Earlier isolated migration upgrade and fresh-chain runs passed and are retained
in:

- `qa/2026-07-27_q15-governance-foundation_migration-upgrade.log`
- `qa/2026-07-27_q15-governance-foundation_fresh-migration.log`

Migration 0139 was subsequently regenerated to include the final future-action
subject-ID uniqueness index. Its final form is drift-clean, and the index is
covered by focused tests, but the controller must repeat both REAL migration
proofs against that final file before landing.

The concurrent full backend run reached 1,578/1,579. Its sole failure was in
the separately owned Q23 penalty-cancellation audit-count test, where shared
database interference produced four matching rows instead of two. Per
controller direction, that run is not treated as a valid repository-wide Q15
gate; the controller will rerun the isolated Q23 case and full suite
sequentially after all database users are idle.

## Scope boundary

This tranche does not implement Q22 authority consumers, Q23 payment or trip
commands, a governance frontend, deployment, or a generic workflow engine.
Existing check/approve HTTP endpoints remain at their compatible Q18 paths.

## Landing requirements

- Final REAL migration 0139 upgrade proof
- Final fresh-database journal proof
- Sequential full backend suite
- E2E
- Independent controller review after concurrent changes settle

Status: IN_PROGRESS
Summary: The reusable Q15 governance foundation and Q18 migration are
implemented and scoped-green. Final shared-database, E2E, migration-journal,
and independent-review landing gates remain controller-owned.
Concerns/Blockers: Do not claim repository-wide completion until those final
sequential gates are green.

## Controller review-blocker follow-up

The three blockers from
`qa/2026-07-27_q15-governance-foundation_independent-review.md` are now closed
at the scoped level:

- legacy check/approve routes validate positive action IDs with
  `parseActionId()` and parse `expectedVersion` through the shared
  `governanceActionVersionSchema`;
- the Q15/Q18 HTTP and service suites pass 20/20, including malformed IDs,
  malformed versions, actor separation, concurrency, rollback and Q18
  compatibility
  (`qa/2026-07-27_q15-route-validation_backend-test.rerun.log`);
- the final 0139 file passed a real 0138→0139 upgrade rehearsal with a
  pre-existing Q18 row, and a separate zero→0139 fresh-chain rehearsal. The
  first proof-harness attempt is retained red and the corrected asserted run
  is retained green:
  `qa/2026-07-27_q15-governance-foundation_final-migration-proof.log` and
  `qa/2026-07-27_q15-governance-foundation_final-migration-proof.rerun.log`.

Repository-wide gates and independent GO review remain deferred until all
concurrent Q01–Q23 implementation lanes settle.
