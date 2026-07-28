# Q15 trip financial governance closure

Status: slice implemented and focused gates green; integrated backend gate remains
the controller's responsibility after parallel work settles.

## Sixth-pass approved-payload binding closure

The approval identity and transaction capability were already bound, but the
low-level completed-trip edit boundary did not bind the mutation data to the
approved proposal. A caller executing inside the active approval callback could
therefore present figures different from
`governance_actions.after_snapshot.figures`.

`requirePersistedTripGovernanceAuthorization` now canonicalizes and exactly
compares the incoming business payload with the persisted approved figures
before any trip or ledger mutation. Object keys are sorted, undefined values are
omitted consistently, array order remains significant, and a missing or
non-object persisted figure snapshot fails closed.

Only the trusted execution envelope is excluded:

- `expectedVersion` is independently bound to the persisted
  `action.originalVersion`;
- `userId` and `userRole` are independently bound to the persisted final
  approver identity and role.

The adversarial regression approves revenue +X, attempts +Y from inside the real
active approval context, and proves the trip, ledger, governance status, and
governance version remain unchanged. The same checked action is then approved
through the legitimate adapter and applies +X, proving the exact positive path.

Sixth-pass evidence:

- Focused Q15 trip-governance suite: 9/9 passed.
- Trip ledger regression: 10/10 passed.
- Shared governance foundation: 12/12 passed.
- Backend typecheck: passed.
- Targeted lint and `git diff --check`: passed.

The first broad-script artifact is intentionally retained: the package test
script expanded the full backend glob despite a filename argument and exposed
unrelated concurrent failures. The first ledger run then correctly exposed
that `expectedVersion` is an injected, independently validated execution field;
after excluding that envelope field, the complete requested regression set
passed.

Sixth-pass artifacts:

- `qa/2026-07-28_q15-trip-payload-binding_focused-test.log`
- `qa/2026-07-28_q15-trip-payload-binding_ledger-test.log`
- `qa/2026-07-28_q15-trip-payload-binding_focused-test.final-green.log`
- `qa/2026-07-28_q15-trip-payload-binding_ledger-test.final.log`
- `qa/2026-07-28_q15-trip-payload-binding_foundation-test.final.log`
- `qa/2026-07-28_q15-trip-payload-binding_backend-typecheck.final2.log`
- `qa/2026-07-28_q15-trip-payload-binding_lint.final2.log`
- `qa/2026-07-28_q15-trip-payload-binding_diff-check.log`
- `qa/2026-07-28_q15-trip-payload-binding_review.md`

## Fifth-pass non-retainable approval context closure

The fourth review correctly found that the generic adapter callback could
retain the process-wide symbol passed as its third argument. This pass removes
that callback-visible value and the capability-bearing parameters entirely.

`governance-transition.service.ts` now owns a module-private `WeakMap` from the
exact transaction object to its currently active action IDs. The approval
engine activates the exact pair only around the awaited adapter call and clears
it in `finally`, whether the adapter succeeds, throws, or causes rollback.
Adapters receive only `(tx, action)`. The only exported check,
`assertActiveApprovalApplication(tx, actionId)`, can test the current binding
but exposes no authority that can be retained or replayed.

The trip adapter and low-level close, completed-edit, and completed-cancellation
boundaries require the same active transaction/action pair in addition to the
locked persisted governance checks. The hostile-adapter regression proves:

- no third callback argument is exposed;
- the exact action on the exact transaction is active only during the callback;
- a different action on the same transaction is rejected;
- the same action on a different transaction is rejected;
- a retained transaction reference is rejected after forced rollback;
- exact forged persisted APPROVED rows still cannot apply close, edit, or
  cancellation;
- the legitimate approval engine still completes and records the trip close
  with the GPS outbox insert in the same transaction.

Fifth-pass evidence:

- Focused Q15 trip-governance suite: 9/9 passed.
- Trip ledger regression: 10/10 passed.
- Shared governance foundation: 12/12 passed.
- Backend typecheck: passed.
- Targeted lint and `git diff --check`: passed.
- Existing GPS retry/outbox tests remained green.

