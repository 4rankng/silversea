# Q19 business-calendar implementation

Date: 2026-07-27  
Status: implemented; independent review GO

## Accepted rule

Customer payment due dates use the contractual term plus the centrally managed
business calendar. Weekend and holiday processing follows the customer's
configured policy. The original contractual date and the adjusted processing
date are frozen on the financial obligation and do not change when the
customer contract or calendar is edited later.

## Delivered behavior

- Added customer-level payment-date policy and an ADMIN-only business-calendar
  configuration surface.
- Added immutable original due date, processing due date, applied term and
  applied policy snapshots to customer ledger obligations and billing
  documents.
- Backfilled existing billing documents, trip revenue, service fees and
  supported adjustments through additive migration `0133`.
- Ensured trip completion, debit-note creation, late-approved service fees and
  positive manual trip adjustments all stamp frozen payment-date authority.
- Updated AR status, statements, reminders and payment-term reporting to read
  the persisted authority instead of recalculating from mutable customer data.
- Exposed both dates in customer portal, billing history, statement exports,
  debit-note PDF and spreadsheet outputs.
- Added strict semantic date validation, more-than-50-row calendar coverage,
  ADMIN CRUD/RBAC tests and desktop/mobile visual evidence.

## Migration proof

- Fresh database migration:
  `qa/2026-07-27_q19-business-calendar_clean-migration.log`
- Upgrade/backfill migration with weekend and holiday fixtures:
  `qa/2026-07-27_q19-business-calendar_upgrade-migration.log`

## Verification

- Authority paths: 22/22:
  `qa/2026-07-27_q19-business-calendar_authority-paths-final.log`
- Calendar routes: 3/3:
  `qa/2026-07-27_q19-business-calendar_routes-final.log`
- Reader regressions: 18/18:
  `qa/2026-07-27_q19-business-calendar_legacy-reader-fixtures-rerun.log`
- Backend suite: 1472/1472:
  `qa/2026-07-27_q19-business-calendar_backend-test-final-rerun.log`
- Frontend suite: 311/311:
  `qa/2026-07-27_q19-business-calendar_frontend-test-final.log`
- Backend and frontend typechecks, root lint and production build: green.
- Full E2E: exit 0, no failed scenarios:
  `qa/2026-07-27_q19-business-calendar_e2e-final.log`
- Independent review: GO:
  `qa/2026-07-27_q19-business-calendar_independent-review.md`
- Responsive evidence:
  `qa/2026-07-27_q19-business-calendar_desktop.png` and
  `qa/2026-07-27_q19-business-calendar_mobile.png`.

The existing E2E runner conditionally skipped four fixture-dependent scenarios
(empty driver/forwarder states, trailer expense, and another-forwarder's
expense). They are tracked for the integrated staging matrix and are not used
as Q19 acceptance evidence.

The E2E runner's final `0/0` aggregate footer is a reporting-path defect: the
same artifact contains all 16 suite summaries, zero failed scenarios and exit
status 0. This does not replace the individual suite evidence and remains
tracked for the integrated QA phase.
