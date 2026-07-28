# Final fresh independent review

**Date:** 2026-07-28  
**Review base:** `origin/main` versus the current worktree  
**Decision:** **NO-GO for deployment**

The migration-compatibility and cross-user query-cache blockers found during
this review were fixed and focused red-to-green evidence was saved. One
security blocker remains: the frontend still presents logout as complete after
server revocation fails, even though the default seven-day JWT can remain
valid. The final dirty snapshot also does not yet have the complete affected
green gate set required by this repository.

The full line-level review is in
`qa/2026-07-28_final-fresh_review.md`.

## Remaining release blockers

1. **Failed server revocation is swallowed.** The frontend clears the local
   token even when `/auth/logout` never reaches the server or returns the
   revocation `503`. Neither side retains a durable retry command, so a copied
   token can become valid after Redis/network recovery.
2. **Final full-gate evidence is incomplete.** The durable-effect integration
   report records focused tests/typecheck only and explicitly excludes the full
   backend, lint, build, integration, and E2E gates. The latest cache/migration
   fixes have focused green evidence, not a final complete release set.

## Blockers resolved during review

- Historical `0138` was restored (apart from a trailing newline) and new
  forward-only `0158_payment_allocation_due_date_snapshots.sql` adds the three
  payment-allocation snapshot columns with `IF NOT EXISTS`. Migration evidence
  and the Q22 11/11 proof are green.
- Logout and login now remove every TanStack query except `auth.me`, preventing
  protected data from crossing users. The focused test is green 3/3 after its
  recorded red-to-green fix loop, and frontend typecheck is green.

## Non-blocking corrections

- Add an operational alert/remediation surface for `durable_effect_jobs` in
  `DEAD`; the scheduler currently emits only an informational batch summary.
- Restore the Drizzle snapshot chain after migrations `0153`-`0158`.
- Remove or require a cleanup-guard capability in the exported direct-write
  helpers `saveTripPhoto`, `saveCompanyLogo`, and `persistOcrPhoto`.
- Correct stale comments saying `403` triggers logout and that the backend owns
  retryable logout revocation.

## Verified closures from the prior review

- Authenticated `403` no longer destroys the session.
- Recursive audit sanitization removes password/token/credential/key fields.
- Material-write registry coverage includes reviewed generated CRUD, explicit
  idempotent mutations, and forwarder routes.
- Profit distribution is serializable, quarter-scoped, fingerprinted, and
  retried with safe conflict output.
- Durable storage/cache effects are transactionally enqueued, leased, fenced,
  retried, and reference-checked; reviewed upload/delete routes use guard/final
  delete jobs.
- Local filesystem operations enforce root containment.
- Docker runtime/build-context pruning uses Dockerfile-specific allowlists and
  production dependency deployment.

## Plan status recommendation

Do not mark this plan complete. `plan.md` remains `in-progress`; phases 2-8 are
not complete, multiple phase acceptance checkboxes remain open, and phase 8
still requires full gates, the complete Q01-Q23/O01/O02 proof matrix,
responsive cross-role evidence, staging verification, and an independent GO.

## Required re-entry gate

Define and implement durable/observable failed-revocation semantics, add its
recovery/replay proof, then run every affected root/backend/frontend/build/E2E
gate against the final tree and obtain a new independent review.

Status: DONE_WITH_CONCERNS

Summary: Fresh review and red-to-green blocker recheck completed; deployment remains blocked.

Concerns/Blockers: Unconfirmed logout revocation and incomplete final full-gate evidence.
