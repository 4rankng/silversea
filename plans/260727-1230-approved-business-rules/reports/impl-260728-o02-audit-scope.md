# O02 Audit Scope Implementation Report

## Scope

- Owned files:
  - `backend/src/services/audit-query.service.ts`
  - `backend/src/tests/audit-log-routes.test.ts`
  - `plans/260727-1230-approved-business-rules/reports/impl-260728-o02-audit-scope.md`
- Non-goals respected:
  - did not edit `HANDOFF.md`
  - did not touch `qa/`
  - did not modify frontend, migrations, or other rule files

## Root Cause

`accountantAssignmentCondition()` in `backend/src/services/audit-query.service.ts` failed open in two ways:

1. `not hasExplicitAssignments` granted company-wide finance/payroll visibility to unassigned ACCOUNTANT users.
2. `not isRecognizablyCustomerScoped` let customer-bound finance rows through whenever the payload omitted direct customer/trip data, even if the row could not be resolved to an assigned customer.

That contradicted accepted O02 wording: assigned-customer scope only, zero-assignment fail-closed, unresolved customer-bound rows fail-closed.

## Changes

- Removed the legacy no-assignment company-wide fallback.
- Split customer-bound finance detection from safe non-customer operational visibility.
- Added persisted customer resolution for payload-less payment receipt audit rows via `payment_receipts.customer_id`.
- Expanded persisted resolver matching for:
  - payment receipt rows
  - billing document rows
  - debt offset rows
  - credit override rows
- Added singular finance entity-type coverage so these rows still classify as finance even when producers emit singular forms.
- Left non-customer operational finance rows visible, but only through the existing accountant redaction contract.

## Focused Proof Added

`backend/src/tests/audit-log-routes.test.ts` now proves:

- zero-assignment ACCOUNTANT sees only safe non-customer finance rows
- nested payload/IP/path/method remain redacted for accountant view
- every resolver branch is exercised:
  - direct customer
  - direct trip
  - trip entity
  - trip-expense entity
  - payload-less payment receipt entity
  - payload-less billing document entity
  - payload-less debt offset entity
  - payload-less credit override entity
- unresolved customer-bound rows fail closed
- outside-scope customer rows fail closed
- assignment removal/scope move takes effect immediately
- pagination/count parity stays correct across pages

## Verification

- `cd backend && npx tsx --test --test-concurrency=1 src/tests/audit-log-routes.test.ts`
  - PASS
  - `tests 6`, `pass 6`, `fail 0`
- `cd backend && npx tsc --noEmit`
  - FAIL, unrelated dirty baseline outside owned scope
  - `src/services/user.service.ts(643,12): error TS2339: Property 'customerAccountType' does not exist ...`
  - `src/services/user.service.ts(645,40): error TS2339: Property 'customerAccountType' does not exist ...`

## Outcome

Accepted O02 audit-scope defect is closed in owned code:

- explicit customer assignments are now authoritative
- zero assignments no longer widen to company scope
- payload-less customer-bound finance rows resolve through persisted entities or stay hidden
- non-customer operational finance rows remain visible only through the redacted accountant contract

Status: DONE_WITH_CONCERNS
Summary: O02 scope logic now fails closed for unassigned/unresolved customer-bound finance rows and passes the expanded focused route suite; backend typecheck is still red in unrelated pre-existing worktree edits outside owned scope.
Concerns/Blockers: `backend/src/services/user.service.ts` has two unrelated TS2339 errors in the current dirty worktree, so repo-wide backend typecheck could not be closed from this ownership boundary.
