# Q23 trip write idempotency

## Outcome

Implemented the trip-only P1 effect-idempotency and stale-write tranche without
changing the shared idempotency service or crossing into financial, shipment,
salary/advance, frontend, Docker, deployment, or HANDOFF ownership.

## Implemented contracts

- `POST /api/trips`
  - optional `Idempotency-Key`;
  - concurrent same-key creates produce one trip;
  - same key/different payload returns 409;
  - no-key response and behavior remain compatible.
- `POST /api/trips/:id/copy`
  - same keyed effect contract as create.
- `POST /api/trips/:id/dispatch|complete|lock|cancel`
  - same-key transition effect executes once;
  - replay suppresses duplicate attendance, notification, cache, and GPS hooks;
  - optional positive `expectedVersion` rejects stale transitions before mutation;
  - successful material transitions advance `trips.version`;
  - cancel remains first-winner, reverses at most once, and zeros financial values.
- `PATCH /api/trips/:id/reassign`
  - locks the trip row, checks optional `expectedVersion`, then updates/version-bumps.
- `PATCH /api/trips/:id/departure-date`
  - locks the trip row and rejects stale writes before date mutation.
- `DELETE /api/trips/:id`
  - locks the trip row and accepts optional `expectedVersion` from query or body.
- `PUT /api/trips/:id/containers`
  - shared payload accepts optional `expectedVersion`;
  - parent trip lock/version check, child reconciliation, and parent version bump
    are one transaction.
- `PUT /api/trips/:id/instructions`
  - same parent lock/version/bump transaction contract as containers.
- Pre-departure, actuals, and bulk figures retain their existing row-level
  optimistic-version checks.

## Transaction and replay behavior

Trip create/copy/status services now accept an existing transaction so the business
effect and idempotency row commit or roll back together. The legacy exported
commands remain available and keep their no-key behavior.

Keyed HTTP responses include `replayed: false|true`; the audit middleware therefore
records `SUCCEEDED` versus `REPLAYED`, while 409 responses remain
`MUTATION_CONFLICT`.

`POST /api/trips` now also sets `res.locals.auditEntityId` from the
created/replayed trip before sending the response. Both successful audit rows
therefore bind to the persisted trip instead of recording a null entity id.

The actor id is part of each payload hash. Reusing another actor's key cannot replay
their request; it conflicts instead.

## Tests

Added `backend/src/tests/q23-trip-write-idempotency.test.ts` covering:

- created and replayed `POST /api/trips` audit rows carry the returned trip id;
- keyed create/copy effect deduplication and no-key compatibility;
- concurrent keyed dispatch with one version transition;
- same-key/different-payload conflict;
- transaction rollback and successful same-key retry after failure;
- cancel first-winner and no financial resurrection;
- stale reassignment/departure/delete rejection;
- container/instruction parent-version serialization.

The comprehensive lifecycle test now carries the dispatch response version into
the subsequent actuals write.

Verification:

- backend full suite: 1563/1563 pass;
- final targeted suite: 14/14 pass;
- backend typecheck: pass;
- frontend typecheck: pass;
- root lint: 0 errors (21 unrelated existing warnings).

Independent-review blocker closure:

- pre-fix route regression: 7/8 pass; both trip-create audit rows had
  `entityId = null`;
- post-fix route regression: 8/8 pass; created and replayed audit rows both
  carry the returned trip id;
- backend typecheck: pass;
- root lint: 0 errors (21 unrelated existing warnings);
- no response status, body branch, no-key behavior, command contract, or
  database schema changed.

Artifacts:

- `qa/2026-07-27_q23-trip-write-idempotency_focused-test.log`
- `qa/2026-07-27_q23-trip-write-idempotency_backend-test.log`
- `qa/2026-07-27_q23-trip-write-idempotency_typecheck.log`
- `qa/2026-07-27_q23-trip-write-idempotency_lint.log`
- `qa/2026-07-27_q23-trip-write-idempotency_review.md`
- `qa/2026-07-27_q23-trip-write-idempotency_review-fix-focused-test.log`
- `qa/2026-07-27_q23-trip-write-idempotency_review-fix-typecheck.log`
- `qa/2026-07-27_q23-trip-write-idempotency_review-fix-lint.log`
- `qa/2026-07-27_q23-trip-write-idempotency_review-fix.md`

## Explicit deferral

The current shared helper persists only `(entityType, entityId)` and reloads the
current entity. It does not store an immutable response snapshot. This tranche
therefore does not claim:

- exact historical replay after the returned trip is later mutated;
- exact response replay for multi-row bulk-figures, container, or instruction
  responses.

Adding a trip-specific receipt table would duplicate the shared mechanism and was
rejected as scope creep. A generic stored-response capability must be added by the
shared idempotency owner before these response-level contracts can close.

## Plan status recommendation

Mark the trip command effect-idempotency/stale-write sub-tranche complete. The
independent review's trip-create audit-binding blocker is closed. Keep the overall
Q23 material-write item open for the stored-response capability and the remaining
endpoint families.
