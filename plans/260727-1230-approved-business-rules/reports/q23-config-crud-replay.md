# Q23 generated configuration CRUD replay

**Date:** 2026-07-27  
**Scope:** all resources registered through `createCrudRouter()`  
**Status:** DONE_WITH_CONCERNS

## Delivered

- Generated create/update/delete writes now require a material-command
  idempotency key and use the stable endpoint namespace
  `config.<drizzle-table-name>.<operation>`.
- The existing immutable `response_snapshot` authority is reused, so exact
  response bodies survive later entity changes without a new migration.
- The generic row mutation, first-winner advisory lock, immutable result
  persistence, and transaction-aware hooks share one database transaction.
- Same key with another canonical payload returns 409.
- Customer/supplier mirror, partner sync, and supplier taxonomy hooks now use
  the generic transaction, avoiding both partial commits and a second
  connection waiting on an uncommitted generated row.
- Existing direct-backend tests for customer and business-calendar writes now
  send explicit stable keys. Production frontend mutations already receive
  generated keys from the shared API client behavior.
- `/pricing-tables` remains registered on the dedicated governed router; this
  implementation does not restore a generic bypass.

No schema, migration, frontend page, pricing-governance service, trip,
shipment, or billing change was made by this lane.

## Proof

`backend/src/tests/q23-config-crud-idempotency.test.ts` proves:

1. missing keys are rejected;
2. a financial-authority resource (`management_fees`) replays exactly and
   rejects same-key/different-payload reuse;
3. an ordinary catalog (`routes`) has one concurrent first winner and one
   exact replay;
4. create/update/delete have independent stable endpoint namespaces;
5. the real customer-partner hook commits inside the replay transaction;
6. a failing hook rolls back the generated row, its own DB side effect, and
   the idempotency receipt.

Evidence:

- `qa/2026-07-27_q23-config-crud_backend-test.log` — 6/6 green.
- `qa/2026-07-27_q23-config-crud_q19-regression.log` — 3/3 green.
- `qa/2026-07-27_q23-config-crud_lint.log` — green.
- `qa/2026-07-27_q23-config-crud_review.md` — bounded review GO.
- `qa/2026-07-27_q23-config-crud_backend-typecheck.log` — red only on the
  concurrent debit-note lane's new test typing.
- `qa/2026-07-27_q23-config-crud_comprehensive-regression.log` — blocked before
  collection by the concurrent debit-note lane's missing shared runtime
  export; controller owns the integrated rerun.

## Exact remaining gap

Universal stale-version rejection remains. Adding `version` columns to every
catalog table was intentionally avoided. Existing `updatedAt` values could be
used as an opaque version, but current config clients do not send a mandatory
version on update/delete. Enforcing one only in the backend would break those
clients; accepting it optionally would not satisfy universal concurrency
authority.

The safe next slice is coordinated shared-client/schema work:

1. expose an opaque row version/ETag for every generated resource;
2. require that token on every generated update/delete;
3. compare and mutate under the idempotency winner transaction;
4. update all generic config callers and add stale/double-update proof.

Status: DONE_WITH_CONCERNS  
Summary: Generic config writes now have required stable-key replay, immutable exact results, first-winner concurrency, and transaction-aware DB hooks without bypassing governed pricing.  
Concerns/Blockers: Universal stale update/delete protection needs a coordinated mandatory client version contract; integrated typecheck/comprehensive reruns are temporarily blocked by the concurrent debit-note lane and remain with the controller.

## Controller stale-version closure — 2026-07-28

The remaining generated-CRUD concurrency gap is closed:

- every generated update/delete requires `If-Unmodified-Since`;
- the factory locks the current row, verifies its `updatedAt`, and changes the
  version monotonically in the same idempotency-winner transaction;
- missing versions return 428, stale versions return 409, and different
  transaction keys cannot overwrite one another;
- immutable exact replay still succeeds with the original version because the
  persisted command result is resolved before entering domain code;
- the frontend API transport remembers row versions from list/detail/create/
  update responses and automatically supplies them to update/delete callers;
- token changes and logout clear the version cache.

Focused proof:

- `qa/2026-07-28_q23-config-stale-version_backend-test.red.log`
- `qa/2026-07-28_q23-config-stale-version_backend-test.log`
- `qa/2026-07-28_q23-config-stale-version_frontend-test.log`

Status: DONE  
Summary: Generated configuration create/update/delete now has required atomic
replay plus mandatory optimistic concurrency from every existing UI caller.