Fifth-pass artifacts:

- `qa/2026-07-28_q15-trip-financial-governance-fifth-pass_backend-test.log`
- `qa/2026-07-28_q15-trip-financial-governance-fifth-pass_backend-test.rerun.log`
- `qa/2026-07-28_q15-trip-financial-governance-fifth-pass_regression.log`
- `qa/2026-07-28_q15-trip-financial-governance-fifth-pass_static.log`

## Fourth-pass approval provenance closure

The third independent review proved that an exact persisted `APPROVED` row
could still be manufactured inside a caller-owned transaction. Persisted values
therefore remain necessary state validation, but they are no longer sufficient
apply authority.

The approval transition now owns a module-private `Symbol` capability. Its
value is never exported. `approveGovernanceActionWithAdapter` is the only code
that passes the capability to an apply adapter, and the exported validator can
only compare a received value against the private symbol. The trip governance
adapter validates it before dispatch, and the close, completed-edit, and
completed-cancellation low-level boundaries validate it before checking the
persisted action.

Rollback-safe negative probes now forge the exact accepted database shape,
including the matching approver identity and role, for all three financial
operations. Before this change the close probe reached the mutation
(`actual: true`); after the change all three fail without the capability. A
positive service-level approval test proves that the real approval engine
receives the capability, completes the trip, records application, and commits
the durable GPS job atomically.

Fourth-pass evidence:

- Focused Q15 trip-governance suite: 9/9 passed.
- Trip ledger regression: 10/10 passed.
- Shared governance foundation: 12/12 passed.
- Backend typecheck: passed.
- Targeted lint and `git diff --check`: passed.
- GPS outbox, retry, stale-lease, derivation-failure, and deduplication coverage
  remained green.

Fourth-pass artifacts:

- `qa/2026-07-28_q15-trip-financial-governance-fourth-pass_backend-test.log`
- `qa/2026-07-28_q15-trip-financial-governance-fourth-pass_backend-test.rerun.log`
- `qa/2026-07-28_q15-trip-financial-governance-fourth-pass_regression.log`
- `qa/2026-07-28_q15-trip-financial-governance-fourth-pass_static.log`

## Third-pass trust boundary and GPS durability closure

The independent re-review found two remaining blockers. This pass closes both:

- Trip close, completed-trip edit, and completed-trip cancellation no longer
  accept a caller-supplied governance row as authorization. The mutation
  services accept only a stable action ID, reload and lock the persisted action,
  and require the correct subject, kind, original version, unapplied state,
  persisted approval, matching approver identity/role, and pairwise-distinct
  maker/checker/approver.
- Trip approval establishes the short-lived apply authorization inside the same
  transaction, invokes the mutation once, then records the application result.
  Any mutation failure rolls the approval back.
- Trip-close approval transactionally inserts one durable GPS capture job before
  it can succeed. `no_car_id`, capture errors, empty capture, derivation errors,
  and zero matched legs are retained as retryable failures. A leased worker
  retries due/stale jobs and marks successful delivery idempotently.
- Legacy ledger tests now build completed trips through the real governed close
  workflow; direct completion remains covered as an explicit negative case.

Third-pass evidence:

- Focused trip-governance suite: 8/8 passed.
- Trip ledger regression: 10/10 passed.
- Governance foundation regression: 12/12 passed.
- Targeted lint and `git diff --check`: passed.
- Migration `0155_q15_trip_gps_capture_jobs`: initial apply and freshness rerun
  passed. It follows the concurrent journal-owned `0154` migration.
- Backend repository typecheck remains red only in unrelated concurrent pricing
  and CRUD-factory surfaces; no Q15 error was reported.

Third-pass artifacts:

- `qa/2026-07-28_q15-trip-financial-governance-third-pass_backend-test.log`
- `qa/2026-07-28_q15-trip-financial-governance-third-pass_backend-test.rerun.log`
- `qa/2026-07-28_q15-trip-financial-governance-third-pass_lint.txt`
- `qa/2026-07-28_q15-trip-financial-governance-third-pass_migration.log`

