# Q23 trip immutable replay

## Outcome

Completed the remaining trip-route Q23 replay tranche. All material writes
exposed by `backend/src/routes/trips.ts` now use the shared `runIdempotent`
boundary, so the business effect and immutable response snapshot commit or
roll back together.

## Implemented route coverage

Newly wrapped:

- `POST /api/trips/pairs`
- `POST /api/trips/bulk-figures`
- `DELETE /api/trips/:id`
- `PUT /api/trips/:id/pre-departure`
- `PUT /api/trips/:id/actuals`
- `PATCH /api/trips/:id/reassign`
- `POST /api/trips/:id/unlock`
- `PATCH /api/trips/:id/departure-date`
- `POST /api/trips/:id/adjustment`
- `PUT /api/trips/:id/containers`
- `PUT /api/trips/:id/instructions`
- `POST /api/trips/:id/expenses`
- `PUT /api/trips/:id/expenses/:eid`
- `DELETE /api/trips/:id/expenses/:eid`

The earlier Q23 tranche already wrapped trip create, copy,
dispatch/complete/lock/cancel, and trip-expense approve/reject. The route
inventory now has no remaining material write outside the shared idempotency
mechanism.

## Transaction and replay contract

- Optional caller transactions were threaded through trip figure updates,
  reassignment, departure-date change, delete, instruction upsert, container
  reconciliation, guarded expense deletion/audit lookup, trip reopen request,
  and trip AR adjustment request.
- Existing callers without a transaction retain their original standalone
  transaction behavior.
- Identical keyed retries return the stored business response snapshot even
  after the live entity changes. The response-level `replayed` flag remains
  different so audit middleware can distinguish `SUCCEEDED` and `REPLAYED`;
  all stored business fields are byte-equivalent after JSON serialization.
- Reusing a key with changed input returns 409.
- A failed mutation rolls back both the business effect and the receipt, so
  the same key can be retried after the request is corrected.
- Concurrent identical trip-expense creates serialize to one expense and one
  idempotency receipt.
- Bulk figures retain the existing per-row result contract while every
  successful row and the final response snapshot share the receipt
  transaction.
- Cache invalidation runs only for the first successful effect. Existing
  lifecycle code continues to suppress replayed attendance, notification, and
  GPS hooks.
- Trip cancel keeps its existing controlling-row lock, conditional status
  claim, version bump, single reversal, and first-winner behavior.

## Preserved governance

- No role, Casbin, optimistic-version, row-lock, or lifecycle permission was
  relaxed.
- Q18 governed reopen and adjustment creation still execute their existing
  validations, now inside the caller's idempotency transaction.
- Approved trip expenses remain immutable and continue to require governed
  adjustment.
- No shipment, configuration, frontend, schema, migration, or idempotency
  constant was changed by this workstream.

## Tests and evidence

New focused route tests:

- immutable instruction replay after the stored row changes;
- same key with changed instruction payload returns 409;
- concurrent same-key expense create persists one expense and one receipt;
- failed stale-version transaction leaves no receipt and a corrected retry
  succeeds.

Green evidence:

- `qa/2026-07-27_q23-trips-replay_focused-backend-test.log`
  - 12/12 pass across the new suite and the earlier Q23 trip-write suite.
- `qa/2026-07-27_q23-trips-replay_typecheck-backend.log`
  - backend TypeScript exit 0.
- `qa/2026-07-27_q23-trips-replay_lint.log`
  - exit 0, 0 errors, 21 pre-existing warnings.
- `qa/2026-07-27_q23-trips-replay_build.log`
  - shared/backend/frontend build exit 0.
- `qa/2026-07-27_q23-trips-replay_review.md`
  - author review verdict `GO_FOR_INTEGRATION_RETEST`.

Red evidence retained for the controller:

- `qa/2026-07-27_q23-trips-replay_backend-test.log`
  - full backend run: 1,604/1,624 passed; 20 failures came from concurrent
    debit-note, no-invoice-policy, expense-approval, salary-period, and period
    authority work. The focused Q23 trip suites passed within this run.
- `qa/2026-07-27_q23-trips-replay_affected-backend-test.log`
  - a later rerun was blocked at module load because the active debit-note
    workstream temporarily removed
    `backend/src/services/billing-document-governance.service.ts` while
    `adjustment-governance.service.ts` still imported it. This is concurrent
    ownership drift; this workstream did not modify or restore that module.

The controller must rerun backend typecheck/tests and independent review after
all parallel workstreams settle. No deployment was performed.

Status: DONE_WITH_CONCERNS
Summary: The trip route now has complete atomic immutable replay coverage, and
the focused contract, typecheck, lint, and build gates were green before
concurrent integration drift.
Concerns/Blockers: Repository-wide backend green and independent integration
review remain controller-owned after the debit-note module is restored and
parallel fixtures stabilize.

