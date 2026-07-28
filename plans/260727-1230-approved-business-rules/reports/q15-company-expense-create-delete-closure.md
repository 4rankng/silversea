# Q15 company-expense CREATE/DELETE closure

Status: DONE

## Result

Company-expense CREATE and DELETE now use the shared maker/checker/approver governance lifecycle.

- CREATE stores a pending governance action only. The expense row and unpaid vendor-payable ledger entry are created atomically at final approval.
- DELETE is governed for both unpaid and paid expenses. Pending or rejected requests do not alter the source. Approval soft-deletes the source row while retaining it physically and retaining the append-only governance decision history.
- Direct calls to the service create/delete functions fail unless invoked by the approved governance application path.
- Idempotency, exact replay, payload drift, stale versions, actor separation, approval, and rejection are covered.
- The expense entry UI requires a reason and accurately describes the pending state and absence of payable effects.
- The centralized durable material-write registry includes expense POST, PUT, and DELETE.

## History constraint

No migration or new governance enum was required. `COMPANY_EXPENSE` already existed as a supported subject and action kind. Because governance snapshots are non-null, CREATE represents the non-existent prior source with:

```json
{ "exists": false }
```

The created expense id is linked back to the governance action during final approval.

## Paid-delete accounting semantics

A PAID expense does not create a `VENDOR_EXPENSE` payable entry in the existing accounting model. Its governed deletion therefore does not post a synthetic negative payable. Final approval soft-deletes the retained expense source and records the governed reversal decision and application result.

## Finalized-correction addendum

Financially material edits are now governed even when the current expense is
PAID. Amount, supplier, category, expense date, vehicle allocation, and payment
status changes cannot use the direct update path.

- Submission stores a versioned `FINALIZED_REPLACEMENT` action with a mandatory
  reason and has no expense or ledger effect.
- Final approval creates the corrected replacement and soft-deletes the original
  without overwriting it. Original receipt-photo evidence remains attached to
  the retained source, and the governance application result links the original
  and replacement ids.
- Exact replay, payload drift, stale source versions, distinct
  maker/checker/approver actors, concurrent final approval, rejection, and
  return-for-evidence behavior are covered by public-route tests.
- PAID-to-PAID correction does not invent a payable entry. A replacement changed
  to UNPAID follows the existing approved-create payable semantics.
- Non-financial note/photo edits remain direct.
- The expense-entry UI explains that a finalized financial correction is pending
  and that approval will create a replacement while preserving source history.

## QA

- Backend focused + durable boundary: green, 10/10.
- Backend post-fix focused rerun: green, 6/6.
- Backend typecheck: green after the captured snapshot typing fix.
- Frontend full suite: green, 77 files / 387 tests.
- Frontend typecheck: green.
- Review: green.
- Paid-correction backend focused suites: green, 8/8.
- Paid-correction frontend message suite: green, 3/3.
- Paid-correction frontend typecheck: green.
- Paid-correction backend typecheck reached unrelated in-progress
  material-price configuration errors only; the controller owns the integrated
  rerun after that parallel work lands.

Artifacts:

- `qa/2026-07-28_q15-company-expense_backend-test.first.log`
- `qa/2026-07-28_q15-company-expense_backend-test.rerun.log`
- `qa/2026-07-28_q15-company-expense_backend-test.final.log`
- `qa/2026-07-28_q15-company-expense_backend-typecheck.log`
- `qa/2026-07-28_q15-company-expense_frontend-test.log`
- `qa/2026-07-28_q15-company-expense_frontend-typecheck.log`
- `qa/2026-07-28_q15-company-expense_review.md`
- `qa/2026-07-28_q15-paid-expense-correction_backend-test.first.log`
- `qa/2026-07-28_q15-paid-expense-correction_backend-test.final.log`
- `qa/2026-07-28_q15-paid-expense-correction_backend-typecheck.first.log`
- `qa/2026-07-28_q15-paid-expense-correction_frontend-test.log`
- `qa/2026-07-28_q15-paid-expense-correction_frontend-typecheck.log`
- `qa/2026-07-28_q15-paid-expense-correction_review.md`

Status: DONE_WITH_CONCERNS
Summary: Company-expense create, delete, and finalized financial correction are governed; approved PAID corrections use append-only replacement semantics while preserving the source and evidence.
Concerns/Blockers: The bounded focused tests and frontend typecheck are green. The repository-wide backend typecheck must be rerun by the controller after concurrent material-price configuration work is integrated.