## Independent-review remediation

The subsequent production-readiness review found seven gaps. The Q15 follow-up
now closes them:

- direct service completion requires the authoritative approved close action;
- request and final audit semantics are distinct and covered through the real
  audit middleware;
- completed cancellation snapshots and zeros the complete financial field set;
- all affected frontend surfaces collect a user-entered rationale;
- close/cancel participate in the material-write registry and preserve `202`
  across exact replay;
- attendance and notification are atomic with approval, while GPS retries from
  the durable approved action on every replay;
- bulk edits return pending governance actions for completed rows while applying
  eligible rows.

The focused public backend suite is green at 5/5 and targeted lint is clean.
Integrated typechecks are deferred only because unrelated concurrent
profit-distribution and advance-settlement changes are currently red.

## Root cause

Trip completion, completed-trip figure edits, and completed-trip cancellation
could execute their ledger posting/reversal directly from the operational route.
That allowed one actor to both request and apply a financial mutation. Completed
figure edits also reversed and reposted ledger rows before any independent
approval.

## Implemented contract

- `IN_TRANSIT -> COMPLETED` creates a `TRIP_FINANCIAL_CLOSE` action and returns
  `202`. The trip and ledger remain unchanged until a distinct checker and third
  approver apply the action.
- Money-bearing edits to a `COMPLETED` trip create a
  `TRIP_FINANCIAL_CHANGE` action. The original figures and ledger remain
  unchanged until approval.
- `COMPLETED -> CANCELED` also uses `TRIP_FINANCIAL_CHANGE`, because it reverses
  posted ledger rows. Cancellation before completion remains a direct
  operational transition.
- Direct service calls that try to edit or cancel a completed trip without the
  checked governance action fail closed with `409`.
- Version, reason, actor separation, stale-action rejection, active-action
  uniqueness, and approval idempotency are enforced.
- The winning third-actor approval calls the existing ledger authority exactly
  once. Replaying the same approval does not duplicate ledger, attendance,
  notification, or GPS side effects.
- Notes, photos, instructions, and other evidence-only updates remain direct.
- The trip detail UI sends the current version and a reason. Pending governance
  responses are not cached as trip rows and are shown as pending approval.

## Acceptance evidence

- Public route test covers maker self-check denial, checker self-approval denial,
  third-actor apply, concurrent approval one-winner behavior, exact replay,
  viewer denial, rejection, stale approval, no pre-approval mutation, completed
  figure change, and completed cancellation.
- Ledger regressions cover freight, fuel, service-fee, customer reassignment,
  payment guard, reversal/repost, stale direct edits, and cancellation.
- Focused affected backend gate: 52/52 passed.
- Backend typecheck: passed.
- Frontend typecheck: passed.
- Frontend tests: 380/380 passed.
- Root lint: 0 errors (43 existing warnings).
- `git diff --check`: passed.

Artifacts:

- `qa/2026-07-28_q15-trip-financial-governance_backend-test.log`
- `qa/2026-07-28_q15-trip-financial-governance_backend-test-rerun.log`
- `qa/2026-07-28_q15-trip-financial-governance_typecheck-backend.log`
- `qa/2026-07-28_q15-trip-financial-governance_typecheck-frontend.log`
- `qa/2026-07-28_q15-trip-financial-governance_frontend-test.log`
- `qa/2026-07-28_q15-trip-financial-governance_lint.log`
- `qa/2026-07-28_q15-trip-financial-governance_backend-full-test.log`

## Explicit boundary

This slice closes the trip completion/edit/cancellation ledger bypass only. It
does not claim all Q15 domains are complete. Company expenses, fuel/credit
governance, profit distribution, generated pricing authority, and other Q15
audit findings remain owned by their respective slices.

The repository-wide backend test run was red in unrelated and concurrently
modified suites. All failures attributable to this trip-governance contract were
updated and proved green in the focused 52-test rerun. An integrated backend
rerun is still required before release.
