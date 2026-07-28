# Q23 shipment immutable replay

**Date:** 2026-07-27  
**Owner:** `q23_shipments_replay`  
**Status:** DONE

## Delivered

- Added atomic immutable response replay to 11 material shipment writes:
  create, update, transition, dispatch, document attach/replace, declaration
  create/update, container reconcile, change-request review, and delete.
- Reused the existing stable shipment endpoint constants and shared
  `runIdempotent()` implementation.
- Bound replay identity to authenticated actor, route resource identifiers,
  and validated request data.
- Persisted an internal response envelope containing the original status,
  body, and audit identity, so exact replay does not depend on current entity
  state.
- Added optional caller transactions to shipment service mutations, avoiding
  nested transaction boundaries.
- Made keyed dispatch atomic across trip creation/linking, shipment-container
  snapshot, shipment transition/history, and replay snapshot persistence.
  Notification and report-cache side effects execute only for the first
  committed result.
- Preserved all existing validation, RBAC, clerk scope, optimistic versions,
  lifecycle guards, and public response body contracts.

## Focused proof

`backend/src/tests/q23-shipment-idempotency.test.ts` proves:

1. Same key and same create payload returns the exact original `201` JSON and
   creates one shipment row.
2. Same key and different create payload returns `409`.
3. A keyed update replays its immutable version-2 response after a separate
   unkeyed write advances the shipment to version 3.
4. A mismatched reuse returns the key-conflict `409` before the stale version
   guard, without changing the persisted version-3 row.

The broader shipment matrix also verifies audit events, RBAC, clerk scoping,
stale versions, transitions, document replacement races, declarations,
container reconciliation, dispatch races, change-request first-winner
behavior, and delete guards.

## QA evidence

- `qa/2026-07-27_q23-shipments-replay_backend-typecheck.log`
  - initial harness variable-name error recorded;
  - immediate rerun: exit 0.
- `qa/2026-07-27_q23-shipments-replay_focused-test.log`
  - 115 passed, 0 failed, exit 0.
- `qa/2026-07-27_q23-shipments-replay_backend-test.log`
  - full integration run preserved: 1,600 passed, 20 failed, exit 1;
  - failures are in concurrent out-of-scope financial/settlement/salary/
    governance files;
  - no shipment test failed;
  - controller will rerun the full backend suite after all streams settle.
- `qa/2026-07-27_q23-shipments-replay_review.md`
  - owned-slice self-review: GO;
  - independent reviewer could not start because the controller agent tree
    was at its thread limit.

## Scope boundary

No schema, migration, idempotency constant, shared contract, frontend, RBAC,
or unrelated service file was changed by this slice.
