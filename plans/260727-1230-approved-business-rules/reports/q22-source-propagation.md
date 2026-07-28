# Q22 Source Propagation Report

Status: DONE

## Scope closed

- Draft customer debit notes now recompute from the latest trip source instead of preserving stale source snapshots.
- Issued customer debit notes stay immutable; source drift is exposed as provenance/authority state and corrected through `DEBIT_NOTE_ADJUSTMENT` governance actions.
- Debit-note send now waits on the same trip financial authority lock used by source updates, so a draft cannot be issued from a stale trip snapshot mid-race.

## Final code changes in this pass

- `backend/src/services/source-change.service.ts`
  - restricted propagation collection to draft-only billing documents
  - preserved Q22 behavior for issued notes: drift is observed later via provenance, not rewritten in place
- `backend/src/tests/q22-source-authority.test.ts`
  - added focused coverage for:
    - draft trip-source recompute
    - issued-note provenance + adjustment governance
    - send-vs-source-lock race serialization
    - cross-month departure, completion and expense-event attribution

## Q20/Q22 business-date correction

- Freight/debit-note membership now uses the immutable trip completion business
  date, never `departureDate`.
- Approved service-fee membership and newly posted service-fee due-date
  authority now use `trip_expenses.expense_date`.
- Customer debit-note and payment-statement generation can include freight and
  expense lines from different periods for the same trip, without inheriting
  one source's date for the other.
- The cross-month fixture proves a July departure/expense and an August
  completion update only the correct document in each period.
- Test teardown now deletes governance references before their ledger effects,
  closing the fixture leak identified by independent review.

## Existing lane implementation validated by this pass

- Shared provenance/authority types and request schema were already present in the lane worktree and were validated by the green backend typecheck.
- Billing-document governance approval dispatch and adjustment request surface were already present in the lane worktree and were exercised by the focused Q22 test.

## QA artifacts

- `qa/2026-07-27_q22-source-propagation_backend-typecheck.log`
- `qa/2026-07-27_q22-source-propagation_backend-test.log`
- `qa/2026-07-27_q20-q22-business-date_backend-test.log`
- `qa/2026-07-27_q20-q22-business-date_backend-test.rerun.log`
- `qa/2026-07-27_q20-q22-business-date_backend-test.rerun2.log`

## Notes

- During diagnostics, interrupted test runs left temporary `GBN-ADJ:*` ledger rows behind. Those residual rows were manually removed after the green test run, and the latest ledger query returned no recent Q22 receipt rows.
