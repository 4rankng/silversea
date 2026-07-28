# Q15 office trip-expense governance closure

Status: DONE

## Result

The office-side trip-expense approval/rejection production bypass is closed.

- `POST /api/trips/:tripId/expenses/:expenseId/approve`
- `POST /api/trips/:tripId/expenses/:expenseId/reject`

Both routes now submit a versioned `TRIP_EXPENSE_APPROVAL` action with:

- requested decision (`APPROVED` or `REJECTED`);
- required reason;
- typed review evidence and attachment references;
- the authoritative trip-expense version.

The expense remains `PENDING` until a distinct checker advances the action and
a third actor approves it. Exact replay returns the original action, payload
drift and stale versions fail, and concurrent final approvals have one winner.

## Final adapter

The common governance approval dispatcher now routes `TRIP_EXPENSE` actions to
the office expense adapter. The adapter calls the pre-existing transactional
`processExpenseApproval` function with the original expense version.

This deliberately preserves all Q12-Q14 final-boundary checks:

- fuel-reconciliation clearance;
- invoice-required enforcement;
- accepted no-invoice category and substitute evidence;
- payee/date/reason/evidence completeness;
- same-person/day/category aggregation;
- configured per-item/per-day thresholds and required approval title;
- return-for-evidence outcome and source propagation.

## UI

The governance inbox displays whether the request proposes approval or
rejection, the review note, evidence references, and this truthful state:

> Chi phí vẫn chờ xử lý; chưa phát sinh hiệu lực tài chính trước phê duyệt cuối.

## Verification

- Public governed office-expense slice: passed.
- M47 no-invoice and D1 concurrency regressions: 34/34 passed.
- Shared governance foundation: 12/12 passed.
- Backend typecheck: passed.
- Governance inbox component: 5/5 passed.
- Frontend typecheck: passed.
- Self-review: passed.

Artifacts:

- `qa/2026-07-28_q15-trip-expense_backend-test.first.log`
- `qa/2026-07-28_q15-trip-expense_backend-test.final.log`
- `qa/2026-07-28_q15-trip-expense_backend-typecheck.first.log`
- `qa/2026-07-28_q15-trip-expense_backend-typecheck.final.log`
- `qa/2026-07-28_q15-trip-expense_frontend-test.log`
- `qa/2026-07-28_q15-trip-expense_frontend-typecheck.log`
- `qa/2026-07-28_q15-trip-expense_review.md`

Status: DONE
Summary: Office trip-expense approval/rejection is now a three-actor governed request, with exact replay/stale/concurrency proof and all existing Q12-Q14 final checks preserved.
Concerns/Blockers: The shared untracked trip-governance test file contains concurrent sibling tests currently failing for unrelated trip close/change/GPS edits; those failures are captured in the first artifact and remain under controller ownership.
