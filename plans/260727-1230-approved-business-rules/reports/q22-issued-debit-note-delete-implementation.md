# Q22 issued debit-note deletion boundary

**Date:** 2026-07-27  
**Status:** GO for this bounded Q22 slice

## Delivered

- `deleteDocument()` now permits soft deletion and ledger-delta reversal only
  while a debit note is still `DRAFT` (or a legacy null draft).
- Every debit-note entity type follows the same lifecycle boundary. An issued
  customer or vendor debit note cannot bypass the guard.
- Customer debit notes retain the existing customer advisory lock, Q21 period
  authority check, conditional status update, and draft-only delta reversal.
- Non-debit documents retain their existing deletion behavior.
- The conditional update prevents a lifecycle transition racing deletion from
  producing an issued, deleted document.

## Verification

- Initial focused run preserved the review/fix loop:
  `qa/2026-07-27_q22-issued-debit-note-delete_backend-test.log`.
- Final affected tests:
  `qa/2026-07-27_q22-issued-debit-note-delete_backend-test.review-fix.log`
  — 13/13 passed.
- Final targeted lint:
  `qa/2026-07-27_q22-issued-debit-note-delete_lint.review-fix.log`
  — exit 0.
- Independent review:
  `qa/2026-07-27_q22-issued-debit-note-delete_independent-review.md`
  — final GO after the vendor-debit-note bypass and status/ledger coverage
  findings were fixed.

## Coverage

The regression proves `SENT`, `PENDING_CONFIRM`, `CONFIRMED`,
`PARTIAL_PAID`, `PAID`, `REJECTED`, and `CANCELED` customer debit notes keep
their original nonzero ledger evidence. It also proves an issued vendor debit
note is preserved and the existing confirmation/delete race remains safe.

Q22 remains partial: source propagation, provenance, issued-document AR
binding, and linked post-issue correction still require later slices.
