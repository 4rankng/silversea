# Q15 profit-distribution governance closure

**Date:** 2026-07-28  
**Status:** DONE  
**Scope:** profit distribution only

## Root cause

`POST /api/reports/distribute-profit` called the exported `distributeProfit`
writer directly. The `PROFIT_DISTRIBUTION` policy existed in the catalog, but
no request producer or approval adapter was connected to the public route.
Idempotency and the quarter advisory lock prevented duplicate writes, but
neither enforced maker/checker/approver separation.

## Implementation

- The public route now creates a `PENDING_CHECK` governance action and persists
  the exact HTTP `201` command result for replay.
- The request snapshots a stable hash of the quarter distribution plan. It
  creates no distribution rows.
- A quarter-scoped advisory lock prevents competing pending requests.
- `PROFIT_DISTRIBUTION` is connected to the common governance transition
  dispatcher. Only the approval adapter can persist distributions.
- Approval recomputes and verifies the plan hash, rejects changed source
  authority, rejects an already-distributed quarter, and inserts all rows in
  the same transaction as the final approval.
- The former public `distributeProfit` writer is no longer exported.
- The profit page now says the request is awaiting independent checking and
  approval. It neither claims distribution succeeded nor refreshes completed
  distribution history after the request.
- Audit semantics are split: the maker request records
  `PROFIT_DISTRIBUTION_REQUESTED`; only the successful, non-replayed approval
  that applies the rows records `PROFIT_DISTRIBUTED`.

## Executable proof

Focused public-boundary coverage proves:

1. request has no financial effect;
2. same idempotency key returns the exact pending response and status;
3. viewer request/check is denied;
4. maker cannot check;
5. checker cannot approve;
6. a distinct third actor applies the distribution;
7. two concurrent approvers produce one winner and one `409`;
8. stale approval is rejected without another row;
9. reject and return-for-evidence leave distributions unchanged;
10. the direct writer is absent and only the explicit approval adapter remains.
11. the pending request and applied distribution write distinct truthful audit
    events;
12. the UI renders a pending-review card and never renders the former
    immediate-success claim.

Artifacts:

- Red baseline: `qa/2026-07-28_q15-profit-distribution_backend-test.log`
  (4/4 failed against the direct-write path).
- Assertion-green run with an open-handle teardown issue:
  `qa/2026-07-28_q15-profit-distribution_backend-test.rerun2.log`.
- Final focused run:
  `qa/2026-07-28_q15-profit-distribution_backend-test.rerun3.log`
  (4/4 passed, exit `0`; force-exit used only for the isolated Node test
  process after teardown).
- Final audit-aware backend run:
  `qa/2026-07-28_q15-profit-distribution-audit_backend-test.log`
  (4/4 passed, exit `0`, including persisted request/application audit rows).
- Frontend run:
  `qa/2026-07-28_q15-profit-distribution-ux_frontend-test.log`
  (75 files, 383 tests passed, exit `0`).
- Final backend/frontend typecheck attempts are preserved in
  `qa/2026-07-28_q15-profit-distribution-final_typecheck-backend.log` and
  `qa/2026-07-28_q15-profit-distribution-final_typecheck-frontend.log`.
  They currently report only concurrent, out-of-scope Q18/Q23 settlement,
  fuel-invoice, and approved-financial test/page edits. No diagnostic points
  to a profit-distribution file; the controller owns the final integrated
  rerun once those lanes settle.
- `git diff --check` for the owned files passed.

## Integration boundary

The two former integration concerns are closed in this lane. The only remaining
work is the controller's normal final integrated typecheck/test/build pass after
all concurrently edited lanes finish.
