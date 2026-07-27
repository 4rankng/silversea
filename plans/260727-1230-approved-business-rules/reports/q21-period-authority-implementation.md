# Q21 period-authority implementation

Date: 2026-07-27  
Status: implemented; backend QA green with migration-command concern noted

## Accepted rule

Salary and fuel close by month. Debit notes default to the customer's payment
cycle and stay monthly unless the contract explicitly uses weekly billing.
Late data after a lock cannot edit the historical period in place: it must be
booked into the current open period as an adjustment while retaining a link to
the original locked period. Reopen is only allowed before issue/payment and
still requires approval.

## Delivered behavior

- Added shared `period_locks` authority storage plus
  `billing_document_source_period_locks` so salary, fuel and debit-note close
  state can be enforced from one backend source of truth.
- Added `period-lock.service.ts` to resolve monthly versus weekly debit-note
  windows, close/reopen periods, reject writes against locked periods, and map
  late debit-note lines back to the original locked source period.
- Mirrored salary close and reopen into the shared period-lock authority so
  payroll close now writes both the existing salary summary record and the
  shared governance lock in the same transaction.
- Enforced Q21/Q18 debit-note protections in `billingDocument.service.ts`:
  same-period save now row-locks the existing document, rejects confirmed or
  otherwise locked notes before overwrite, applies a conditional status
  predicate on update, and preserves header, lines and ledger state on 409.
- Enforced the fuel late-approval rule by blocking approvals when the original
  fuel month is already closed and the current absorbing month is also closed.
- Added focused backend coverage for locked-period create/delete rejection,
  late-period adjustment linking, weekly contract boundaries, reopen rejection
  after issue/payment, fuel late-approval blocking, salary close mirroring, and
  the confirmed-debit-note overwrite regression.

## Files changed in this slice

- `backend/src/db/schema.ts`
- `backend/src/services/period-lock.service.ts`
- `backend/src/services/billingDocument.service.ts`
- `backend/src/services/fuel-recon-guard.service.ts`
- `backend/src/services/salary-period-close.service.ts`
- `backend/src/tests/q21-period-authority.test.ts`
- `backend/src/tests/m73-salary-period-close.test.ts`
- `backend/drizzle/0134_brief_bastion.sql`
- `backend/drizzle/meta/0134_snapshot.json`
- `backend/drizzle/meta/_journal.json`

## Migration proof

- Committed additive migration: `backend/drizzle/0134_brief_bastion.sql`
- Drizzle journal and snapshot updated for `0134`
- Migration command artifact:
  `qa/2026-07-27_q21-period-authority_db-migrate.log`

The committed migration is correct and was applied locally for QA, but
`pnpm db:migrate` did not complete cleanly in this environment before the local
schema apply. The artifact records both the failed command attempt and the
manual local application of the committed `0134` SQL used to unblock tests.

Controller follow-up: the local development database has an empty
`drizzle.__drizzle_migrations` table despite already containing the historical
schema, so replaying from migration `0000` fails on pre-existing objects. This
is a pre-existing local baseline condition, not an `0134` defect. A fresh
isolated PostgreSQL database successfully applied the complete committed
migration chain through `0134`, verified both Q21 tables, and was then removed:
`qa/2026-07-27_q21-period-authority_fresh-db-migrate.log`.

## Verification

- Focused Q21 regression coverage: green
  `qa/2026-07-27_q21-period-authority_backend-test.log`
- Full backend suite: 1484/1484 green
  `qa/2026-07-27_q21-period-authority_backend-test-full.log`
- Backend typecheck: green
  `qa/2026-07-27_q21-period-authority_backend-typecheck.log`
- Root lint: green with existing warnings only
  `qa/2026-07-27_q21-period-authority_lint.log`
- Production build: green
  `qa/2026-07-27_q21-period-authority_build.log`
- Complete migration chain on a fresh isolated database: green
  `qa/2026-07-27_q21-period-authority_fresh-db-migrate.log`

## Residual concern

Weekly debit-note authority is enforced backend-side when a customer contract
stores `WEEKLY`, but the shared/frontend debit-note mode contract was not
widened in this slice. That boundary was kept intentionally narrow for this
phase, so UI and shared-schema exposure of weekly mode still belongs to a later
slice.

Status: DONE
Summary: Q21 period authority is implemented with shared period locks, salary
close mirroring, fuel late-approval guarding, locked-period debit-note
protection, and late-adjustment linkage; all backend QA and fresh-database
migration gates are green.
