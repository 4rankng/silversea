# Q23 forwarder create replay diagnosis and fix

**Date:** 2026-07-28  
**Scope:** `backend/src/tests/q23-forwarder-create-replay.test.ts`  
**Status:** implementation and focused verification complete; backend typecheck rerun pending an unrelated concurrent fix

## Exact symptom

The natural focused command did not exit:

```text
COMMAND: cd backend && gtimeout 45s npx tsx --test --test-concurrency=1 src/tests/q23-forwarder-create-replay.test.ts
...
Interrupted while running
EXIT_STATUS=124
```

A diagnostic run with `--test-timeout=5000 --test-force-exit` exposed three
failures:

1. advance-request replay differed only at `replayed: true` versus the original
   `replayed: false`;
2. advance-settlement replay differed only at the same replay marker; and
3. teardown failed with PostgreSQL `23503` because the approved advance request
   remained referenced by `advance_settlement_requests`.

Evidence:

- `qa/2026-07-28_team-q23-forwarder-create_red.log`
- `qa/2026-07-28_team-q23-forwarder-create_diagnosis-red.log`

## Root cause

The route and idempotency service were behaving according to the established
Q23 contract: first execution returns `replayed: false`, and an exact replay
returns the same stored result with `replayed: true`.

The test incorrectly required byte-for-byte equality including that diagnostic
marker. Because the assertions ran before the created settlement ID was added
to the teardown set, either assertion failure left settlement links
undiscovered. The linear `after()` hook then attempted to delete the referenced
advance request, raised a foreign-key error, and never reached
`disconnectRedis()` or `client.end()`. Those skipped resource closures caused
the post-file hang.

The failure appeared now because the forwarder create routes were updated to
use `runIdempotent()` with persisted `201` response status and an explicit
per-response replay marker.

## Fix

- Added `assertReplayBody()` to assert `false → true` replay-marker semantics
  while proving every persisted entity field is identical.
- Made teardown discover all settlements owned by the test's unique forwarder
  directly from the database, rather than depending on bookkeeping that an
  earlier assertion could skip.
- Kept foreign-key deletion order explicit: settlement expenses and request
  links, settlements, then advance requests.
- Made teardown operations failure-safe: the first cleanup error is retained,
  but server, Redis, and PostgreSQL closure are all attempted before that error
  is rethrown.

No forwarder route or service behavior changed.

## Verification

Focused natural-exit proof:

```text
tests 2
pass 2
fail 0
duration_ms 721.015041
ELAPSED_SECONDS=2
EXIT_STATUS=0
```

Artifact:
`qa/2026-07-28_team-q23-forwarder-create_focused-test.log`

Backend typecheck was run and is currently blocked outside this task's
ownership:

```text
src/routes/shipments.ts(237,17): error TS2304: Cannot find name 'ApiError'.
EXIT_STATUS=2
```

Artifact:
`qa/2026-07-28_team-q23-forwarder-create_backend-typecheck.log`

The controller was notified so the concurrent shipment-route owner can restore
the missing import. Typecheck must be rerun green before this task is closed.

Status: DONE_WITH_CONCERNS

Summary: Replay assertions and teardown/open-handle cleanup are fixed; focused test exits naturally.

Concerns/Blockers: Backend typecheck is blocked by an unrelated missing `ApiError` import in `routes/shipments.ts`.
