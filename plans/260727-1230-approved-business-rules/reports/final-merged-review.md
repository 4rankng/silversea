## Final Merged Independent Review

### Decision

**NO-GO for the snapshot reviewed on 2026-07-28.**

The full evidence and line-level findings are recorded in `qa/2026-07-28_final-merged_review.md`. This plan report summarizes the release blockers:

1. Material-write auditing is not structurally exhaustive; undeclared idempotent mutations can commit without fail-closed in-transaction audit.
2. Password-change bodies can persist `currentPassword` and `newPassword` in plaintext audit metadata.
3. The browser logout path does not call server-side token revocation.
4. Password-change replay skips revocation after a post-commit Redis failure.
5. Ephemeral post-commit governance effects are deleted before execution and are not recreated on idempotent replay.
6. External-storage cleanup has no durable outbox/worker and can be lost after dual failure.

Non-blocking corrections:

- Do not expose raw PostgreSQL serialization messages through `ApiError.details`.
- Do not convert valid 403 authorization failures into logout/session destruction.

### Verified Closures

- Exact-actor legacy idempotency replay
- SQL-aggregated credit exposure and batched governance lookup
- Serializable profit distribution with bounded retry and source fingerprint
- Issued official-identity locking and labeled legacy backfill
- Empty payroll-scope rejection
- Governed material settings/catalog paths reviewed in the prior closure pass
- Correct debit-template pending UI state
- Natural test runner exit
- Docker build-context exclusions and production-only runtime copy pattern

### Required Re-entry Gate

After fixes, rerun all affected QA gates and obtain a fresh independent review. This report does not approve the later worker snapshot.

Status: DONE_WITH_CONCERNS

Summary: Review artifacts saved; release remains blocked pending durable/security fixes and full red-to-green verification.

Concerns/Blockers: See `qa/2026-07-28_final-merged_review.md`.
