# O01 trip-pair concurrency proof

**Date:** 2026-07-28
**Scope:** accepted O01 concurrent pair creation and pair-vs-lifecycle races
**Owned implementation:** `backend/src/tests/o01-trip-pair-concurrency.test.ts`
**Production source change:** none

## Expected output and boundaries

The proof must launch real concurrent database transactions for:

1. the same pair with the same transaction key;
2. the same pair with different transaction keys;
3. A+B racing A+C;
4. pair creation racing cancellation;
5. pair creation racing approved completion of the first trip.

Every non-replay race must have exactly one committed operation and one HTTP-style
409 conflict. A same-key retry must replay the first committed result rather than
create a second effect. After every race:

- at most one active pair exists;
- a losing transaction leaves no `trip_pairs` row;
- both sides of an active pair point to the same pair with reciprocal order 1/2;
- an unpaired trip has both pointer fields cleared;
- every participating trip still exists and is not soft-deleted.

This task did not modify migrations, schemas, routes, frontend code, QA artifacts,
plan state, or `HANDOFF.md`. It also preserved all unrelated worktree edits.

## Diagnosis and implementation

The pre-change O01 suites were green (13/13), but none launched concurrent pair
attempts. The gap was direct executable proof, not a reproduced production-source
failure.

The new database-backed suite uses the production boundaries:

- `runIdempotent()` and `IDEMPOTENCY_ENDPOINTS.TRIP_PAIR_CREATE` for transaction-key
  serialization and replay;
- `createTripPair()` for deterministic `FOR UPDATE` locking of both trips;
- `transitionTripWriteCommand()` for versioned cancellation;
- `requestTripFinancialClose()`, `checkGovernanceAction()`, and
  `approveGovernanceAction()` for the real approved first-trip completion path.

The same-key case intentionally has two successful callers: one creates and one
returns the persisted replay (`replayed` values are exactly `false` and `true`).
All different-key and lifecycle races assert one fulfilled operation and one
rejected `ApiError` with status 409.

No change to `backend/src/services/trip-pairs.service.ts` was required. Its
deterministic row locks plus the existing trip-version increments and expected
version checks produced the required one-winner outcomes.

## Executable scenarios

| Scenario | Direct result | Persisted invariant |
|---|---|---|
| Same A+B, same key | One create + one replay, same pair ID | One active pair, reciprocal pointers |
| Same A+B, different keys | One commit + one 409 | One active pair, no losing pair row |
| A+B vs A+C | One commit + one 409 | A has one pair; losing alternative remains unpaired |
| Pair vs cancellation | One commit + one 409 | Either one active pair or A is canceled; A and B both survive |
| Pair vs approved completion | One commit + one 409 | Either one active pair or A is completed; no orphan pair and both trips survive |

## Verification

Pre-change focused baseline:

```text
cd backend &&
npx tsx --test --test-concurrency=1 \
  src/tests/o01-trip-pairing.service.test.ts \
  src/tests/o01-trip-pairs.routes.test.ts
```

Result: **13 tests, 2 suites, 13 passed, 0 failed, exit 0**.

New race suite:

```text
cd backend &&
npx tsx --test --test-concurrency=1 \
  src/tests/o01-trip-pair-concurrency.test.ts
```

Result: **5 tests, 1 suite, 5 passed, 0 failed, exit 0**.

Focused O01 regression suite after the test addition:

```text
cd backend &&
npx tsx --test --test-concurrency=1 \
  src/tests/o01-trip-pairing.service.test.ts \
  src/tests/o01-trip-pairs.routes.test.ts \
  src/tests/o01-trip-pair-concurrency.test.ts
```

Result: **18 tests, 3 suites, 18 passed, 0 failed, exit 0**.

Race stability check:

```text
cd backend &&
for run in 1 2 3 4 5; do
  npx tsx --test --test-concurrency=1 \
    src/tests/o01-trip-pair-concurrency.test.ts
done
```

Result: **5/5 complete runs passed; 25/25 race cases passed, exit 0**.

Focused lint:

```text
pnpm exec eslint backend/src/tests/o01-trip-pair-concurrency.test.ts
```

Result: **0 errors, exit 0**.

Backend typecheck:

```text
cd backend && npx tsc --noEmit
```

Result: **exit 2** because the concurrent, out-of-scope
`backend/src/services/user.service.ts` edit references `customerAccountType`,
which is absent from its inferred update input type at lines 643 and 645. After
correcting the only initial type mismatch in the owned race test, the rerun
reported no error in `o01-trip-pair-concurrency.test.ts`.

`git diff --check` passed, and the new test contains no skip, TODO, stub, or
placeholder.

## Review

Self-review found no production contract change and no test-only bypass of the
pairing authority. The completion race uses the real maker/checker/approver
application path; cancellation uses the production command boundary. Cleanup
removes the created governance, ledger, notification, workday, idempotency,
pair, trip, and fixture rows in foreign-key-safe order.

Status: DONE_WITH_CONCERNS
Summary: All five accepted O01 concurrency scenarios now have deterministic executable proof, and the complete focused O01 suite passes.
Concerns/Blockers: Repository-wide backend typecheck remains red only in the concurrent out-of-scope `user.service.ts` customer-account-type edit.
